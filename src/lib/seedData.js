import { db, getSetting, setSetting } from '../db/database.js';

function uid(prefix) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function emptyLayout(columnNames) {
  return {
    columns: columnNames.map((name) => ({
      id: uid('col'),
      name,
      cardIds: [],
    })),
    unplacedCardIds: [],
  };
}

/**
 * First-run seeding. Creates three default snapshots that correspond to the
 * teaching frames this tool is built around:
 *
 *   1. Yes / No                            — the simplest binary filter
 *   2. Easy / Medium / Hard / Impossible   — feature-difficulty teaching
 *   3. Now / Later / Never                 — product prioritization
 *
 * A handful of example idea cards are added to every snapshot's unplaced
 * pool so the UI has something to show immediately.
 *
 * The module-level `seedPromise` dedupes concurrent callers — important
 * because React 18's StrictMode fires `useEffect` twice in development,
 * which would otherwise double-seed on the very first run.
 */
let seedPromise = null;

export function ensureSeeded() {
  if (seedPromise) return seedPromise;
  seedPromise = doSeed();
  return seedPromise;
}

async function doSeed() {
  const seeded = await getSetting('seeded', false);
  if (seeded) return;

  const now = Date.now();

  const demoCards = [
    { text: '可以自動排時間' },
    { text: '可以打勾完成任務' },
    { text: '可以同步 Google Calendar' },
    { text: '可以提醒我' },
    { text: '可以變成手機 app' },
  ].map((c, i) => ({
    id: uid('card'),
    sourceLang: 'zh-Hant',
    sourceText: c.text,
    targetLang: 'ja',
    targetText: `[日本語] ${c.text}`,
    translationStatus: 'done',
    createdAt: now + i,
    updatedAt: now + i,
  }));

  const demoCardIds = demoCards.map((c) => c.id);

  const snapshots = [
    {
      id: uid('snap'),
      name: 'Yes / No',
      layout: { ...emptyLayout(['Yes', 'No']), unplacedCardIds: [...demoCardIds] },
      createdAt: now,
      updatedAt: now,
    },
    {
      id: uid('snap'),
      name: 'Easy / Medium / Hard / Impossible',
      layout: {
        ...emptyLayout(['Easy', 'Medium', 'Hard', 'Impossible']),
        unplacedCardIds: [...demoCardIds],
      },
      createdAt: now + 1,
      updatedAt: now + 1,
    },
    {
      id: uid('snap'),
      name: 'Now / Later / Never',
      layout: {
        ...emptyLayout(['Now', 'Later', 'Never']),
        unplacedCardIds: [...demoCardIds],
      },
      createdAt: now + 2,
      updatedAt: now + 2,
    },
  ];

  await db.transaction('rw', db.cards, db.snapshots, db.settings, async () => {
    await db.cards.bulkPut(demoCards);
    await db.snapshots.bulkPut(snapshots);
    await setSetting('currentSnapshotId', snapshots[0].id);
    await setSetting('defaultSourceLang', 'zh-Hant');
    await setSetting('defaultTargetLang', 'ja');
    await setSetting('seeded', true);
  });
}
