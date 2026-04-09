import { useDroppable } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import Card from './Card.jsx';

export default function SidePanel({
  cardIds,
  cardsMap,
  onAddClick,
  onDeleteCard,
  onEditCard,
}) {
  const { setNodeRef, isOver } = useDroppable({ id: 'unplaced' });

  return (
    <aside className={`side-panel ${isOver ? 'side-panel-over' : ''}`}>
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
