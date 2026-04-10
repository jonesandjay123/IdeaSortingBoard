import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/database.js';
import { deleteProposal, generateProposal } from '../db/actions.js';
import useSpeechRecognition from '../lib/useSpeechRecognition.js';

/**
 * Full-screen modal for viewing & managing project proposals for the
 * current snapshot.
 *
 * Layout:
 *   ┌──────────────────────────────────────────────────┐
 *   │ [← close]   Proposals for "<snapshot name>"     │
 *   ├────────────┬─────────────────────────────────────┤
 *   │ History    │ Reader                              │
 *   │            │                                     │
 *   │ • Title 1  │ <title>                             │
 *   │ • Title 2  │ <when>  <tags>                      │
 *   │ • Title 3  │ ── Rationale ──                     │
 *   │            │ ── MVP ──                           │
 *   │ [🎲 Spin]  │ ── Why now ──                       │
 *   │            │ ── Based on ── (frozen layout)      │
 *   └────────────┴─────────────────────────────────────┘
 *
 * Reasoning
 * ---------
 * - We reactively read proposals through `useLiveQuery`, so "generate
 *   a new one" just writes a loading row and both the history list
 *   and the reader auto-update as it fills in.
 * - Auto-select the newest proposal on open, so the user always sees
 *   the latest result without an extra click. When the user spins a
 *   new one, we eagerly switch the selection to it so they watch it
 *   stream in.
 * - Delete is offered per-history-entry. If the deleted one was the
 *   currently selected, we fall back to the next-newest.
 * - Because proposals store `layoutSnapshot` frozen at generation
 *   time, the reader can always render "this is what the board looked
 *   like when I suggested this", regardless of what the user has done
 *   to the board since.
 */
export default function ProposalModal({ open, snapshot, onClose }) {
  const snapshotId = snapshot?.id || null;

  // Reactive read: all proposals for this snapshot, newest first.
  const proposals = useLiveQuery(
    async () => {
      if (!snapshotId) return [];
      const rows = await db.proposals
        .where('snapshotId')
        .equals(snapshotId)
        .toArray();
      return rows.sort((a, b) => b.createdAt - a.createdAt);
    },
    [snapshotId],
    []
  );

  const [selectedId, setSelectedId] = useState(null);
  const [generating, setGenerating] = useState(false);
  const [spinError, setSpinError] = useState(null);

  // Optional human steering for the next roll. Empty = no guidance
  // (default creative prompt). Cleared after each successful spin so
  // the user doesn't accidentally re-apply last round's steering.
  const [guidanceText, setGuidanceText] = useState('');

  // Voice input for the guidance field — reuses the same hook as the
  // CardModal mic button. Finalized chunks get appended with a space
  // separator. Interim text is shown below the textarea, NOT written
  // into it (same reason as CardModal: avoid flicker on mid-utterance
  // state).
  const appendGuidanceChunk = useCallback((chunk) => {
    const clean = chunk.trim();
    if (!clean) return;
    setGuidanceText((prev) => {
      if (!prev) return clean;
      if (/[\s\n、。！？]$/.test(prev)) return prev + clean;
      return prev + ' ' + clean;
    });
  }, []);
  const speech = useSpeechRecognition({
    lang: 'zh-TW',
    onFinalChunk: appendGuidanceChunk,
  });
  // Stop speech when the modal closes so it's not listening in the
  // background after the user dismisses.
  useEffect(() => {
    if (!open && speech.listening) speech.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // See CardModal for the full explanation — only dismiss on backdrop
  // mouseup if mousedown also landed on the backdrop. Prevents drag-
  // select inside the proposal article from closing the modal when
  // the user's cursor drifts past the edge.
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

  // When the modal opens, select the newest proposal by default. When
  // it closes, reset local state so the next open is clean.
  useEffect(() => {
    if (!open) {
      setSelectedId(null);
      setSpinError(null);
      return;
    }
    if (proposals.length > 0 && !selectedId) {
      setSelectedId(proposals[0].id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, proposals]);

  // If the currently selected proposal was deleted, fall back to the
  // newest remaining one. This also covers cascade delete.
  useEffect(() => {
    if (!selectedId) return;
    if (!proposals.some((p) => p.id === selectedId)) {
      setSelectedId(proposals[0]?.id || null);
    }
  }, [proposals, selectedId]);

  // Esc closes the modal.
  useEffect(() => {
    if (!open) return;
    function onKey(e) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const selected = useMemo(
    () => proposals.find((p) => p.id === selectedId) || null,
    [proposals, selectedId]
  );

  async function handleSpin() {
    if (!snapshotId || generating) return;
    if (speech.listening) speech.stop();
    setGenerating(true);
    setSpinError(null);
    const guidanceForThisRoll = guidanceText.trim();
    try {
      const newId = await generateProposal(snapshotId, guidanceForThisRoll);
      // Switch to it immediately so the user watches it stream in.
      setSelectedId(newId);
      // Clear the guidance input after a successful spin — next
      // round starts clean. If the user wants the same guidance
      // twice, they can retype it (or just paste).
      setGuidanceText('');
    } catch (err) {
      setSpinError(String(err?.message || err));
    } finally {
      setGenerating(false);
    }
  }

  async function handleDelete(id) {
    const p = proposals.find((x) => x.id === id);
    const label = p?.content?.title || '（未命名提案）';
    if (!window.confirm(`刪除這個提案？\n\n「${label}」\n\n（無法復原）`)) return;
    await deleteProposal(id);
  }

  if (!open || !snapshot) return null;

  return (
    <div
      className="proposal-modal-backdrop"
      onMouseDown={handleBackdropMouseDown}
      onMouseUp={handleBackdropMouseUp}
    >
      <div className="proposal-modal" role="dialog" aria-modal="true">
        <header className="proposal-modal-header">
          <div className="proposal-modal-title">
            <span className="proposal-modal-kicker">Project proposals</span>
            <h2>「{snapshot.name}」的企劃點子</h2>
          </div>
          <button
            className="proposal-modal-close"
            onClick={onClose}
            aria-label="Close"
            title="Close (Esc)"
          >
            ×
          </button>
        </header>

        <div className="proposal-modal-body">
          <aside className="proposal-history">
            <div className="proposal-history-header">
              <span>歷史</span>
              <span className="proposal-history-count">{proposals.length}</span>
            </div>

            <div className="proposal-history-list">
              {proposals.length === 0 && !generating && (
                <div className="proposal-history-empty">
                  還沒有任何提案。
                  <br />
                  按下方的「抽一張」開始。
                </div>
              )}
              {proposals.map((p) => (
                <HistoryItem
                  key={p.id}
                  proposal={p}
                  active={p.id === selectedId}
                  onClick={() => setSelectedId(p.id)}
                  onDelete={() => handleDelete(p.id)}
                />
              ))}
            </div>

            <div className="proposal-history-footer">
              <div className="proposal-guidance">
                <div className="proposal-guidance-label-row">
                  <span>額外引導（選填）</span>
                  {speech.supported && (
                    <button
                      type="button"
                      className={`mic-btn ${
                        speech.listening ? 'is-listening' : ''
                      }`}
                      onClick={speech.toggle}
                      aria-label={
                        speech.listening ? '停止語音輸入' : '開始語音輸入'
                      }
                      title={
                        speech.listening
                          ? '正在聽 — 再按一次停止'
                          : '用說的給 Gemini 引導'
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
                  className="proposal-guidance-input"
                  value={guidanceText}
                  onChange={(e) => setGuidanceText(e.target.value)}
                  rows={3}
                  placeholder="例如：做成給長輩用的、或變成一個絕對不插電的玩具"
                />
                {speech.listening && (
                  <div className="speech-interim">
                    {speech.interim || '正在聽你說話…'}
                  </div>
                )}
              </div>

              {spinError && (
                <div className="proposal-spin-error">{spinError}</div>
              )}
              <button
                className="proposal-spin-btn"
                onClick={handleSpin}
                disabled={generating}
                title="讓 Gemini 根據現在 board 上的排列再抽一張"
              >
                {generating ? '生成中…' : '🎲 抽一張新的'}
              </button>
              <div className="proposal-spin-hint">
                只看 board 上的卡，不看右側 card pool
              </div>
            </div>
          </aside>

          <main className="proposal-reader">
            {!selected && !generating && (
              <div className="proposal-reader-empty">
                <div className="proposal-reader-empty-art">💡</div>
                <div>
                  根據你在 board 上放卡片的方式，Gemini 會幫你抽一個
                  <br />
                  具體的 project 建議。
                </div>
                <div className="proposal-reader-empty-hint">
                  按左下角的「抽一張新的」開始。
                </div>
              </div>
            )}
            {selected && <ProposalReader proposal={selected} />}
          </main>
        </div>
      </div>
    </div>
  );
}

function HistoryItem({ proposal, active, onClick, onDelete }) {
  const title =
    proposal.status === 'loading'
      ? '生成中…'
      : proposal.status === 'error'
      ? '（生成失敗）'
      : proposal.content?.title || '（未命名提案）';

  const when = formatRelative(proposal.createdAt);

  return (
    <div
      className={`proposal-history-item ${active ? 'is-active' : ''} ${
        proposal.status === 'loading' ? 'is-loading' : ''
      } ${proposal.status === 'error' ? 'is-error' : ''}`}
      onClick={onClick}
    >
      <div className="proposal-history-item-main">
        <div className="proposal-history-item-title">{title}</div>
        <div className="proposal-history-item-when">{when}</div>
      </div>
      <button
        className="proposal-history-item-del"
        onClick={(e) => {
          e.stopPropagation();
          onDelete();
        }}
        aria-label="Delete proposal"
        title="Delete"
      >
        ×
      </button>
    </div>
  );
}

function ProposalReader({ proposal }) {
  if (proposal.status === 'loading') {
    return (
      <div className="proposal-reader-loading">
        <div className="proposal-spinner" />
        <div>Gemini 正在根據你的 board 想一個點子…</div>
      </div>
    );
  }

  if (proposal.status === 'error') {
    return (
      <div className="proposal-reader-error">
        <h3>生成失敗</h3>
        <pre>{proposal.error || 'Unknown error'}</pre>
        <div className="proposal-reader-error-hint">
          檢查一下 .env 裡的 VITE_GEMINI_API_KEY 是否有效，然後再按「抽一張」重試。
        </div>
      </div>
    );
  }

  const c = proposal.content || {};
  const layout = proposal.layoutSnapshot;

  return (
    <article className="proposal-article">
      <div className="proposal-article-meta">
        <span>{formatAbsolute(proposal.createdAt)}</span>
        <span className="proposal-article-meta-sep">·</span>
        <span>{proposal.model || 'gemini'}</span>
      </div>

      <h1 className="proposal-article-title">{c.title}</h1>

      {c.tags && c.tags.length > 0 && (
        <div className="proposal-article-tags">
          {c.tags.map((t, i) => (
            <span key={i} className="proposal-article-tag">
              #{t}
            </span>
          ))}
        </div>
      )}

      {proposal.userGuidance && (
        <div className="proposal-article-guidance">
          <span className="proposal-article-guidance-label">🎯 你的引導</span>
          <span className="proposal-article-guidance-text">
            「{proposal.userGuidance}」
          </span>
        </div>
      )}

      {c.rationale && (
        <section className="proposal-article-section">
          <h3>為什麼是這個？</h3>
          <p>{c.rationale}</p>
        </section>
      )}

      {c.mvp && c.mvp.length > 0 && (
        <section className="proposal-article-section">
          <h3>MVP 起手式</h3>
          <ul>
            {c.mvp.map((item, i) => (
              <li key={i}>{item}</li>
            ))}
          </ul>
        </section>
      )}

      {c.whyNow && (
        <section className="proposal-article-section">
          <h3>為什麼現在適合做</h3>
          <p>{c.whyNow}</p>
        </section>
      )}

      {layout && (
        <section className="proposal-article-section proposal-article-layout">
          <h3>根據當時 board 上的這些卡片</h3>
          <div className="proposal-layout-grid">
            {layout.columns
              .filter((col) => col.cards.length > 0)
              .map((col, i) => (
                <div key={i} className="proposal-layout-col">
                  <div className="proposal-layout-col-name">{col.name}</div>
                  <ul>
                    {col.cards.map((txt, j) => (
                      <li key={j}>{txt}</li>
                    ))}
                  </ul>
                </div>
              ))}
          </div>
        </section>
      )}
    </article>
  );
}

// ============================================================
// Time formatting — local, no dep.
// ============================================================

function formatAbsolute(ts) {
  const d = new Date(ts);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const h = String(d.getHours()).padStart(2, '0');
  const min = String(d.getMinutes()).padStart(2, '0');
  return `${y}-${m}-${day} ${h}:${min}`;
}

function formatRelative(ts) {
  const diffMs = Date.now() - ts;
  const sec = Math.floor(diffMs / 1000);
  if (sec < 60) return 'just now';
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day}d ago`;
  return formatAbsolute(ts).slice(0, 10);
}
