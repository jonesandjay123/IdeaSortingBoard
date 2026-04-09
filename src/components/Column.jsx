import { useState, useEffect } from 'react';
import { useDroppable } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import Card from './Card.jsx';

export default function Column({
  column,
  cards,
  onRename,
  onDelete,
  onEditCard,
  onDeleteCard,
}) {
  const { setNodeRef, isOver } = useDroppable({ id: column.id });
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

  return (
    <div ref={setNodeRef} className={`column ${isOver ? 'column-over' : ''}`}>
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
