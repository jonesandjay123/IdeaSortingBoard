import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { getLanguageLabel } from '../services/translationService.js';

function CardBody({ card }) {
  return (
    <>
      <div className="card-header">
        <span className="card-lang-badge">{getLanguageLabel(card.sourceLang)}</span>
      </div>
      <div className="card-text">{card.sourceText}</div>
      {card.targetLang && (
        <div className="card-translation">
          <span className="card-lang-badge small">
            {getLanguageLabel(card.targetLang)}
          </span>
          {card.translationStatus === 'loading' && (
            <em className="loading">Translating…</em>
          )}
          {card.translationStatus === 'done' && card.targetText && (
            <span>{card.targetText}</span>
          )}
          {card.translationStatus === 'error' && (
            <em className="error">Translation failed</em>
          )}
          {card.translationStatus === 'none' && null}
        </div>
      )}
    </>
  );
}

/** A non-draggable visual copy of a card, used by <DragOverlay>. */
export function CardPreview({ card }) {
  return (
    <div className="card card-preview">
      <div className="card-drag-handle">
        <CardBody card={card} />
      </div>
      <div className="card-action-bar" aria-hidden="true">
        <button className="card-action-btn" tabIndex={-1}>✎</button>
        <button className="card-action-btn danger" tabIndex={-1}>×</button>
      </div>
    </div>
  );
}

export default function Card({ card, onDelete, onEdit }) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: card.id,
    // `type` lets Board.jsx branch dragEnd logic (card vs column) and
    // lets its custom collisionDetection filter out non-matching
    // droppables.
    data: { type: 'card' },
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.3 : 1,
  };

  return (
    <div ref={setNodeRef} style={style} className="card" {...attributes}>
      <div className="card-drag-handle" {...listeners}>
        <CardBody card={card} />
      </div>
      <div className="card-action-bar">
        <button
          className="card-action-btn"
          onClick={() => onEdit?.(card)}
          aria-label="Edit card"
          title="Edit"
        >
          ✎
        </button>
        <button
          className="card-action-btn danger"
          onClick={() => onDelete?.(card.id)}
          aria-label="Delete card"
          title="Delete"
        >
          ×
        </button>
      </div>
    </div>
  );
}
