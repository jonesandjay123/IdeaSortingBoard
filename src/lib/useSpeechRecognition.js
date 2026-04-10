import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Thin wrapper around the browser's Web Speech API (SpeechRecognition).
 *
 * Scope
 * -----
 * This project is Chrome-only and self-hosted for classroom use, so
 * this hook deliberately makes no attempt to paper over cross-browser
 * differences. On Chrome (and Chromium Edge) this uses
 * `webkitSpeechRecognition`, which is reliable enough for teaching.
 *
 * It does NOT hit any AI / token budget. Recognition happens in the
 * browser (Chrome may send audio to Google's ASR service, but that's
 * transparent to us and costs nothing token-wise in our app).
 *
 * Contract
 * --------
 *   const {
 *     supported,   // boolean — is SpeechRecognition available at all?
 *     listening,   // boolean — is a session currently active?
 *     interim,     // string  — the in-progress (not yet finalized) text
 *     error,       // string | null — last error code from the API
 *     start(),     // begin a session. onFinalChunk is called with each
 *                  //   finalized chunk so the caller can append it to
 *                  //   whatever state they manage (textarea, etc).
 *     stop(),      // end the session manually.
 *     toggle(),    // convenience.
 *   } = useSpeechRecognition({ lang: 'zh-TW', onFinalChunk });
 *
 * We intentionally do NOT own the transcript text. The caller does.
 * That way we don't have to decide "replace vs append vs reset" — the
 * caller just gets chunks as they finalize and does the right thing
 * for its own UI (e.g. CardModal appends to its textarea content).
 */
export default function useSpeechRecognition({ lang = 'zh-TW', onFinalChunk } = {}) {
  const SR =
    typeof window !== 'undefined'
      ? window.SpeechRecognition || window.webkitSpeechRecognition
      : null;
  const supported = !!SR;

  const recognitionRef = useRef(null);
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState('');
  const [error, setError] = useState(null);
  // Stash the latest callback in a ref so `start` doesn't have to be
  // torn down and re-created every render — that was causing the
  // recognition instance to be abandoned mid-utterance.
  const onFinalChunkRef = useRef(onFinalChunk);
  useEffect(() => {
    onFinalChunkRef.current = onFinalChunk;
  }, [onFinalChunk]);

  // Build / tear down lazily. We recreate the recognition object per
  // session because Chrome's implementation is a bit buggy about
  // re-using the same instance after `stop()`.
  const start = useCallback(() => {
    if (!supported) return;
    if (recognitionRef.current) return; // already running

    const recognition = new SR();
    recognition.lang = lang;
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;

    recognition.onresult = (event) => {
      let interimText = '';
      // Walk only the new results; `resultIndex` points at the first
      // result added since the last event.
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        const transcript = result[0]?.transcript || '';
        if (result.isFinal) {
          if (transcript && onFinalChunkRef.current) {
            onFinalChunkRef.current(transcript);
          }
        } else {
          interimText += transcript;
        }
      }
      setInterim(interimText);
    };

    recognition.onerror = (event) => {
      // `no-speech` is the common "user stopped talking" timeout.
      // Don't surface it as an error in the UI — just end the session.
      if (event.error === 'no-speech' || event.error === 'aborted') {
        setError(null);
      } else {
        setError(event.error || 'unknown');
      }
    };

    recognition.onend = () => {
      recognitionRef.current = null;
      setListening(false);
      setInterim('');
    };

    try {
      recognition.start();
      recognitionRef.current = recognition;
      setListening(true);
      setError(null);
    } catch (e) {
      // Happens if `start()` is called twice in a row before `onend`
      // fires. Safe to ignore.
      setError(String(e?.message || e));
    }
  }, [SR, lang, supported]);

  const stop = useCallback(() => {
    const r = recognitionRef.current;
    if (!r) return;
    try {
      r.stop();
    } catch (_) {}
  }, []);

  const toggle = useCallback(() => {
    if (listening) stop();
    else start();
  }, [listening, start, stop]);

  // Clean up if the host component unmounts mid-session.
  useEffect(() => {
    return () => {
      const r = recognitionRef.current;
      if (r) {
        try {
          r.abort();
        } catch (_) {}
      }
    };
  }, []);

  return { supported, listening, interim, error, start, stop, toggle };
}
