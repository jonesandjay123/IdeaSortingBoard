/**
 * Theme (dark/light) helpers. UI-only state, so it lives in localStorage
 * instead of IndexedDB — no need to go through Dexie for a single boolean.
 *
 * Default is "dark" because the primary user prefers dark UIs for eye
 * comfort. The actual application happens in two places:
 *
 *   1. `index.html` has a tiny inline bootstrap script that runs *before*
 *      React mounts and sets `document.documentElement.dataset.theme`.
 *      This prevents a flash of light theme on first paint.
 *   2. `Toolbar.jsx` imports `toggleTheme()` for the sun/moon button.
 *
 * If both readers stay in sync via `data-theme` on <html>, CSS can do the
 * rest through attribute selectors (see app.css).
 */

const STORAGE_KEY = 'isb:theme';
export const DEFAULT_THEME = 'dark';

export function getStoredTheme() {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v === 'dark' || v === 'light') return v;
  } catch (_) {
    // localStorage can throw in private mode / disabled storage.
  }
  return DEFAULT_THEME;
}

export function setStoredTheme(theme) {
  const next = theme === 'light' ? 'light' : 'dark';
  try {
    localStorage.setItem(STORAGE_KEY, next);
  } catch (_) {
    // ignore — we still apply it to the DOM below
  }
  if (typeof document !== 'undefined') {
    document.documentElement.dataset.theme = next;
  }
  return next;
}

export function toggleTheme() {
  const current = getStoredTheme();
  return setStoredTheme(current === 'dark' ? 'light' : 'dark');
}
