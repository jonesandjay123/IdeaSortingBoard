import { useState, useEffect } from 'react';
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import Card from './Card.jsx';

export default function Column({
  column,
  cards,
  onRename,
  onDelete,
  onEditCard,
  onDeleteCard,
}) {
  // The column is itself sortable (so users can drag-reorder Yes/No).
  // `useSortable` includes `useDroppable` under the hood, so the same
  // node is still a valid drop target for CARDS — Board.jsx's custom
  // collisionDetection makes sure card-drags and column-drags only see
  // the droppables they care about.
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
    isOver,
    active,
  } = useSortable({
    id: column.id,
    data: { type: 'column' },
  });

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(column.name);

  useEffect(() => {
    setDraft(column.name);
  }, [column.name]);

  function saveRename() {
    const trimmed = draft.trim();
    if (trimmed && trimmed !== column.name) {
      onRename(column.id, trimmed);
    } else {
      setDraft(column.name);
    }
    setEditing(false);
  }

  // Only light up as a "card drop target" when a CARD is being dragged,
  // not when another column is being dragged over this one.
  const activeType = active?.data.current?.type;
  const isCardOver = isOver && activeType === 'card';

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    // Source column fades while it's being moved, matching the Card
    // behavior. The DragOverlay is intentionally disabled for columns
    // so the column itself slides under the cursor instead of a clone.
    opacity: isDragging ? 0.4 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`column ${isCardOver ? 'column-over' : ''} ${
        isDragging ? 'column-dragging' : ''
      }`}
    >
      {/* Dedicated drag rail at the very top of the column.
          Only this element carries the dnd-kit listeners/attributes,
          so clicking inside the column (rename, delete column, pick
          up a card, etc.) never accidentally starts a column drag.
          The rail is subtle by default and lights up on hover so the
          affordance is discoverable without being visually loud. */}
      <div
        className="column-drag-rail"
        {...listeners}
        {...attributes}
        role="button"
        aria-label={`Drag to reorder column ${column.name}`}
        title="Drag to reorder column"
      >
        <span className="column-drag-rail-dots" aria-hidden="true">
          ⋮⋮
        </span>
      </div>

      <div className="column-header">
        {editing ? (
          <input
            className="column-name-input"
            value={draft}
            autoFocus
            onChange={(e) => setDraft(e.target.value)}
            onBlur={saveRename}
            onKeyDown={(e) => {
              if (e.key === 'Enter') saveRename();
              if (e.key === 'Escape') {
                setDraft(column.name);
                setEditing(false);
              }
            }}
          />
        ) : (
          <h3
            className="column-title"
            onDoubleClick={() => setEditing(true)}
            title="Double-click to rename"
          >
            {column.name}
          </h3>
        )}
        <div className="column-meta">
          <span className="column-count">{column.cardIds.length}</span>
          <button
            className="column-action-btn"
            onClick={() => setEditing(true)}
            aria-label="Rename column"
            title="Rename"
          >
            ✎
          </button>
          <button
            className="column-action-btn danger"
            onClick={() => onDelete(column.id)}
            aria-label="Delete column"
            title="Delete column"
          >
            ×
          </button>
        </div>
      </div>
      <SortableContext
        items={column.cardIds}
        strategy={verticalListSortingStrategy}
      >
        <div className="column-body">
          {cards.length === 0 && (
            <div className="column-empty">Drop cards here</div>
          )}
          {cards.map((card) => (
            <Card
              key={card.id}
              card={card}
              onDelete={onDeleteCard}
              onEdit={onEditCard}
            />
          ))}
        </div>
      </SortableContext>
    </div>
  );
}
