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

  // Parallel mic stream kept alive for the duration of recognition,
  // used as a workaround for macOS audio ducking. See the comment in
  // `start()` for why this exists.
  const preStreamRef = useRef(null);
  function stopPreStream() {
    const s = preStreamRef.current;
    if (!s) return;
    try {
      s.getTracks().forEach((t) => t.stop());
    } catch (_) {}
    preStreamRef.current = null;
  }

  // Build / tear down lazily. We recreate the recognition object per
  // session because Chrome's implementation is a bit buggy about
  // re-using the same instance after `stop()`.
  const start = useCallback(async () => {
    if (!supported) return;
    if (recognitionRef.current) return; // already running

    // --- macOS audio ducking workaround ---
    // When Chrome's Web Speech API opens the mic, it does so with
    // echoCancellation / noiseSuppression / autoGainControl all
    // implicitly enabled. On macOS this causes Core Audio to flip the
    // current audio session into "voice chat" mode, which ducks all
    // other system audio (YouTube, Spotify, etc) for the duration of
    // the recognition session. There's no API on SpeechRecognition
    // itself to disable that processing.
    //
    // The workaround: *first* open a separate getUserMedia stream
    // with all three processing flags explicitly set to `false`, and
    // keep that stream alive while recognition runs. On macOS, the
    // first mic stream's settings determine the session mode — so by
    // establishing a "no processing" stream before SpeechRecognition
    // fires its own getUserMedia, Core Audio stays in default mode
    // and other audio is NOT ducked.
    //
    // This is a best-effort workaround: Chrome may still override us
    // in future versions. If this getUserMedia fails (permission
    // denied, no mic, etc), we swallow the error and let
    // SpeechRecognition try anyway — it will surface its own error
    // via `onerror` if it can't access the mic either.
    try {
      if (navigator.mediaDevices?.getUserMedia) {
        preStreamRef.current = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: false,
            noiseSuppression: false,
            autoGainControl: false,
          },
        });
      }
    } catch (_) {
      preStreamRef.current = null;
    }

    // Between `await` and now, the component might have unmounted or
    // someone might have called `stop()`. Bail out cleanly in that
    // case so we don't leave a recognition running that nobody knows
    // about.
    if (recognitionRef.current) {
      // Someone raced us — discard our pre-stream and bail.
      stopPreStream();
      return;
    }

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
      // Release the parallel mic stream so we don't hold the mic
      // (or the audio session) longer than the recognition session.
      stopPreStream();
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
      // Couldn't start SpeechRecognition — don't leave the pre-stream
      // dangling either.
      stopPreStream();
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
      stopPreStream();
    };
  }, []);

  return { supported, listening, interim, error, start, stop, toggle };
}
