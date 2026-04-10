import { db, setSetting } from './database.js';
import { translate } from '../services/translationService.js';
import {
  buildLayoutSnapshot,
  generateProposal as callGeminiForProposal,
} from '../services/proposalService.js';

/**
 * All mutations go through this file. Components never touch Dexie directly.
 * Reads happen via `useLiveQuery` in components, which auto-rerender when
 * these actions write.
 */

function uid(prefix) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

// Clone a layout so we never mutate Dexie's returned object.
function cloneLayout(layout) {
  return JSON.parse(JSON.stringify(layout));
}

// ============================================================
// Cards
// ============================================================

/**
 * Create a new card and add it to the unplaced pool of every existing
 * snapshot. If a targetLang is given, kick off translation asynchronously
 * and update the card's translationStatus when it resolves.
 */
export async function createCard({ sourceLang, sourceText, targetLang }) {
  const id = uid('card');
  const now = Date.now();
  const card = {
    id,
    sourceLang,
    sourceText,
    targetLang: targetLang || null,
    targetText: null,
    translationStatus: targetLang ? 'loading' : 'none',
    createdAt: now,
    updatedAt: now,
  };

  await db.transaction('rw', db.cards, db.snapshots, async () => {
    await db.cards.add(card);
    const snapshots = await db.snapshots.toArray();
    for (const snap of snapshots) {
      const layout = cloneLayout(snap.layout);
      // New cards appear at the top of the pool so they're visible immediately.
      layout.unplacedCardIds.unshift(id);
      await db.snapshots.update(snap.id, { layout, updatedAt: now });
    }
  });

  if (targetLang) {
    runTranslation(id, sourceText, sourceLang, targetLang);
  }

  return id;
}

/**
 * Update a card's source text and/or target language. If either changed
 * and a target language is set, re-translate.
 */
export async function updateCardText(cardId, { sourceText, targetLang }) {
  const card = await db.cards.get(cardId);
  if (!card) return;

  const nextSourceText =
    typeof sourceText === 'string' ? sourceText : card.sourceText;
  const nextTargetLang =
    targetLang === undefined ? card.targetLang : targetLang || null;

  const sourceChanged = nextSourceText !== card.sourceText;
  const targetChanged = nextTargetLang !== card.targetLang;

  const patch = {
    sourceText: nextSourceText,
    targetLang: nextTargetLang,
    updatedAt: Date.now(),
  };

  if (!nextTargetLang) {
    patch.translationStatus = 'none';
    patch.targetText = null;
  } else if (sourceChanged || targetChanged) {
    patch.translationStatus = 'loading';
    patch.targetText = null;
  }

  await db.cards.update(cardId, patch);

  if (nextTargetLang && (sourceChanged || targetChanged)) {
    runTranslation(cardId, nextSourceText, card.sourceLang, nextTargetLang);
  }
}

function runTranslation(cardId, text, sourceLang, targetLang) {
  translate(text, sourceLang, targetLang)
    .then(async (translated) => {
      // Guard: only write back if the card still exists and its request is
      // still current (same source text + target lang). Prevents a stale
      // translation from overwriting a fresher edit.
      const latest = await db.cards.get(cardId);
      if (!latest) return;
      if (latest.sourceText !== text || latest.targetLang !== targetLang) return;
      await db.cards.update(cardId, {
        targetText: translated,
        translationStatus: 'done',
        updatedAt: Date.now(),
      });
    })
    .catch(async (err) => {
      console.error('Translation failed:', err);
      const latest = await db.cards.get(cardId);
      if (!latest) return;
      if (latest.sourceText !== text || latest.targetLang !== targetLang) return;
      await db.cards.update(cardId, {
        translationStatus: 'error',
        updatedAt: Date.now(),
      });
    });
}

/** Delete a card everywhere: cards table + all snapshot layouts. */
export async function deleteCard(cardId) {
  await db.transaction('rw', db.cards, db.snapshots, async () => {
    await db.cards.delete(cardId);
    const snapshots = await db.snapshots.toArray();
    for (const snap of snapshots) {
      const layout = cloneLayout(snap.layout);
      let changed = false;
      const before = layout.unplacedCardIds.length;
      layout.unplacedCardIds = layout.unplacedCardIds.filter((id) => id !== cardId);
      if (layout.unplacedCardIds.length !== before) changed = true;
      for (const col of layout.columns) {
        const b = col.cardIds.length;
        col.cardIds = col.cardIds.filter((id) => id !== cardId);
        if (col.cardIds.length !== b) changed = true;
      }
      if (changed) {
        await db.snapshots.update(snap.id, { layout, updatedAt: Date.now() });
      }
    }
  });
}

// ============================================================
// Snapshots
// ============================================================

/**
 * Create a new snapshot. All existing cards become unplaced in it by
 * default so switching to it shows every idea, ready to be re-sorted
 * under the new frame.
 */
export async function createSnapshot(name, columnNames = ['Column 1']) {
  const id = uid('snap');
  const now = Date.now();

  const allCards = await db.cards.toArray();
  const allCardIds = allCards.map((c) => c.id);

  const snapshot = {
    id,
    name: (name && name.trim()) || 'Untitled',
    layout: {
      columns: columnNames.map((n) => ({ id: uid('col'), name: n, cardIds: [] })),
      unplacedCardIds: allCardIds,
    },
    createdAt: now,
    updatedAt: now,
  };

  await db.snapshots.add(snapshot);
  await setSetting('currentSnapshotId', id);
  return id;
}

export async function renameSnapshot(snapshotId, newName) {
  const trimmed = (newName || '').trim();
  if (!trimmed) return;
  await db.snapshots.update(snapshotId, { name: trimmed, updatedAt: Date.now() });
}

export async function deleteSnapshot(snapshotId) {
  // Wrap delete + currentSnapshot fallback + proposal cascade in one
  // transaction so `useLiveQuery` never sees an intermediate state
  // where the current snapshot points at a deleted row, or proposals
  // exist without their parent snapshot.
  await db.transaction(
    'rw',
    db.snapshots,
    db.settings,
    db.proposals,
    async () => {
      const all = await db.snapshots.toArray();
      if (all.length <= 1) return; // never delete the last one

      await db.snapshots.delete(snapshotId);

      // Cascade: a proposal without its parent snapshot is meaningless.
      await db.proposals.where('snapshotId').equals(snapshotId).delete();

      const currentRow = await db.settings.get('currentSnapshotId');
      if (currentRow?.value === snapshotId) {
        const remaining = all.filter((s) => s.id !== snapshotId);
        await db.settings.put({
          key: 'currentSnapshotId',
          value: remaining[0].id,
        });
      }
    }
  );
}

export async function switchSnapshot(snapshotId) {
  await setSetting('currentSnapshotId', snapshotId);
}

// ============================================================
// Columns (scoped to a snapshot)
// ============================================================

export async function addColumn(snapshotId, name) {
  const snap = await db.snapshots.get(snapshotId);
  if (!snap) return;
  const layout = cloneLayout(snap.layout);
  layout.columns.push({
    id: uid('col'),
    name: (name && name.trim()) || 'New Column',
    cardIds: [],
  });
  await db.snapshots.update(snapshotId, { layout, updatedAt: Date.now() });
}

export async function renameColumn(snapshotId, columnId, newName) {
  const trimmed = (newName || '').trim();
  if (!trimmed) return;
  const snap = await db.snapshots.get(snapshotId);
  if (!snap) return;
  const layout = cloneLayout(snap.layout);
  const col = layout.columns.find((c) => c.id === columnId);
  if (!col) return;
  col.name = trimmed;
  await db.snapshots.update(snapshotId, { layout, updatedAt: Date.now() });
}

export async function deleteColumn(snapshotId, columnId) {
  const snap = await db.snapshots.get(snapshotId);
  if (!snap) return;
  const layout = cloneLayout(snap.layout);
  const col = layout.columns.find((c) => c.id === columnId);
  if (!col) return;
  // Return cards to the unplaced pool instead of deleting them.
  layout.unplacedCardIds.push(...col.cardIds);
  layout.columns = layout.columns.filter((c) => c.id !== columnId);
  await db.snapshots.update(snapshotId, { layout, updatedAt: Date.now() });
}

/**
 * Reorder the columns of a snapshot. Moves the column at `fromIndex` to
 * `toIndex` (both zero-based, within the current `layout.columns` array).
 * No-op if either index is out of bounds or they're the same.
 */
export async function reorderColumns(snapshotId, fromIndex, toIndex) {
  const snap = await db.snapshots.get(snapshotId);
  if (!snap) return;
  const layout = cloneLayout(snap.layout);
  const n = layout.columns.length;
  if (
    fromIndex < 0 ||
    fromIndex >= n ||
    toIndex < 0 ||
    toIndex >= n ||
    fromIndex === toIndex
  ) {
    return;
  }
  const [moved] = layout.columns.splice(fromIndex, 1);
  layout.columns.splice(toIndex, 0, moved);
  await db.snapshots.update(snapshotId, { layout, updatedAt: Date.now() });
}

// ============================================================
// Placement (drag-and-drop results)
// ============================================================

/**
 * Move a card to a given container at a given index.
 *
 * @param {string} snapshotId
 * @param {string} cardId
 * @param {string} toContainerId  column id, or the literal string 'unplaced'
 * @param {number|null} toIndex   index within the container, or null for "end"
 */
export async function placeCard(snapshotId, cardId, toContainerId, toIndex = null) {
  const snap = await db.snapshots.get(snapshotId);
  if (!snap) return;
  const layout = cloneLayout(snap.layout);

  // Remove from current position (wherever it is).
  layout.unplacedCardIds = layout.unplacedCardIds.filter((id) => id !== cardId);
  for (const col of layout.columns) {
    col.cardIds = col.cardIds.filter((id) => id !== cardId);
  }

  // Insert into the target.
  if (toContainerId === 'unplaced') {
    if (toIndex == null || toIndex >= layout.unplacedCardIds.length) {
      layout.unplacedCardIds.push(cardId);
    } else {
      layout.unplacedCardIds.splice(Math.max(0, toIndex), 0, cardId);
    }
  } else {
    const col = layout.columns.find((c) => c.id === toContainerId);
    if (col) {
      if (toIndex == null || toIndex >= col.cardIds.length) {
        col.cardIds.push(cardId);
      } else {
        col.cardIds.splice(Math.max(0, toIndex), 0, cardId);
      }
    } else {
      // Target column no longer exists; fall back to unplaced so the card
      // is never lost.
      layout.unplacedCardIds.push(cardId);
    }
  }

  await db.snapshots.update(snapshotId, { layout, updatedAt: Date.now() });
}

// ============================================================
// Proposals (Gemini-generated "project idea" reports)
// ============================================================

/**
 * Create a placeholder proposal row in `loading` state, kick off the
 * Gemini call, and fill the row in (or flip it to `error`) when the
 * response comes back.
 *
 * Returns the placeholder id synchronously so the UI can immediately
 * select/open the new proposal and show a loading state. The actual
 * content fills in reactively via `useLiveQuery`.
 *
 * Only cards that are *placed in a column* are sent to Gemini — the
 * unplaced pool is intentionally ignored. The idea: the act of sorting
 * is the signal, and unplaced cards haven't been judged yet.
 */
export async function generateProposal(snapshotId) {
  const snap = await db.snapshots.get(snapshotId);
  if (!snap) throw new Error('Snapshot not found');

  // Build a cardId -> card map for just the cards this snapshot
  // references, so we don't pull the whole `cards` table.
  const neededIds = new Set();
  for (const col of snap.layout.columns) {
    for (const id of col.cardIds) neededIds.add(id);
  }
  const cardRows = await db.cards.bulkGet([...neededIds]);
  const cardsMap = new Map();
  for (const c of cardRows) {
    if (c) cardsMap.set(c.id, c);
  }

  const layoutSnapshot = buildLayoutSnapshot(
    snap.name,
    snap.layout.columns,
    cardsMap
  );

  if (layoutSnapshot.totalCards === 0) {
    throw new Error('尚未把任何卡片放進欄位，先把一些想法拖進欄位吧。');
  }

  // Pull recent proposals for this snapshot so we can ask Gemini to
  // avoid repeating past angles. Cap at 5 (plenty of signal, tiny
  // prompt cost).
  const priorDone = (
    await db.proposals.where('snapshotId').equals(snapshotId).toArray()
  )
    .filter((p) => p.status === 'done' && p.content)
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, 5)
    .map((p) => ({
      title: p.content.title,
      rationale: p.content.rationale,
    }));

  const id = uid('prop');
  const now = Date.now();
  const placeholder = {
    id,
    snapshotId,
    snapshotName: snap.name,
    status: 'loading',
    createdAt: now,
    model: 'gemini-2.5-flash',
    layoutSnapshot, // frozen at generation time — NEVER mutate
    content: null,
    error: null,
  };
  await db.proposals.add(placeholder);

  // Fire and forget — UI picks up the result via useLiveQuery.
  callGeminiForProposal(layoutSnapshot, priorDone)
    .then(async (content) => {
      await db.proposals.update(id, {
        status: 'done',
        content,
      });
    })
    .catch(async (err) => {
      console.error('Proposal generation failed:', err);
      await db.proposals.update(id, {
        status: 'error',
        error: String(err?.message || err),
      });
    });

  return id;
}

export async function deleteProposal(proposalId) {
  await db.proposals.delete(proposalId);
}
