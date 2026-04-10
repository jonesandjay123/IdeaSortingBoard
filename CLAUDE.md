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
  default) → column drag-reorder via top grip rail +
  `DragOverlay dropAnimation={null}` (kills the snap-back replay) +
  burnt-orange cards → **palette + card-text refresh (session
  2026-04-10)**: pushed bg/columns slightly more violet, lifted
  cards from muddy `#5a2d15` burnt-brown to terracotta `#964419`,
  introduced a card-aware text/badge scale (`--color-card-text`,
  `--color-card-text-muted`, `--color-card-badge-bg`, etc.) so card
  text is pure white in dark mode without affecting light mode, and
  switched the language label from a heavy violet block to a soft
  rounded pill. Source and translation are now the same font size;
  hierarchy comes from white-alpha, not size.
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

Four Dexie tables (db version **2**):

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
4. **`proposals`** — Gemini-generated "抽企劃卡" project suggestions.
   One row per generation. See the "Proposals" section below for the
   full shape and invariants.

**Invariants that must hold at all times:**

- The same card can appear in **different columns across different
  snapshots**. Snapshots are views; cards are the truth.
- Every existing card must appear **exactly once** in each snapshot —
  either in one column's `cardIds` or in `unplacedCardIds`. `createCard`
  and `deleteCard` enforce this. If you add another mutation, you must
  maintain this.
- `currentSnapshotId` must always point at a snapshot that still exists.
  `deleteSnapshot` wraps this in a transaction to avoid a "pointing at a
  deleted row" moment that `useLiveQuery` could observe. The same
  transaction **cascade-deletes** that snapshot's proposals, because a
  proposal without its parent snapshot is meaningless.
- **Proposals freeze their input.** Every proposal row stores a
  `layoutSnapshot` — a plain copy of the column names and the
  `sourceText` of each placed card at generation time. Do NOT
  retroactively rewrite it when cards or snapshots change. The user
  is supposed to be able to re-arrange the board and still read old
  proposals with their original "this is what I was looking at"
  context. `deleteCard` intentionally does NOT sweep proposals.
- Seeding is **idempotent and deduped** — `seedData.js` uses a
  module-level `seedPromise` to survive React 18 StrictMode's
  double-invoke of `useEffect`. Don't collapse this.

### Proposals table — shape

```
{
  id:             string,
  snapshotId:     string,       // parent snapshot
  snapshotName:   string,       // cached at generation time
  status:         'loading' | 'done' | 'error',
  createdAt:      number,
  model:          string,       // e.g. 'gemini-2.5-flash'
  layoutSnapshot: {              // frozen — never mutated
    snapshotName: string,
    totalCards:   number,
    columns: [{ name: string, cards: string[] }]
  },
  userGuidance:   null | string, // free-form steering the user typed/spoke
                                 // for THIS roll. null = default creative
                                 // spin, string = hard directional override
                                 // that was injected into the Gemini prompt.
                                 // Stored so the reader can display it as
                                 // "🎯 你的引導" on historical proposals.
  content: null | {
    title:     string,
    rationale: string,
    mvp:       string[],         // 3 bullets
    whyNow:    string,           // one sentence
    tags:      string[]          // 2-4
  },
  error: null | string
}
```

- `generateProposal(snapshotId)` in `actions.js` writes the row in
  `loading` state, fires the Gemini call, and flips the row to
  `done` / `error` when the response arrives. The UI picks up the
  state change via `useLiveQuery`.
- **Unplaced cards are intentionally excluded from the prompt.** The
  whole point of the feature is "judge the user's *sorting* as a
  signal", so a card that hasn't been placed into any column doesn't
  count. If you add a future "include pool too" toggle, do it in
  `proposalService.buildLayoutSnapshot` — NOT by mutating the
  frozen `layoutSnapshot` of existing rows.
- `generateProposal` also pulls the 5 most recent `done` proposals
  for the same snapshot and sends their titles + one-line rationales
  to Gemini as an "avoid these angles" list. This is what makes
  "反覆刷反覆抽卡" actually feel like a re-roll instead of a
  re-phrasing. Temperature is set to 1.1 on the Gemini call for the
  same reason.

## File map (where does X live)

```
src/
├── main.jsx                   React entry
├── App.jsx                    Seeding gate (awaits ensureSeeded) + mounts <Board>
├── db/
│   ├── database.js            Dexie schema (v2, adds `proposals`) + getSetting/setSetting
│   └── actions.js             EVERY mutation (cards, snapshots, columns, placement, proposals)
├── services/
│   ├── translationService.js  Gemini 2.5 Flash translate() via @google/genai
│   └── proposalService.js     Gemini 2.5 Flash generateProposal() + buildLayoutSnapshot()
├── lib/
│   ├── seedData.js            First-run defaults (deduped via seedPromise)
│   ├── theme.js               localStorage-backed dark/light toggle
│   └── useSpeechRecognition.js  Chrome Web Speech API hook (no tokens, no deps)
├── components/
│   ├── Board.jsx              DndContext + horizontal SortableContext for
│   │                          columns + custom collisionDetection + dragEnd
│   │                          routing (card vs column) + inline "+ Add column"
│   │                          + owns ProposalModal open state
│   ├── Toolbar.jsx            Snapshot selector + theme toggle + add/rename/delete
│   │                          + 💡 Proposals button
│   ├── Column.jsx             Sortable column (useSortable w/ data:{type:'column'})
│   │                          + top drag-rail grip + nested vertical
│   │                          SortableContext for its cards
│   ├── Card.jsx               Sortable card (data:{type:'card'}) + CardPreview
│   │                          used by DragOverlay
│   ├── SidePanel.jsx          Right-side unplaced-cards pool; useDroppable with
│   │                          data:{type:'unplaced'}; drag-to-resize handle
│   │                          (width persisted in localStorage)
│   ├── CardModal.jsx          Create/edit modal (⌘/Ctrl+Enter submits, Esc closes)
│   │                          + mic button backed by useSpeechRecognition
│   └── ProposalModal.jsx      Full-screen "project proposals" reader: left
│                              history list (click to open, × to delete),
│                              right article reader, 🎲 "抽一張新的" button
│                              that calls generateProposal(snapshotId)
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

- **Board/surface layers (deep violet):** `--color-bg` `#171327` →
  `--color-surface` `#221c38` → `--color-surface-raised` `#2e2747` →
  `--color-column-bg` `#2a2348`. Four luminance stops so the
  hierarchy reads cleanly. The whole stack is intentionally pushed a
  little more saturated/violet (vs. neutral near-black) so the brand
  violet shows up at rest, not only on hover. Borders sit on the
  same scale: `--color-border` `#38305a`, `--color-border-strong`
  `#4d4378`.
- **Brand (violet-500ish):** `--color-primary` `#8b5cf6`, hover
  `--color-primary-hover` `#a78bfa`, soft tint `--color-primary-soft`
  `rgba(139,92,246,0.22)`. Used for the toolbar primary button,
  focus rings, hover states, and the column drag-rail's "lit" state.
- **Cards (terracotta — intentional warm-on-cool):**
  `--color-card-bg` `#964419`, hover `--color-card-bg-hover`
  `#ad5220`, border `--color-card-border` `#d97a3a` (vivid rust that
  works as a glow against the violet board). The base is tuned dark
  enough that pure white text gets ~7:1 contrast — if you push it
  brighter than `~#a04a1c` the white text starts to wash out.
- **Card-aware text scale (DO NOT use the global `--color-text*` on
  cards).** The global text scale has a violet tint that reads grey
  on orange. Cards use their own scale, which is hardcoded to white
  in dark mode and falls back to the regular grey scale in light
  mode (where cards are white):
  - `--color-card-text` — main source text (`#ffffff` dark / `#1a1d23`
    light). Used by `.card-text`. Source and translation are now the
    **same font size** (`14.5px`); hierarchy comes from this color
    scale, not from font size.
  - `--color-card-text-muted` — translation text (`rgba(255,255,255,
    0.78)` dark). Used by `.card-translation`. If the user wants the
    translation more prominent push toward `0.85`; less prominent
    toward `0.7`.
  - `--color-card-text-subtle` — "Translating…" loading state.
- **Card-aware badge tag.** `--color-card-badge-bg`
  `rgba(0,0,0,0.28)` + `--color-card-badge-text`
  `rgba(255,255,255,0.88)`. Used by `.card-lang-badge`, which is now
  a small rounded pill (`border-radius: 999px`), not the previous
  square violet block. Works on both the orange dark card and the
  white light card without per-theme branching beyond the variable
  values.
- **Card-aware veils for dividers / hover surfaces.**
  `--color-card-veil` `rgba(0,0,0,0.18)` and
  `--color-card-veil-strong` `rgba(0,0,0,0.30)`. Used by
  `.card-translation`'s top divider, `.card-action-bar`'s
  background + top divider, and `.card-action-btn:hover`'s
  background. These replaced the older choice of using
  `--color-card-border` (rust) for in-card dividers — the rust line
  was competing with the card's outer border for attention. Veils
  are neutral so they don't muddy the orange.
- **Light theme** does not inherit the orange. It overrides
  `--color-card-bg` to white (`#ffffff`), `--color-card-bg-hover` to
  `#f9fafb`, `--color-card-border` to `#e4e7ec`, and the entire
  card-text / card-badge / card-veil scale falls back to the
  regular neutral grey scale. **If you add a new `--color-card-*`
  variable in dark, add the corresponding light override in the
  same commit.**

## Proposals feature ("抽企劃卡")

Main teaching extension shipped 2026-04-10. Lets the user press a
button in the toolbar and have Gemini read the current snapshot's
**placed** cards (NOT the unplaced pool) and produce a concrete
project-idea report: title, rationale, 3 MVP bullets, a "why now"
line, and 2–4 tags. Each press creates a new `proposals` row; the
history is kept so the user can reread, compare, and re-roll.

Invariants / gotchas:

- **Frozen input.** Every proposal stores a `layoutSnapshot` at
  generation time. Reader renders that snapshot at the bottom under
  "根據當時 board 上的這些卡片" so the user can always see what the
  board looked like when the suggestion was made. Do not recompute
  that from live data — the point is that it survives later edits.
- **Don't sweep on card delete.** `deleteCard` leaves proposals
  alone. `deleteSnapshot` DOES cascade-delete proposals for that
  snapshot (inside the same transaction).
- **Avoid-repeat prompting.** `generateProposal` pulls the last 5
  `done` proposals for the same snapshot and sends their title +
  rationale as "AVOID these angles". Combined with temperature 1.3,
  this is what makes re-rolls feel like re-rolls instead of
  paraphrases.
- **Creative prompt, not literal.** The base prompt was rewritten
  after the first live test showed Gemini producing boring literal
  concatenations of the cards ("your cards are about Gemma + Pi +
  low-latency, so: low-latency voice assistant on a Pi"). The
  current prompt explicitly asks for a NON-OBVIOUS angle: unusual
  target user, metaphor, cross-domain mashup, or playful reframing.
  At least one twist dimension must be present. Temperature is
  1.3 (was 1.1) to give the creative instructions room to act.
- **Optional user guidance (steering).** ProposalModal has a
  textarea + mic below the spin button. If the user types (or
  speaks) something like "做成給長輩用的" or "變成一個絕對不插電
  的玩具", it gets passed as `userGuidance` through
  `generateProposal(snapshotId, userGuidance)` → proposalService,
  where it's injected into the Gemini prompt as a STRONG
  directional override (not a soft hint). The value is stored on
  the proposal row so the reader can display "🎯 你的引導" on any
  historical proposal that was steered. Empty = default creative
  behavior. Cleared after each successful spin so the user doesn't
  accidentally re-apply last round's steering.
- **Token cost is tiny.** Typical prompt < 2 KB, response < 2 KB.
  Fine to spam.

## Voice input (mic button in CardModal)

`src/lib/useSpeechRecognition.js` wraps Chrome's Web Speech API
(`webkitSpeechRecognition`). Chrome-only by design — no cross-browser
support fallback, no polyfill. Runs in-browser so it **does not
consume any Gemini / AI tokens**.

- Finalized chunks are appended to the textarea via an
  `onFinalChunk` callback; interim text is shown as a ghost line
  below the textarea so the user can still freely edit the
  already-finalized content without flicker.
- Recognition language is derived from the source-lang picker via
  `SPEECH_LANG_MAP` (`zh-Hant` → `zh-TW`, `ja` → `ja-JP`, etc).
  Changing source-lang mid-modal stops the current session.
- The mic button is only rendered when `window.SpeechRecognition ||
  window.webkitSpeechRecognition` exists, so other browsers just
  don't see it.
- If you need to replace the hook with a different STT backend,
  keep the same contract (`{ supported, listening, interim, error,
  start, stop, toggle }` + `onFinalChunk` callback).

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

Last updated by: Claude Code CLI session, 2026-04-10 — two new
features: (1) **proposals** — toolbar 💡 button opens a full-screen
modal where Gemini generates project-idea reports from the current
board's placed cards; each generation is saved into a new
`proposals` Dexie table (db v2), history list on the left with
delete, reader article on the right, 🎲 "抽一張新的" re-rolls with
an avoid-repeat list of prior angles fed back into the prompt.
(2) **voice input** — Chrome Web Speech API hook wired into
CardModal with a pulsing-red mic button; zero token cost.
