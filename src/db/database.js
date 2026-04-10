import Dexie from 'dexie';

/**
 * Local-first storage using IndexedDB via Dexie.
 *
 * Schema notes
 * ------------
 * - `cards` is the source of truth for card *content*. Cards are identified
 *   by a stable id and shared across all snapshots. Edits to text or
 *   translation automatically propagate because every snapshot references
 *   cards by id only.
 * - `snapshots` stores one categorization "view" per row. Each snapshot
 *   owns its own `layout` JSON, which contains:
 *     {
 *       columns: [{ id, name, cardIds: [cardId, ...] }, ...],
 *       unplacedCardIds: [cardId, ...]
 *     }
 *   The same card id may appear in different columns across different
 *   snapshots. The layout only stores references, never card content.
 * - `settings` is a simple key/value bag for UI-level state that needs to
 *   survive reloads (current snapshot, default languages, seeded flag).
 * - `proposals` is Gemini-generated "project idea" reports, one row per
 *   generation. Every proposal belongs to a snapshot (`snapshotId`) and
 *   freezes a *snapshot-of-the-snapshot* in `layoutSnapshot`: the column
 *   names + the plain text of every placed card at the moment of
 *   generation. This is deliberate — it lets the user keep re-arranging
 *   the board without past proposals becoming meaningless. Proposals
 *   are derived artifacts, NOT ideas, which is why they live in their
 *   own table (mixing them into `cards` would break the "every card
 *   appears exactly once per snapshot" invariant).
 *
 * Integrity
 * ---------
 * - Deleting a card removes it from `cards` AND sweeps every snapshot's
 *   layout to remove stale references. Proposals are NOT touched — they
 *   intentionally freeze card text at generation time.
 * - Deleting a column moves its cards back to `unplacedCardIds` so they
 *   are never silently lost.
 * - Deleting a snapshot never touches cards, but DOES cascade-delete
 *   any proposals that belonged to it — a proposal without its parent
 *   snapshot is meaningless and would just be dead weight.
 * - Layout reads tolerate stale card ids as a safety net.
 */
export const db = new Dexie('IdeaSortingBoard');

db.version(1).stores({
  cards: 'id, createdAt',
  snapshots: 'id, createdAt',
  settings: 'key',
});

// v2: add `proposals` table. Indexed by `snapshotId` so we can pull the
// history for a given snapshot cheaply, and by `createdAt` so we can
// order newest-first. Dexie migrations are additive-safe: bumping to v2
// on an existing v1 database just creates the new table.
db.version(2).stores({
  cards: 'id, createdAt',
  snapshots: 'id, createdAt',
  settings: 'key',
  proposals: 'id, snapshotId, createdAt',
});

export async function getSetting(key, fallback = null) {
  const row = await db.settings.get(key);
  return row ? row.value : fallback;
}

export async function setSetting(key, value) {
  await db.settings.put({ key, value });
}
