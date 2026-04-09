import { useState, useCallback } from 'react';
import { useDroppable } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import Card from './Card.jsx';

// Width bounds and persistence. Tracking this in localStorage (not Dexie)
// because it's pure UI state, same rationale as theme.js.
const MIN_WIDTH = 220;
const MAX_WIDTH = 520;
const DEFAULT_WIDTH = 300;
const STORAGE_KEY = 'isb:sidepanelWidth';

function readStoredWidth() {
  try {
    const v = parseInt(localStorage.getItem(STORAGE_KEY), 10);
    if (Number.isFinite(v) && v >= MIN_WIDTH && v <= MAX_WIDTH) return v;
  } catch (_) {}
  return DEFAULT_WIDTH;
}

export default function SidePanel({
  cardIds,
  cardsMap,
  onAddClick,
  onDeleteCard,
  onEditCard,
}) {
  const { setNodeRef, isOver } = useDroppable({ id: 'unplaced' });
  const [width, setWidth] = useState(readStoredWidth);
  const [resizing, setResizing] = useState(false);

  // Pointer-based drag resize. The handle sits on the LEFT edge of the
  // panel, so dragging the pointer LEFT (smaller clientX) makes the
  // panel WIDER — hence `startX - current`.
  const handleResizeStart = useCallback(
    (e) => {
      // Don't let dnd-kit or anything else see this.
      e.preventDefault();
      e.stopPropagation();

      const startX = e.clientX;
      const startW = width;
      let finalW = startW;

      function onMove(ev) {
        const dx = startX - ev.clientX;
        finalW = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, startW + dx));
        setWidth(finalW);
      }

      function cleanup() {
        document.removeEventListener('pointermove', onMove);
        document.removeEventListener('pointerup', cleanup);
        document.removeEventListener('pointercancel', cleanup);
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
        setResizing(false);
        try {
          localStorage.setItem(STORAGE_KEY, String(finalW));
        } catch (_) {}
      }

      setResizing(true);
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
      document.addEventListener('pointermove', onMove);
      document.addEventListener('pointerup', cleanup);
      document.addEventListener('pointercancel', cleanup);
    },
    [width]
  );

  return (
    <aside
      className={`side-panel ${isOver ? 'side-panel-over' : ''} ${
        resizing ? 'side-panel-resizing' : ''
      }`}
      style={{ width: `${width}px` }}
    >
      {/* Resize handle — sits straddling the left border so there's a
          forgiving hit area even outside the panel itself. Not part of
          the droppable ref tree, so dnd-kit ignores it. */}
      <div
        className={`side-panel-resize-handle ${
          resizing ? 'is-dragging' : ''
        }`}
        onPointerDown={handleResizeStart}
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize card pool"
        title="Drag to resize"
      />

      <div className="side-panel-header">
        <h2>Card Pool</h2>
        <button
          className="add-card-btn"
          onClick={onAddClick}
          aria-label="Add card"
          title="New card"
        >
          +
        </button>
      </div>
      <div className="side-panel-subtitle">
        Unplaced · {cardIds.length}
      </div>
      <SortableContext
        items={cardIds}
        strategy={verticalListSortingStrategy}
      >
        <div ref={setNodeRef} className="side-panel-body">
          {cardIds.length === 0 && (
            <div className="side-panel-empty">
              All cards are placed.
              <br />
              Click + to add a new idea.
            </div>
          )}
          {cardIds.map((id) => {
            const card = cardsMap.get(id);
            if (!card) return null;
            return (
              <Card
                key={id}
                card={card}
                onDelete={onDeleteCard}
                onEdit={onEditCard}
              />
            );
          })}
        </div>
      </SortableContext>
    </aside>
  );
}
