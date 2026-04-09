# CLAUDE.md — handoff notes for the next Claude session

> **Purpose:** keep continuity between Claude sessions (desktop Cowork
> session → Claude Code CLI on the real machine). Read this file first
> before touching anything. If you change an invariant listed here, update
> this file in the same commit.

## One-paragraph context

This is a **teaching tool**, not a product. The user (Jarvis) is teaching
his complete-beginner younger sister ("妹妹") "vibe coding" through
Antigravity. Each Session is 3 hours, every 3 weeks. In Session 5 we are
pivoting away from feature work on a DailyPlanner clone and toward
building **product intuition** — specifically, getting her to judge
feature difficulty ("easy / medium / hard / impossible") before asking
the AI to build anything. This app is the teaching prop for that lesson.

The killer move in the classroom: create idea cards once, then flip
between "snapshots" (Yes/No, Easy/Medium/Hard/Impossible, Now/Later/Never)
so the **same pile of ideas** keeps showing up under different classifying
questions.

## Current status

- **Built:** all source files written, data model settled, drag-and-drop
  logic done, dark mode default, seed data ready.
- **NOT built / NOT tested:** dependencies have never been installed and
  the dev server has never been run. I tried in the Cowork sandbox — it
  cannot reach `registry.npmjs.org` (E403). That's why we're handing off
  to the CLI.
- **Syntax-checked with esbuild**, so every `.jsx` and `.js` file parses,
  but that's it. No runtime verification.

### First things to do in the CLI

```bash
cd <path to IdeaSortingBoard>
npm install
npm run dev
# open http://localhost:5173
```

Expected on first load: 5 Traditional Chinese demo cards sitting in the
right-side "card pool", three seeded snapshots in the dropdown
(`Yes / No`, `Easy / Medium / Hard / Impossible`, `Now / Later / Never`).
Dark theme by default. Drag cards between columns; switch snapshots with
the dropdown; `+` in the side panel opens the create-card modal.

Likely bugs that need real-browser eyes:

- dnd-kit cross-container drop indices (insertion index off-by-one cases
  when dropping at the end of a non-empty column)
- Mobile / narrow-viewport layout (we only designed for desktop)
- IndexedDB first-run race if you open two tabs simultaneously (seed
  dedupe only covers one tab)
- Modal focus trap (textarea autofocuses but Tab still leaves the modal)

## Stack

- **React 18** + **Vite** (JSX, no TypeScript)
- **Dexie** (IndexedDB wrapper) + **`dexie-react-hooks`** for reactive
  reads via `useLiveQuery`
- **`@dnd-kit/core`** + **`@dnd-kit/sortable`** for multi-container
  drag-and-drop
- **Plain CSS** with CSS variables (no Tailwind, no preprocessor). Theme
  is controlled by `data-theme` on `<html>`

## Data model — invariants (read before touching `db/`)

Three Dexie tables:

1. **`cards`** — content of each idea card.
   `{ id, sourceLang, sourceText, targetLang, targetText, translationStatus, createdAt, updatedAt }`
2. **`snapshots`** — one row per classification frame. Stores a `layout`
   JSON:

   ```json
   {
     "columns": [
       { "id": "col_1", "name": "Yes", "cardIds": ["card_a"] }
     ],
     "unplacedCardIds": ["card_b", "card_c"]
   }
   ```

3. **`settings`** — key/value bag (`currentSnapshotId`,
   `defaultSourceLang`, `defaultTargetLang`, `seeded`).

**Invariants that must hold at all times:**

- The same card can appear in **different columns across different
  snapshots**. Snapshots are views; cards are the truth.
- Every existing card must appear **exactly once** in each snapshot —
  either in one column's `cardIds` or in `unplacedCardIds`. `createCard`
  and `deleteCard` enforce this. If you add another mutation, you must
  maintain this.
- `currentSnapshotId` must always point at a snapshot that still exists.
  `deleteSnapshot` wraps this in a transaction to avoid a "pointing at a
  deleted row" moment that `useLiveQuery` could observe.
- Seeding is **idempotent and deduped** — `seedData.js` uses a
  module-level `seedPromise` to survive React 18 StrictMode's
  double-invoke of `useEffect`. Don't collapse this.

## File map (where does X live)

```
src/
├── main.jsx                   React entry
├── App.jsx                    Seeding gate (awaits ensureSeeded) + mounts <Board>
├── db/
│   ├── database.js            Dexie schema + getSetting/setSetting helpers
│   └── actions.js             EVERY mutation (cards, snapshots, columns, placement)
├── services/
│   └── translationService.js  Abstracted translate() — swap for Gemini here
├── lib/
│   ├── seedData.js            First-run defaults (deduped via seedPromise)
│   └── theme.js               localStorage-backed dark/light toggle
├── components/
│   ├── Board.jsx              DndContext + drag handlers + top-level layout
│   ├── Toolbar.jsx            Snapshot selector + theme toggle + add/rename/delete
│   ├── Column.jsx             One useDroppable + SortableContext column
│   ├── Card.jsx               Sortable card + CardPreview (for DragOverlay)
│   ├── SidePanel.jsx          Right-side unplaced-cards pool (useDroppable)
│   └── CardModal.jsx          Create/edit modal (⌘/Ctrl+Enter submits, Esc closes)
└── styles/
    └── app.css                All styles; :root is DARK; [data-theme="light"] overrides
```

## Conventions (please respect)

- **Components never touch Dexie directly.** Reads go through
  `useLiveQuery`, writes go through exported functions in
  `src/db/actions.js`. If you need a new write, add it there.
- **Snapshots store layout only.** Card content goes in the `cards` table.
  Editing a card's text or translation does not touch any snapshot.
- **IDs are stable and opaque** (`card_<timestamp>_<rand>`, etc). Don't
  reuse them or parse them.
- **Hardcoded colors are a smell.** The theme is driven entirely by CSS
  variables declared in `:root` (dark) and `[data-theme="light"]`. If you
  find a hex or rgba in component CSS that isn't a variable, extract it.
- **No Tailwind, no CSS-in-JS.** Plain CSS on purpose, because this
  project is also a teaching artifact and the styles need to be readable
  by the student.
- **Translation is abstracted behind `src/services/translationService.js`.**
  Currently a mock. When swapping in Gemini, **only** replace the body of
  `translate()`. `actions.js` has a stale-response guard that compares
  `sourceText` and `targetLang` before writing back, so slow translations
  can't clobber fresh edits — preserve that behavior.

## Drag-and-drop notes (the easy place to break things)

- Top-level `<DndContext>` lives in `Board.jsx`. Collision detection is
  `closestCorners`. Sensors: `PointerSensor` with `distance: 6` (so
  clicks on action buttons inside cards don't start drags) and
  `KeyboardSensor`.
- Each column is a `useDroppable` **and** wraps its children in a
  `SortableContext` with `verticalListSortingStrategy`. The side panel
  is the same pattern with the droppable id `"unplaced"`.
- `over.id` from dnd-kit can be either a container id (column id or
  `"unplaced"`) or a card id. `Board.jsx`'s `resolveContainerFromOverId`
  handles both cases. If you add a new droppable, it must handle being
  the target of both "drop on empty container" and "drop on a card
  inside it".
- Card action buttons (edit / delete) live **outside** the drag listeners
  — see `.card-drag-handle` vs `.card-action-bar` in `Card.jsx`. If you
  rearrange that, test clicking the buttons without accidentally
  starting a drag.
- `placeCard()` in `actions.js` removes the card from wherever it is and
  re-inserts into the target. The `toIndex === null` path means
  "append". If `toContainerId` is missing, the card falls back to
  `unplacedCardIds` so it's never lost.

## Theme

- Default is **dark** (the user prefers dark for eye comfort).
- `index.html` has an inline bootstrap script that reads
  `localStorage.getItem('isb:theme')` **before** React mounts and sets
  `document.documentElement.dataset.theme`. Do not remove — without it,
  there's a flash of light theme on first paint.
- `src/lib/theme.js` exports `getStoredTheme`, `setStoredTheme`, and
  `toggleTheme`. The toolbar button is a thin wrapper around
  `toggleTheme()`.
- CSS: dark palette in `:root`, light overrides in `[data-theme="light"]`.
  Always write new styles using the variables, not hex values.

## Pending TODOs (roughly in order of likely next steps)

1. **`npm install && npm run dev`** on a real machine — first verification.
2. **Fix whatever breaks** in the first run. Most likely: dnd-kit index
   off-by-one edges, IndexedDB migration issues if you change the schema.
3. **Swap the mock translator for Gemini.** The user has done this before
   — they'll probably want to bring their own API key. Only edit the
   body of `translate()` in `translationService.js`. Don't change its
   signature.
4. **Classroom iteration.** Things that might come up once the student
   actually uses it:
   - Bigger / larger-font cards for projector visibility
   - Export a snapshot as an image (for recap slides)
   - "Reset this snapshot" button (move all cards back to unplaced) —
     cheap feature with `placeCard`
   - Drag cards directly between snapshots (probably not — it would
     break the "same pile, different lens" mental model)
5. **Empty states**: the side panel and columns have basic empty states,
   but the board has one for "no columns at all". All three are
   intentionally minimal.

## Things NOT to do

- **Don't add Tailwind** or any CSS framework. Plain CSS is a deliberate
  choice here.
- **Don't add a router.** This is a single page.
- **Don't add TypeScript** without the user asking. JSX-only is
  intentional — the student needs to be able to read everything.
- **Don't introduce a state-management library** (Redux, Zustand, Jotai).
  Reads come from `useLiveQuery`, writes go through `actions.js`. If you
  feel the need for a store, you're probably about to break an
  invariant.
- **Don't collapse `seedData.js`'s `seedPromise` dedupe.** It exists
  specifically to survive React 18 StrictMode's `useEffect` double-fire.
- **Don't rename files** without updating both `README.md` and this file
  in the same commit.

## Useful debugging moves

- To **wipe everything and re-seed**: DevTools → Application → IndexedDB
  → delete `IdeaSortingBoard` database → reload the page.
- To **inspect snapshots** from DevTools console:

  ```js
  const { db } = await import('/src/db/database.js');
  await db.snapshots.toArray();
  ```

- To **force a translation re-run**, edit the card (any change — even
  touching the source text and saving) — `updateCardText` re-runs
  translation when `sourceText` or `targetLang` changes.

---

Last updated by: Cowork Claude session, 2026-04-09
