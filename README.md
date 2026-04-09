# Idea Sorting Board

A single-page teaching tool for turning vague ideas into sortable, translatable
cards and dragging them across different categorization frames. Built for the
moment in a lesson when you want to ask "is this easy or hard?" without touching
any code.

## Run it

```bash
npm install
npm run dev
```

Open http://localhost:5173.

Data lives entirely in your browser (IndexedDB), so nothing leaves your machine.

## What the three default frames are for

On first load, three snapshots are seeded:

1. **Yes / No** — a binary warm-up. Good first question: "Could we even do this?"
2. **Easy / Medium / Hard / Impossible** — the main teaching frame. The goal is
   to build product intuition about feature difficulty. Drag each idea into its
   bucket; argue about borderline cases.
3. **Now / Later / Never** — a prioritization reframe. Same cards, new lens.

The killer move is switching between snapshots mid-conversation so the same
pile of ideas keeps showing up under different questions.

## Data model (why this doesn't break)

There are three logical tables in IndexedDB (via Dexie):

- `cards` — the source of truth for card content. Every card has a stable id.
  Editing text or translation only updates this table; all snapshots reflect
  the change because they reference cards by id.
- `snapshots` — one row per categorization view. Each stores its own `layout`
  JSON:

  ```json
  {
    "columns": [
      { "id": "col_1", "name": "Yes", "cardIds": ["card_a", "card_b"] },
      { "id": "col_2", "name": "No",  "cardIds": ["card_c"] }
    ],
    "unplacedCardIds": ["card_d"]
  }
  ```

  The same card can live in different columns across different snapshots.
- `settings` — small key/value bag (current snapshot id, default languages,
  seeded flag).

**Edge cases this design handles automatically**:

- Delete a card → removed from `cards`, all snapshots sweep their layouts.
- Delete a column → its cards fall back to `unplacedCardIds` in that snapshot
  only, so cards are never silently lost.
- Delete a snapshot → cards are untouched; current snapshot auto-switches to
  another.
- Rename anything → only touches one row; every reference is by id.
- Add a card → appears in the unplaced pool of every snapshot so switching
  frames shows the same pile.

## Translation (mock now, Gemini later)

`src/services/translationService.js` exports a single async function:

```js
translate(text, sourceLang, targetLang) => Promise<string>
```

The current implementation is a mock that waits 600–1300ms and returns a
labeled placeholder like `[日本語] …`, so the async "Translating…" state is
visible in the UI.

**To swap in Gemini**, replace only the body of `translate()`. The file has an
example call commented at the top. Nothing else in the app needs to change —
everything that needs translation goes through this one function, and there's
a stale-response guard in `actions.js` so a slow translation can't overwrite a
fresh edit.

Supported languages: `zh-Hant`, `zh-Hans`, `en`, `ja`. Add more by extending
`SUPPORTED_LANGUAGES` in the same file.

## Keyboard shortcuts

- **⌘/Ctrl + Enter** inside the new-card modal → submit
- **Esc** → close modal
- **Double-click** a column title → rename inline

## Project layout

```
src/
├── main.jsx                  React entry
├── App.jsx                   Seeding gate + mounts <Board>
├── db/
│   ├── database.js           Dexie schema + settings helpers
│   └── actions.js            Every mutation (cards, snapshots, columns, placement)
├── services/
│   └── translationService.js Abstracted translate() — swap for Gemini here
├── lib/
│   └── seedData.js           First-run defaults
├── components/
│   ├── Board.jsx             Top-level layout + DndContext + drag handlers
│   ├── Toolbar.jsx           Snapshot selector + add/rename/delete
│   ├── Column.jsx            One draggable-drop-target column
│   ├── Card.jsx              Sortable idea card + CardPreview for DragOverlay
│   ├── SidePanel.jsx         Right side "card pool" for unplaced ideas
│   └── CardModal.jsx         Create / edit modal
└── styles/
    └── app.css               All styles; theme via CSS variables at :root
```

## Stack

React 18 + Vite · Dexie (IndexedDB) + `dexie-react-hooks` for reactive reads ·
`@dnd-kit/core` + `@dnd-kit/sortable` for multi-container drag-and-drop ·
plain CSS with variables (easy to retheme, no Tailwind noise).

## Reset

If you want to wipe everything and re-seed, open the browser devtools →
Application → IndexedDB → delete `IdeaSortingBoard`, then reload.
