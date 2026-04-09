/**
 * Translation service — Gemini 2.5 Flash.
 *
 * This is the ONLY place in the app that knows how translation happens.
 * Everything else (see src/db/actions.js) calls `translate()` through the
 * stale-response guard, so if you need to swap providers again, only edit
 * the body of `translate()` and keep the signature:
 *
 *     translate(text, sourceLang, targetLang) => Promise<string>
 *
 * ---
 *
 * API key handling
 * ----------------
 * Vite exposes environment variables to client code ONLY if they're
 * prefixed with `VITE_`. So the user puts their key in `.env` as:
 *
 *     VITE_GEMINI_API_KEY=xxx...
 *
 * and we read it via `import.meta.env.VITE_GEMINI_API_KEY`.
 *
 * Important caveat: because this is a browser app with no backend, the
 * key WILL be bundled into the JS shipped to the browser. That's fine
 * for this teaching tool where each user runs it locally with their own
 * key — but do NOT deploy this publicly without moving the API call to
 * a server/edge function.
 *
 * ---
 *
 * Version note
 * ------------
 * Uses the new `@google/genai` SDK (not the old `@google/generative-ai`).
 * The SDK name and the `GoogleGenAI` class are the current official API
 * as of this project's pinning — see the README for version.
 */

import { GoogleGenAI } from '@google/genai';

const LANGUAGE_LABELS = {
  'zh-Hant': '繁中',
  'zh-Hans': '简中',
  en: 'EN',
  ja: '日本語',
};

// Full names sent to Gemini in the prompt. Gemini handles human-readable
// names reliably and they're less ambiguous than BCP-47 codes in some
// cases (e.g. it interprets "Traditional Chinese" more literally than
// "zh-Hant").
const LANGUAGE_PROMPT_NAMES = {
  'zh-Hant': 'Traditional Chinese (zh-Hant)',
  'zh-Hans': 'Simplified Chinese (zh-Hans)',
  en: 'English',
  ja: 'Japanese',
};

export const SUPPORTED_LANGUAGES = [
  { code: 'zh-Hant', label: '繁體中文' },
  { code: 'zh-Hans', label: '简体中文' },
  { code: 'en', label: 'English' },
  { code: 'ja', label: '日本語' },
];

export function getLanguageLabel(code) {
  return LANGUAGE_LABELS[code] || code;
}

export function getLanguageFullLabel(code) {
  return SUPPORTED_LANGUAGES.find((l) => l.code === code)?.label || code;
}

// ============================================================
// Gemini client (lazy singleton)
// ============================================================

const MODEL = 'gemini-2.5-flash';

let _client = null;
let _keyChecked = false;

function getClient() {
  if (_client) return _client;

  const apiKey = import.meta.env.VITE_GEMINI_API_KEY;
  if (!apiKey || apiKey === 'your-api-key-here') {
    if (!_keyChecked) {
      _keyChecked = true;
      // Log once, not on every translation attempt.
      console.error(
        '[translationService] VITE_GEMINI_API_KEY is not set. ' +
          'Create a .env file in the project root with your key ' +
          '(see .env.example). Translation will fail until then.'
      );
    }
    throw new Error('VITE_GEMINI_API_KEY is not set');
  }

  // The SDK supports both `new GoogleGenAI({})` (which reads
  // process.env.GEMINI_API_KEY in Node) and an explicit `apiKey` option.
  // In the browser there's no process.env, so we must pass it.
  _client = new GoogleGenAI({ apiKey });
  return _client;
}

// ============================================================
// translate()
// ============================================================

/**
 * Translate text from one language to another using Gemini 2.5 Flash.
 *
 * Returns the translated string. Throws on failure so `runTranslation`
 * in actions.js can set the card's `translationStatus` to "error".
 *
 * @param {string} text
 * @param {string} sourceLang  BCP-47-ish code (zh-Hant, en, ja, ...)
 * @param {string} targetLang
 * @returns {Promise<string>}
 */
export async function translate(text, sourceLang, targetLang) {
  if (!text || !targetLang || sourceLang === targetLang) return text;

  const client = getClient();

  const srcName = LANGUAGE_PROMPT_NAMES[sourceLang] || sourceLang;
  const dstName = LANGUAGE_PROMPT_NAMES[targetLang] || targetLang;

  // Prompt design: be very explicit about what NOT to include. Gemini
  // otherwise likes to add things like 'Sure! Here is the translation:'
  // or wrap the output in quotes.
  const prompt =
    `Translate the following text from ${srcName} to ${dstName}.\n` +
    `Return ONLY the translated text. ` +
    `Do not include quotation marks, explanations, language labels, ` +
    `romanization, or any preamble. ` +
    `If the input is a single word or a short phrase, output only the ` +
    `equivalent word or phrase in the target language.\n\n` +
    `Text:\n${text}`;

  const response = await client.models.generateContent({
    model: MODEL,
    contents: prompt,
  });

  const out = (response.text || '').trim();
  if (!out) throw new Error('Empty response from Gemini');

  // Strip stray wrapping quotes if the model added them anyway.
  return out.replace(/^["'“”「『]\s*|\s*["'”」』]$/g, '').trim();
}
