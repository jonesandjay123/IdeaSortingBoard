import { useState, useEffect, useRef } from 'react';
import { SUPPORTED_LANGUAGES } from '../services/translationService.js';

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
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
      >
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
            <span>Idea</span>
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
