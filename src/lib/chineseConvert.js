import { useEffect, useState } from 'react';

/**
 * Traditional ↔ Simplified Chinese conversion, powered by `opencc-js`.
 *
 * Why opencc-js
 * -------------
 * It's a port of the OpenCC project, which is the de-facto standard for
 * Chinese script conversion. Unlike a naive char-by-char lookup table,
 * OpenCC handles **phrase-level** mappings, which is the difference
 * between:
 *
 *   軟體 → 软件     (correct, what OpenCC does)
 *   軟體 → 軟体     (wrong, what a char-only converter does)
 *
 * For our proposal output (which is full of Taiwanese tech vocabulary),
 * phrase-level matters: 滑鼠 → 鼠标, 網路 → 网络, 印表機 → 打印机, etc.
 *
 * Loading strategy
 * ----------------
 * The `opencc-js` package ships its dictionary data inside the JS
 * bundle (no runtime CDN fetch), but the bundle is non-trivial in
 * size (~hundreds of KB). We do NOT want that in the initial page
 * load — the user might never click the trad/simp toggle.
 *
 * So everything goes through `ensureConverters()`, which dynamically
 * imports `opencc-js` on first use. Vite code-splits this into its
 * own chunk and only fetches when needed. Subsequent calls are
 * synchronous (the converter functions themselves are sync once
 * loaded).
 *
 * The cached converters live in module-level state so React Strict
 * Mode's double-mount doesn't trigger two parallel imports.
 *
 * Why store originals in DB and only convert at display time
 * ----------------------------------------------------------
 * The DB row is the source of truth — always Traditional Chinese
 * (matches Gemini's output, matches the user/student's locale).
 * Conversion is purely a view layer concern. This means:
 *   - we can always go back to the original
 *   - the DB never depends on whether opencc-js is loaded
 *   - toggling never has data-loss risk
 */

let cachedConverters = null;
let loadPromise = null;

/**
 * Lazy-load opencc-js and build both direction converters. Idempotent
 * across concurrent callers and across React Strict Mode double-fires.
 *
 * @returns {Promise<{ toSimplified: (s:string)=>string, toTraditional: (s:string)=>string }>}
 */
export function ensureConverters() {
  if (cachedConverters) return Promise.resolve(cachedConverters);
  if (loadPromise) return loadPromise;

  loadPromise = import('opencc-js').then((OpenCC) => {
    // tw → cn: Taiwan Mandarin (繁體中文 with Taiwan vocabulary) into
    //          Simplified Chinese with Mainland vocabulary. This is
    //          the highest-fidelity direction for our content because
    //          our proposals are explicitly written in Taiwanese
    //          Traditional, and we want them to read naturally to a
    //          mainland audience after conversion.
    // cn → tw: the reverse, for completeness. We don't usually need
    //          this (our content starts as tw), but exposing it
    //          means the toggle works in both directions when the
    //          user is currently looking at simp.
    cachedConverters = {
      toSimplified: OpenCC.Converter({ from: 'tw', to: 'cn' }),
      toTraditional: OpenCC.Converter({ from: 'cn', to: 'tw' }),
    };
    return cachedConverters;
  });

  return loadPromise;
}

/**
 * React hook that exposes the converters once they've finished
 * loading. Returns `null` while loading, and a `{ toSimplified,
 * toTraditional }` object once ready.
 *
 * Components should fall back to the original (Traditional) text
 * while this is `null`. Loading is fast (the chunk is fetched once
 * per session) so the flicker is minimal and only happens on the
 * very first toggle.
 */
export function useConverters() {
  const [converters, setConverters] = useState(cachedConverters);

  useEffect(() => {
    if (cachedConverters) {
      setConverters(cachedConverters);
      return;
    }
    let cancelled = false;
    ensureConverters().then((c) => {
      if (!cancelled) setConverters(c);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return converters;
}

/**
 * Walk a proposal object and apply a string converter to every
 * user-visible field. Returns a new object — the input is never
 * mutated. Pure function: passing the same proposal + same `convert`
 * always returns the same shape, so it's safe to memoize.
 *
 * Fields touched (everything that ends up rendered in the reader):
 *   - content.title
 *   - content.rationale
 *   - content.whyNow
 *   - content.mvp[]              (each bullet)
 *   - content.tags[]             (each tag)
 *   - userGuidance               (the steering text, if present)
 *   - layoutSnapshot.columns[].name
 *   - layoutSnapshot.columns[].cards[]
 *
 * Fields left alone:
 *   - id, snapshotId, snapshotName, status, createdAt, model, error
 *     (these are either UUIDs, timestamps, or system-facing labels
 *     that should not be converted)
 */
export function convertProposalDeep(proposal, convert) {
  if (!proposal || !convert) return proposal;

  const c = proposal.content || null;
  const layout = proposal.layoutSnapshot || null;

  return {
    ...proposal,
    content: c
      ? {
          ...c,
          title: c.title ? convert(c.title) : c.title,
          rationale: c.rationale ? convert(c.rationale) : c.rationale,
          whyNow: c.whyNow ? convert(c.whyNow) : c.whyNow,
          mvp: Array.isArray(c.mvp) ? c.mvp.map((x) => (x ? convert(x) : x)) : c.mvp,
          tags: Array.isArray(c.tags) ? c.tags.map((x) => (x ? convert(x) : x)) : c.tags,
        }
      : c,
    userGuidance: proposal.userGuidance ? convert(proposal.userGuidance) : proposal.userGuidance,
    layoutSnapshot: layout
      ? {
          ...layout,
          columns: Array.isArray(layout.columns)
            ? layout.columns.map((col) => ({
                ...col,
                name: col.name ? convert(col.name) : col.name,
                cards: Array.isArray(col.cards)
                  ? col.cards.map((x) => (x ? convert(x) : x))
                  : col.cards,
              }))
            : layout.columns,
        }
      : layout,
  };
}
