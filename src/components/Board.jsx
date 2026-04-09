import { useState, useMemo } from 'react';
import {
  DndContext,
  closestCorners,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  DragOverlay,
} from '@dnd-kit/core';
import { sortableKeyboardCoordinates } from '@dnd-kit/sortable';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/database.js';
import {
  createCard,
  deleteCard,
  updateCardText,
  placeCard,
  createSnapshot,
  renameSnapshot,
  deleteSnapshot,
  switchSnapshot,
  addColumn,
  renameColumn,
  deleteColumn,
} from '../db/actions.js';
import Toolbar from './Toolbar.jsx';
import Column from './Column.jsx';
import SidePanel from './SidePanel.jsx';
import CardModal from './CardModal.jsx';
import { CardPreview } from './Card.jsx';

export default function Board() {
  const cards =
    useLiveQuery(() => db.cards.orderBy('createdAt').toArray(), []) || [];
  const snapshots =
    useLiveQuery(() => db.snapshots.orderBy('createdAt').toArray(), []) || [];
  const currentSnapshotIdRow = useLiveQuery(
    () => db.settings.get('currentSnapshotId'),
    []
  );
  const defaultSourceRow = useLiveQuery(
    () => db.settings.get('defaultSourceLang'),
    []
  );
  const defaultTargetRow = useLiveQuery(
    () => db.settings.get('defaultTargetLang'),
    []
  );

  const currentSnapshotId = currentSnapshotIdRow?.value || null;
  const defaultSourceLang = defaultSourceRow?.value || 'zh-Hant';
  const defaultTargetLang = defaultTargetRow?.value || 'ja';

  const currentSnapshot = snapshots.find((s) => s.id === currentSnapshotId);

  // Quick lookup: card id -> card object.
  const cardsMap = useMemo(() => {
    const m = new Map();
    for (const c of cards) m.set(c.id, c);
    return m;
  }, [cards]);

  // Modal state.
  const [modalOpen, setModalOpen] = useState(false);
  const [editingCard, setEditingCard] = useState(null);

  // DragOverlay state.
  const [activeId, setActiveId] = useState(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  // ----------- Drag helpers -----------
  function findContainerOfCard(id) {
    if (!currentSnapshot) return null;
    if (currentSnapshot.layout.unplacedCardIds.includes(id)) return 'unplaced';
    for (const col of currentSnapshot.layout.columns) {
      if (col.cardIds.includes(id)) return col.id;
    }
    return null;
  }

  function resolveContainerFromOverId(overId) {
    if (!currentSnapshot) return null;
    if (overId === 'unplaced') return 'unplaced';
    if (currentSnapshot.layout.columns.some((c) => c.id === overId)) return overId;
    // Otherwise `overId` is a card id; use the container of that card.
    return findContainerOfCard(overId);
  }

  function getContainerItems(containerId) {
    if (!currentSnapshot) return [];
    if (containerId === 'unplaced') return currentSnapshot.layout.unplacedCardIds;
    const col = currentSnapshot.layout.columns.find((c) => c.id === containerId);
    return col ? col.cardIds : [];
  }

  async function handleDragEnd(event) {
    const { active, over } = event;
    setActiveId(null);
    if (!over || !currentSnapshot) return;

    const fromContainer = findContainerOfCard(active.id);
    const toContainer = resolveContainerFromOverId(over.id);
    if (!fromContainer || !toContainer) return;

    const overIsContainerId =
      over.id === 'unplaced' ||
      currentSnapshot.layout.columns.some((c) => c.id === over.id);

    const toItems = getContainerItems(toContainer);

    // Case 1: dropped on a container directly (usually empty column).
    if (overIsContainerId) {
      if (fromContainer === toContainer) return; // no-op
      await placeCard(currentSnapshot.id, active.id, toContainer, toItems.length);
      return;
    }

    // Case 2: dropped on another card. Compute the insertion index.
    if (fromContainer === toContainer) {
      const oldIndex = toItems.indexOf(active.id);
      const newIndex = toItems.indexOf(over.id);
      if (oldIndex === -1 || newIndex === -1 || oldIndex === newIndex) return;
      // placeCard removes then re-inserts; match dnd-kit semantics.
      await placeCard(currentSnapshot.id, active.id, toContainer, newIndex);
    } else {
      const overIndex = toItems.indexOf(over.id);
      const insertIndex = overIndex === -1 ? toItems.length : overIndex;
      await placeCard(currentSnapshot.id, active.id, toContainer, insertIndex);
    }
  }

  // ----------- Card actions -----------
  async function handleCreateCard(data) {
    await createCard(data);
  }
  async function handleDeleteCard(id) {
    if (
      window.confirm(
        'Delete this card?\n\nIt will disappear from every snapshot.'
      )
    ) {
      await deleteCard(id);
    }
  }
  function handleEditCard(card) {
    setEditingCard(card);
    setModalOpen(true);
  }
  async function handleSubmitCard(data) {
    if (editingCard) {
      await updateCardText(editingCard.id, data);
    } else {
      await handleCreateCard(data);
    }
    setEditingCard(null);
  }

  // ----------- Column actions -----------
  async function handleAddColumn(name) {
    if (!currentSnapshot) return;
    await addColumn(currentSnapshot.id, name);
  }
  async function handleRenameColumn(columnId, newName) {
    if (!currentSnapshot) return;
    await renameColumn(currentSnapshot.id, columnId, newName);
  }
  async function handleDeleteColumn(columnId) {
    if (!currentSnapshot) return;
    if (
      window.confirm(
        'Delete this column?\n\nCards inside will return to the card pool.'
      )
    ) {
      await deleteColumn(currentSnapshot.id, columnId);
    }
  }

  if (!currentSnapshot) {
    return <div className="loading-screen">Loading workspace…</div>;
  }

  const activeCard = activeId ? cardsMap.get(activeId) : null;

  return (
    <div className="app-root">
      <Toolbar
        snapshots={snapshots}
        currentSnapshotId={currentSnapshotId}
        onSwitch={switchSnapshot}
        onCreateSnapshot={createSnapshot}
        onRenameSnapshot={renameSnapshot}
        onDeleteSnapshot={deleteSnapshot}
        onAddColumn={handleAddColumn}
      />

      <DndContext
        sensors={sensors}
        collisionDetection={closestCorners}
        onDragStart={(e) => setActiveId(e.active.id)}
        onDragEnd={handleDragEnd}
        onDragCancel={() => setActiveId(null)}
      >
        <div className="main-layout">
          <div className="board">
            {currentSnapshot.layout.columns.map((col) => (
              <Column
                key={col.id}
                column={col}
                cards={col.cardIds
                  .map((id) => cardsMap.get(id))
                  .filter(Boolean)}
                onRename={handleRenameColumn}
                onDelete={handleDeleteColumn}
                onEditCard={handleEditCard}
                onDeleteCard={handleDeleteCard}
              />
            ))}
            {/* Inline "add column" slot — visible both when empty and
                when populated, so users don't need to hunt for the
                toolbar button. */}
            <button
              className="column-add-slot"
              type="button"
              onClick={() => {
                const name = window.prompt('New column name', 'New column');
                if (name && name.trim()) handleAddColumn(name.trim());
              }}
              title="Add a new column to this snapshot"
            >
              <span className="column-add-slot-plus">+</span>
              <span>Add column</span>
            </button>
          </div>

          <SidePanel
            cardIds={currentSnapshot.layout.unplacedCardIds.filter((id) =>
              cardsMap.has(id)
            )}
            cardsMap={cardsMap}
            onAddClick={() => {
              setEditingCard(null);
              setModalOpen(true);
            }}
            onDeleteCard={handleDeleteCard}
            onEditCard={handleEditCard}
          />
        </div>

        <DragOverlay>
          {activeCard ? <CardPreview card={activeCard} /> : null}
        </DragOverlay>
      </DndContext>

      <CardModal
        open={modalOpen}
        onClose={() => {
          setModalOpen(false);
          setEditingCard(null);
        }}
        onSubmit={handleSubmitCard}
        initial={editingCard}
        defaultSourceLang={defaultSourceLang}
        defaultTargetLang={defaultTargetLang}
      />
    </div>
  );
}
