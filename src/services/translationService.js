/**
 * Translation service.
 *
 * MVP: a mock async implementation that fakes a short delay and returns
 * a visibly-different string so the async "loading -> done" flow is
 * obvious in the UI.
 *
 * To swap in Gemini (or any real translator), replace the body of
 * `translate()` while keeping the same signature. Everything else in the
 * app goes through this function, so nothing else needs to change.
 *
 *   Example (Gemini):
 *     const resp = await fetch(
 *       `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${API_KEY}`,
 *       {
 *         method: 'POST',
 *         headers: { 'Content-Type': 'application/json' },
 *         body: JSON.stringify({
 *           contents: [{
 *             parts: [{
 *               text: `Translate the following from ${sourceLang} to ${targetLang}.`
 *                    + ` Return only the translation, no quotes, no explanation.\n\n${text}`
 *             }]
 *           }]
 *         })
 *       }
 *     );
 *     const data = await resp.json();
 *     return data.candidates[0].content.parts[0].text.trim();
 */

const LANGUAGE_LABELS = {
  'zh-Hant': '繁中',
  'zh-Hans': '简中',
  en: 'EN',
  ja: '日本語',
};

export const SUPPORTED_LANGUAGES = [
  { code: 'zh-Hant', label: '繁體中文' },
  { code: 'zh-Hans', label: '简体中文' },
  { code: 'en', label: 'English' },
  { code: 'ja', label: '日本語' },
];

export function getLanguageLabel(code) {
  return LANGUAGE_LABELS[code] || code;
}

export function getLanguageFullLabel(code) {
  return SUPPORTED_LANGUAGES.find((l) => l.code === code)?.label || code;
}

/**
 * Translate text from one language to another.
 * Returns the translated string, or throws on failure.
 *
 * @param {string} text
 * @param {string} sourceLang - BCP-47-ish code (zh-Hant, en, ja, ...)
 * @param {string} targetLang
 * @returns {Promise<string>}
 */
export async function translate(text, sourceLang, targetLang) {
  if (!text || !targetLang || sourceLang === targetLang) return text;

  // Simulated network delay so the "Translating…" state is visible.
  const delay = 600 + Math.random() * 700;
  await new Promise((r) => setTimeout(r, delay));

  // Deterministic mock: prefix with the target-language label.
  // Swap this single line with a real API call when ready.
  return `[${LANGUAGE_LABELS[targetLang] || targetLang}] ${text}`;
}
