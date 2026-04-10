import { useState, useEffect, useRef, useCallback } from 'react';
import { SUPPORTED_LANGUAGES } from '../services/translationService.js';
import useSpeechRecognition from '../lib/useSpeechRecognition.js';

// Map the app's BCP-47-ish source lang codes to codes the Web Speech
// API is happy with. The API wants a region, not a script subtag, so
// `zh-Hant` → `zh-TW` etc.
const SPEECH_LANG_MAP = {
  'zh-Hant': 'zh-TW',
  'zh-Hans': 'zh-CN',
  en: 'en-US',
  ja: 'ja-JP',
};

export default function CardModal({
  open,
  onClose,
  onSubmit,
  initial,
  defaultSourceLang,
  defaultTargetLang,
}) {
  const [sourceLang, setSourceLang] = useState(defaultSourceLang || 'zh-Hant');
  const [targetLang, setTargetLang] = useState(defaultTargetLang || '');
  const [text, setText] = useState('');
  const textareaRef = useRef(null);

  // Drag-select dismiss guard. `click` fires on the DEEPEST COMMON
  // ANCESTOR of mousedown and mouseup. So if a user starts a text
  // selection inside the textarea and drags beyond the modal edge
  // before releasing, the synthesized click lands on .modal-backdrop
  // — which would close the modal mid-selection. Not what anyone
  // wants. Track whether mousedown actually landed on the backdrop
  // itself, and only treat mouseup as a dismiss if BOTH ends were on
  // the backdrop. This is the Radix / React-Aria pattern.
  const mouseDownOnBackdropRef = useRef(false);
  function handleBackdropMouseDown(e) {
    mouseDownOnBackdropRef.current = e.target === e.currentTarget;
  }
  function handleBackdropMouseUp(e) {
    if (mouseDownOnBackdropRef.current && e.target === e.currentTarget) {
      onClose();
    }
    mouseDownOnBackdropRef.current = false;
  }

  // Speech-to-text: finalized chunks get appended to the textarea;
  // interim text is shown below as a ghost line while the user speaks.
  // We DON'T write interim text into `text` itself — otherwise every
  // word the user mid-says would flicker into the real field and be
  // hard to un-undo.
  const appendChunk = useCallback((chunk) => {
    const clean = chunk.trim();
    if (!clean) return;
    setText((prev) => {
      if (!prev) return clean;
      // If the existing text already ends with whitespace or a CJK
      // punctuation / bullet break, don't add extra space.
      if (/[\s\n、。！？]$/.test(prev)) return prev + clean;
      return prev + ' ' + clean;
    });
  }, []);

  const speech = useSpeechRecognition({
    lang: SPEECH_LANG_MAP[sourceLang] || 'en-US',
    onFinalChunk: appendChunk,
  });

  // If the user switches source language mid-modal, restart recognition
  // in the new language so interim chunks come back in the right script.
  useEffect(() => {
    if (speech.listening) {
      speech.stop();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sourceLang]);

  // Auto-stop recognition when the modal closes, so it's not
  // listening in the background after Cancel/Save.
  useEffect(() => {
    if (!open && speech.listening) {
      speech.stop();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!open) return;
    if (initial) {
      setSourceLang(initial.sourceLang);
      setTargetLang(initial.targetLang || '');
      setText(initial.sourceText);
    } else {
      setSourceLang(defaultSourceLang || 'zh-Hant');
      setTargetLang(defaultTargetLang || '');
      setText('');
    }
    // Focus the textarea shortly after mount.
    const t = setTimeout(() => textareaRef.current?.focus(), 40);
    return () => clearTimeout(t);
  }, [open, initial, defaultSourceLang, defaultTargetLang]);

  useEffect(() => {
    if (!open) return;
    function onKey(e) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  function handleSubmit(e) {
    e.preventDefault();
    const trimmed = text.trim();
    if (!trimmed) return;
    onSubmit({
      sourceLang,
      sourceText: trimmed,
      targetLang: targetLang || null,
    });
    onClose();
  }

  return (
    <div
      className="modal-backdrop"
      onMouseDown={handleBackdropMouseDown}
      onMouseUp={handleBackdropMouseUp}
    >
      <div className="modal" role="dialog" aria-modal="true">
        <h2>{initial ? 'Edit card' : 'New card'}</h2>
        <form onSubmit={handleSubmit}>
          <div className="field-row">
            <label className="field">
              <span>Source language</span>
              <select
                value={sourceLang}
                onChange={(e) => setSourceLang(e.target.value)}
              >
                {SUPPORTED_LANGUAGES.map((l) => (
                  <option key={l.code} value={l.code}>
                    {l.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Translate to (optional)</span>
              <select
                value={targetLang}
                onChange={(e) => setTargetLang(e.target.value)}
              >
                <option value="">— None —</option>
                {SUPPORTED_LANGUAGES.filter((l) => l.code !== sourceLang).map(
                  (l) => (
                    <option key={l.code} value={l.code}>
                      {l.label}
                    </option>
                  )
                )}
              </select>
            </label>
          </div>
          <label className="field">
            <div className="field-label-row">
              <span>Idea</span>
              {speech.supported && (
                <button
                  type="button"
                  className={`mic-btn ${speech.listening ? 'is-listening' : ''}`}
                  onClick={speech.toggle}
                  aria-label={speech.listening ? '停止語音輸入' : '開始語音輸入'}
                  title={
                    speech.listening
                      ? '正在聽 — 再按一次停止'
                      : '按下後用說的，Chrome 原生語音輸入'
                  }
                >
                  {speech.listening ? (
                    <>
                      <span className="mic-dot" aria-hidden="true" />
                      <span className="mic-label">Listening…</span>
                    </>
                  ) : (
                    <>
                      <span aria-hidden="true">🎤</span>
                      <span className="mic-label">Voice</span>
                    </>
                  )}
                </button>
              )}
            </div>
            <textarea
              ref={textareaRef}
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={4}
              placeholder="e.g. 可以自動排時間"
              onKeyDown={(e) => {
                if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                  handleSubmit(e);
                }
              }}
            />
            {speech.listening && (
              <div className="speech-interim">
                {speech.interim || '正在聽你說話…'}
              </div>
            )}
            {speech.error && !speech.listening && (
              <div className="speech-error">
                語音輸入失敗：{speech.error}
              </div>
            )}
          </label>
          <div className="modal-hint">
            Tip: press <kbd>⌘</kbd>/<kbd>Ctrl</kbd> + <kbd>Enter</kbd> to submit.
          </div>
          <div className="modal-actions">
            <button type="button" onClick={onClose} className="btn-ghost">
              Cancel
            </button>
            <button
              type="submit"
              className="btn-primary"
              disabled={!text.trim()}
            >
              {initial ? 'Save' : 'Create'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
