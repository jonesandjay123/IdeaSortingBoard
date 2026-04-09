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
 *
 * Integrity
 * ---------
 * - Deleting a card removes it from `cards` AND sweeps every snapshot's
 *   layout to remove stale references.
 * - Deleting a column moves its cards back to `unplacedCardIds` so they
 *   are never silently lost.
 * - Deleting a snapshot never touches cards.
 * - Layout reads tolerate stale card ids as a safety net.
 */
export const db = new Dexie('IdeaSortingBoard');

db.version(1).stores({
  cards: 'id, createdAt',
  snapshots: 'id, createdAt',
  settings: 'key',
});

export async function getSetting(key, fallback = null) {
  const row = await db.settings.get(key);
  return row ? row.value : fallback;
}

export async function setSetting(key, value) {
  await db.settings.put({ key, value });
}
