/**
 * Proposal service — Gemini 2.5 Flash "抽企劃卡" generator.
 *
 * Given the current board layout (columns + the cards inside them, but
 * NOT the unplaced pool), asks Gemini to produce a project idea that
 * takes the user's classification seriously as a signal. The result is a
 * structured object (title / rationale / mvp / whyNow / tags) that the
 * UI renders as a "proposal card" the user can flip through later.
 *
 * Why it's a separate service
 * ---------------------------
 * `translationService.js` has a very tight contract (`translate(text,
 * src, dst) => Promise<string>`) that's guarded in CLAUDE.md. Don't put
 * unrelated Gemini calls in there. This file owns its own prompt,
 * response parsing, and error handling, and only reuses the SDK / API
 * key.
 *
 * API key
 * -------
 * Same `VITE_GEMINI_API_KEY` as translation. Client is a lazy singleton
 * local to this file (no need to share with translationService — two
 * `new GoogleGenAI({apiKey})` calls is free).
 *
 * Token budget
 * ------------
 * Per call:
 *   - a few column names
 *   - the source text of every *placed* card (usually < 30 cards, each
 *     one or two sentences)
 *   - up to 5 past proposal titles + one-line rationales as "avoid
 *     repeating these angles"
 *   - a ~400-token instruction + JSON schema
 * Well under 2 KB in, a few KB out. At Gemini 2.5 Flash prices this is
 * effectively free even if you hammer it.
 */

import { GoogleGenAI } from '@google/genai';

const MODEL = 'gemini-2.5-flash';

let _client = null;
let _keyChecked = false;

function getClient() {
  if (_client) return _client;

  const apiKey = import.meta.env.VITE_GEMINI_API_KEY;
  if (!apiKey || apiKey === 'your-api-key-here') {
    if (!_keyChecked) {
      _keyChecked = true;
      console.error(
        '[proposalService] VITE_GEMINI_API_KEY is not set. ' +
          'Proposal generation will fail until then.'
      );
    }
    throw new Error('VITE_GEMINI_API_KEY is not set');
  }

  _client = new GoogleGenAI({ apiKey });
  return _client;
}

/**
 * Build a compact text description of the current board that Gemini
 * can reason over. Unplaced cards are intentionally omitted — the
 * whole point of this feature is that the *act of sorting* is the
 * signal we want Gemini to take seriously.
 *
 * @param {{ name:string, cardIds:string[] }[]} columns
 * @param {Map<string, {sourceText:string}>} cardsMap
 * @returns {{ snapshotName:string, columns: { name:string, cards:string[] }[], totalCards:number }}
 */
export function buildLayoutSnapshot(snapshotName, columns, cardsMap) {
  const snap = {
    snapshotName,
    columns: [],
    totalCards: 0,
  };
  for (const col of columns) {
    const cards = [];
    for (const id of col.cardIds) {
      const card = cardsMap.get(id);
      if (!card) continue;
      cards.push(card.sourceText);
      snap.totalCards += 1;
    }
    snap.columns.push({ name: col.name, cards });
  }
  return snap;
}

/**
 * Format the layout snapshot into a block of text that goes into the
 * prompt. Kept deterministic and human-readable so it's easy to debug
 * by logging and so Gemini has no ambiguity about what the columns
 * mean.
 */
function formatLayoutForPrompt(layoutSnapshot) {
  const lines = [];
  lines.push(`Snapshot frame: "${layoutSnapshot.snapshotName}"`);
  lines.push('Columns and the ideas the user has placed in each:');
  for (const col of layoutSnapshot.columns) {
    if (col.cards.length === 0) {
      lines.push(`- [${col.name}] (empty)`);
    } else {
      lines.push(`- [${col.name}]`);
      for (const txt of col.cards) {
        lines.push(`    • ${txt}`);
      }
    }
  }
  return lines.join('\n');
}

function formatHistoryForPrompt(history) {
  if (!history || history.length === 0) return '';
  const lines = ['Past proposal angles for this same frame (AVOID repeating these — pick a genuinely different angle):'];
  for (const h of history.slice(0, 5)) {
    const oneLine = (h.rationale || '').replace(/\s+/g, ' ').slice(0, 160);
    lines.push(`- "${h.title}" — ${oneLine}`);
  }
  return lines.join('\n');
}

/**
 * Ask Gemini for a project proposal based on the current layout.
 *
 * @param {object} layoutSnapshot  output of buildLayoutSnapshot()
 * @param {{title:string, rationale:string}[]} [history]  past proposals to avoid repeating
 * @returns {Promise<{title:string, rationale:string, mvp:string[], whyNow:string, tags:string[]}>}
 */
export async function generateProposal(layoutSnapshot, history = []) {
  if (layoutSnapshot.totalCards === 0) {
    throw new Error(
      'Board has no placed cards yet — put some cards into columns first.'
    );
  }

  const client = getClient();

  // Prompt design notes:
  // - Traditional Chinese output because the user/student is Taiwanese.
  //   (Could be parameterized later if needed, but defaulting to zh-Hant
  //   matches the seeded demo cards and the user's classroom context.)
  // - Temperature bumped so repeated generations diverge even if the
  //   board is unchanged — that's the "反覆刷反覆抽卡" feel the user
  //   explicitly asked for.
  // - Structured JSON via responseMimeType so we don't have to parse
  //   loose prose and so the UI can render a clean card.
  const prompt =
    `You are a product-sense coach helping a beginner programmer come up ` +
    `with a concrete project idea. The user has been sorting a pile of ` +
    `raw ideas into columns under one classification frame. Your job is ` +
    `to read the CURRENT board state and propose ONE concrete project ` +
    `that takes the user's sort seriously as a signal.\n\n` +
    `${formatLayoutForPrompt(layoutSnapshot)}\n\n` +
    `${formatHistoryForPrompt(history)}\n\n` +
    `Guidelines:\n` +
    `- The proposal must be a SPECIFIC project, not a category. Not "a ` +
    `productivity app", but a concrete product with a name and a point.\n` +
    `- Base the proposal on the *combination* of ideas the user has ` +
    `placed — especially those grouped together in the same column. ` +
    `Treat the column names as the user's judgment and honor them.\n` +
    `- Ignore ideas that were not placed into any column (they are in a ` +
    `separate pool). If a column is empty, ignore that column too.\n` +
    `- MVP must be 3 bullet points, each a concrete first thing to ` +
    `build, achievable by a beginner with AI help.\n` +
    `- "whyNow" should be a single crisp sentence explaining why this ` +
    `specific combination of placed ideas is interesting right now.\n` +
    `- 2 to 4 short tags (single words or short phrases).\n` +
    `- Write ALL fields in Traditional Chinese (繁體中文 / 台灣用語).\n` +
    `- Be playful but specific. The user is going to read this with ` +
    `their younger sister and they want to feel "oh, that's a real idea".\n` +
    `- If past-proposal angles are listed above, pick a genuinely ` +
    `different angle — different product type, different user, or ` +
    `different core mechanic.\n\n` +
    `Return ONLY JSON matching this schema (no markdown fences, no prose):\n` +
    `{\n` +
    `  "title": string,           // short project name, Traditional Chinese\n` +
    `  "rationale": string,        // 2-4 sentences, why this project fits the sort\n` +
    `  "mvp": string[],            // exactly 3 bullet strings\n` +
    `  "whyNow": string,           // one sentence\n` +
    `  "tags": string[]            // 2-4 short tags\n` +
    `}`;

  const response = await client.models.generateContent({
    model: MODEL,
    contents: prompt,
    config: {
      temperature: 1.1,
      responseMimeType: 'application/json',
    },
  });

  const raw = (response.text || '').trim();
  if (!raw) throw new Error('Empty response from Gemini');

  const parsed = safeParse(raw);
  if (!parsed) {
    console.error('[proposalService] unparseable Gemini response:', raw);
    throw new Error('Gemini returned a malformed response');
  }

  // Normalize — tolerate the occasional missing field.
  return {
    title: String(parsed.title || '（未命名提案）').trim(),
    rationale: String(parsed.rationale || '').trim(),
    mvp: Array.isArray(parsed.mvp)
      ? parsed.mvp.map((x) => String(x).trim()).filter(Boolean).slice(0, 5)
      : [],
    whyNow: String(parsed.whyNow || '').trim(),
    tags: Array.isArray(parsed.tags)
      ? parsed.tags.map((x) => String(x).trim()).filter(Boolean).slice(0, 6)
      : [],
  };
}

// Gemini is supposed to return clean JSON thanks to responseMimeType,
// but models occasionally still wrap it in ```json fences or add a
// trailing comma. Be forgiving.
function safeParse(raw) {
  try {
    return JSON.parse(raw);
  } catch (_) {}
  const fenceMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenceMatch) {
    try {
      return JSON.parse(fenceMatch[1]);
    } catch (_) {}
  }
  // Last-ditch: grab the outermost {...}.
  const braceMatch = raw.match(/\{[\s\S]*\}/);
  if (braceMatch) {
    try {
      return JSON.parse(braceMatch[0]);
    } catch (_) {}
  }
  return null;
}
