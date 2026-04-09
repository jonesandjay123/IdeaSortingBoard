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

- **Running on the real machine.** Dev server has been started,
  Gemini 2.5 Flash translation is verified working with a real key.
  The user has been iterating on UX in the browser and the Cowork
  sessions only make edits against a real, running app now.
- **Committed so far:** initial scaffold → Gemini integration →
  first CSS pass (violet palette, side-panel drag-resize, centered
  board, widened columns, inline "+ Add column" slot, dark mode as
  default).
- **Pending commit at time of writing (session 2026-04-09 evening):**
  - `DragOverlay` has `dropAnimation={null}` — kills the jarring
    "replay the trip" snap-back the library does by default when you
    drop a card.
  - Columns are now drag-reorderable via a dedicated grip rail at
    the very top of each column (new `.column-drag-rail` element,
    only that element carries the sortable listeners so nothing in
    the column body can accidentally start a column drag).
  - Card palette switched to deep burnt-orange so cards pop against
    the violet board.
- **Sandbox caveat:** the Cowork sandbox cannot reach
  `registry.npmjs.org` (E403), so I can't run `npm install` or
  `npm run dev` in here. I only syntax-check with the globally
  installed esbuild and rely on the user to reload their dev server.
  If you're Claude Code on the real machine, you can actually run the
  app — please do.

### First things to do in the CLI

```bash
cd <path to IdeaSortingBoard>
npm install
cp .env.example .env
# edit .env and paste your Gemini API key into VITE_GEMINI_API_KEY
npm run dev
# open http://localhost:5173
```

Expected on first load: 5 Traditional Chinese demo cards sitting in the
right-side "card pool", three seeded snapshots in the dropdown
(`Yes / No`, `Easy / Medium / Hard / Impossible`, `Now / Later / Never`).
Dark theme by default. Drag cards between columns; switch snapshots with
the dropdown; `+` in the side panel opens the create-card modal.

Cards that already have a `targetLang` set will translate via Gemini as
soon as they're created or edited. Without a valid
`VITE_GEMINI_API_KEY`, `runTranslation` in `actions.js` catches the
thrown error and flips the card's `translationStatus` to `"error"` — the
card itself still works, it just shows "Translation failed" underneath.

Likely bugs that still need real-browser eyes:

- dnd-kit cross-container drop indices (insertion index off-by-one cases
  when dropping at the end of a non-empty column)
- Column reorder edge cases: dropping a column "past" the last column
  and landing on the "+ Add column" slot instead of another column
  (the slot is not a sortable, so it should be a safe no-op, but
  verify)
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
│   └── translationService.js  Gemini 2.5 Flash translate() via @google/genai
├── lib/
│   ├── seedData.js            First-run defaults (deduped via seedPromise)
│   └── theme.js               localStorage-backed dark/light toggle
├── components/
│   ├── Board.jsx              DndContext + horizontal SortableContext for
│   │                          columns + custom collisionDetection + dragEnd
│   │                          routing (card vs column) + inline "+ Add column"
│   ├── Toolbar.jsx            Snapshot selector + theme toggle + add/rename/delete
│   ├── Column.jsx             Sortable column (useSortable w/ data:{type:'column'})
│   │                          + top drag-rail grip + nested vertical
│   │                          SortableContext for its cards
│   ├── Card.jsx               Sortable card (data:{type:'card'}) + CardPreview
│   │                          used by DragOverlay
│   ├── SidePanel.jsx          Right-side unplaced-cards pool; useDroppable with
│   │                          data:{type:'unplaced'}; drag-to-resize handle
│   │                          (width persisted in localStorage)
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
  Currently Gemini 2.5 Flash via `@google/genai`. If you swap providers,
  **only** replace the body of `translate()` and keep the signature.
  `actions.js` has a stale-response guard that compares `sourceText` and
  `targetLang` before writing back, so slow translations can't clobber
  fresh edits — preserve that behavior.
- **API key comes from `import.meta.env.VITE_GEMINI_API_KEY`.** Vite only
  exposes env vars with the `VITE_` prefix to client code. In the browser
  there is no `process.env`, so we pass the key explicitly into
  `new GoogleGenAI({ apiKey })` — do not remove that. The key ends up in
  the shipped JS bundle, which is fine for local/classroom use but a
  security issue if the app is ever publicly hosted — in that case, move
  the API call behind a server/edge function.

## Drag-and-drop notes (the easy place to break things)

The DnD architecture now handles **two different kinds of drags** in
the same `DndContext` — cards and columns — and most of the gotchas
come from that split. Read this section before touching anything in
`Board.jsx`, `Column.jsx`, or `Card.jsx`.

### Type tagging

Every sortable/droppable passes a `data: { type: '...' }` to dnd-kit:

- `Card.jsx` → `useSortable({ id: card.id, data: { type: 'card' } })`
- `Column.jsx` → `useSortable({ id: column.id, data: { type: 'column' } })`
- `SidePanel.jsx` → `useDroppable({ id: 'unplaced', data: { type: 'unplaced' } })`

`Board.jsx` branches on `active.data.current?.type` in `handleDragStart`
and `handleDragEnd`. If you add a new droppable, **always** tag it with
a type, or the custom collision filter will ignore it (see below).

### Custom collision detection

Because cards and columns are in the same DndContext, a naive
`closestCorners` would let a column-drag latch onto a card (bad) or
onto the "unplaced" pool (worse). `Board.jsx` defines a
`collisionDetection` callback that:

- When `active.data.current.type === 'column'`, pre-filters
  `droppableContainers` to only those with `type === 'column'`, then
  runs `closestCorners`. Columns can only collide with other columns.
- Otherwise (card drag) runs `closestCorners` on everything. Card
  behavior is unchanged from the pre-column-reorder days.

### Column reorder (horizontal)

- `Board.jsx` wraps the column map in a `SortableContext` with
  `horizontalListSortingStrategy` and column IDs as items.
- Columns are **not** cloned into a `DragOverlay` — the column div
  itself carries the dnd-kit transform and slides under the cursor.
  That's why the `DragOverlay` content is gated on
  `activeType === 'card'`.
- `handleDragEnd` has a dedicated column branch that calls the new
  `reorderColumns(snapshotId, fromIndex, toIndex)` action in
  `actions.js`.
- The only element that carries the column sortable's `{...listeners}`
  `{...attributes}` is `.column-drag-rail` at the top of the column.
  Everything else inside the column (header, rename, delete, cards,
  scrollbars) is outside the listener scope so you can't accidentally
  drag a whole column by clicking inside it. If you add a new
  interactive element to the column, keep it outside the rail, not
  inside it.

### Card DnD (mostly unchanged)

- Cards still use `useSortable` with `verticalListSortingStrategy`
  nested inside each column and inside the side panel.
- Card action buttons (edit / delete) live **outside** the drag
  listeners — see `.card-drag-handle` vs `.card-action-bar` in
  `Card.jsx`. If you rearrange that, test that clicking the buttons
  doesn't start a drag.
- `over.id` from dnd-kit can be either a container id (column id or
  `"unplaced"`) or a card id. `Board.jsx`'s `resolveContainerFromOverId`
  handles both cases. If you add a new droppable, it must handle being
  the target of both "drop on empty container" and "drop on a card
  inside it".
- `placeCard()` in `actions.js` removes the card from wherever it is
  and re-inserts into the target. `toIndex === null` means "append".
  If `toContainerId` is missing, the card falls back to
  `unplacedCardIds` so it's never lost.

### Drop animation

- `<DragOverlay dropAnimation={null}>`. The default dnd-kit behavior
  is to animate the overlay from the cursor back to the sortable
  node's resting position when you drop — which across containers
  looks exactly like "replaying the trip", and the user found it
  disorienting. `null` disables it; the overlay just vanishes and
  the next Dexie-driven re-render places the card at its new home.
- **Do not re-enable drop animation** without the user's say-so.

### Sensors

- `PointerSensor` with `activationConstraint: { distance: 6 }` so
  click-throughs (edit/delete buttons, rename, column grip taps) don't
  start drags. `KeyboardSensor` uses `sortableKeyboardCoordinates` for
  accessibility.

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

### Dark palette shape (matters for anyone editing colors)

- **Board/surface layers (deep violet):** `--color-bg` `#13111c` →
  `--color-surface` `#1d1a2e` → `--color-column-bg` `#221d38`. Three
  luminance stops so the hierarchy reads cleanly without much
  contrast.
- **Brand (violet-500ish):** `--color-primary` `#8b5cf6`, hover
  `--color-primary-hover` `#a78bfa`, soft tint `--color-primary-soft`
  `rgba(139,92,246,0.22)`.
- **Cards (deep burnt orange — intentional warm-on-cool):**
  `--color-card-bg` `#5a2d15`, hover `--color-card-bg-hover`
  `#6b3419`, border `--color-card-border` `#7a3b1a`. Dividers *inside*
  the card (`.card-translation` border-top, `.card-action-bar`
  border-top) use `--color-card-border` — do **not** swap them for
  the generic `--color-border`, it reads as a muddy gray stripe on
  orange.
- **Light theme** does not inherit the orange. It overrides
  `--color-card-bg` to white (`#ffffff`), `--color-card-bg-hover` to
  `#f9fafb`, `--color-card-border` to `#e4e7ec`. If you add new
  `--color-card-*` variables in dark, add the corresponding light
  overrides in the same commit.

## Pending TODOs (roughly in order of likely next steps)

1. **Real-browser smoke test of the latest changes** — Gemini is
   confirmed working, but the column drag-rail, the
   `dropAnimation={null}` drop, and the orange palette all still need
   a pair of human eyes to check for edge cases. Specifically:
   - Drag Yes and No past each other and back. Nothing should look
     like a replay; column transforms should feel snappy.
   - Drag a card across containers. Make sure the overlay vanishes at
     the cursor cleanly and the card appears in the new column at
     the expected index.
   - Drag a column onto the "+ Add column" slot. It's not a sortable,
     so it should be a no-op; verify nothing crashes.
2. **Classroom iteration.** Things that might come up once the student
   actually uses it:
   - Bigger / larger-font cards for projector visibility
   - Export a snapshot as an image (for recap slides)
   - "Reset this snapshot" button (move all cards back to unplaced) —
     cheap feature with `placeCard`
   - Drag cards directly between snapshots (probably not — it would
     break the "same pile, different lens" mental model)
3. **Empty states**: the side panel and columns have basic empty
   states, and the board as a whole effectively has one via the
   inline "+ Add column" slot (visible even when there are zero real
   columns). All three are intentionally minimal.
4. **Gemini prompt polish** if you see the model adding stray quotes
   or preambles — the translator already strips wrapping quotes, but
   the prompt wording may need tuning per language pair.

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

Last updated by: Cowork Claude session, 2026-04-09 (evening —
after adding column drag-reorder + `dropAnimation={null}` + deep
orange card palette).
