import { useEffect, useState } from 'react';
import { getStoredTheme, toggleTheme } from '../lib/theme.js';

export default function Toolbar({
  snapshots,
  currentSnapshotId,
  onSwitch,
  onCreateSnapshot,
  onRenameSnapshot,
  onDeleteSnapshot,
  onAddColumn,
}) {
  const current = snapshots.find((s) => s.id === currentSnapshotId);

  // Local mirror of the theme so the icon flips immediately on click.
  // Source of truth is the `data-theme` attribute on <html>, driven by
  // src/lib/theme.js. We seed from the stored value on mount.
  const [theme, setTheme] = useState('dark');
  useEffect(() => {
    setTheme(getStoredTheme());
  }, []);

  function handleToggleTheme() {
    const next = toggleTheme();
    setTheme(next);
  }

  function handleNewSnapshot() {
    const name = window.prompt('New snapshot name', 'Untitled frame');
    if (name && name.trim()) onCreateSnapshot(name.trim());
  }

  function handleRenameSnapshot() {
    if (!current) return;
    const name = window.prompt('Rename snapshot', current.name);
    if (name && name.trim() && name.trim() !== current.name) {
      onRenameSnapshot(current.id, name.trim());
    }
  }

  function handleDeleteSnapshot() {
    if (!current) return;
    if (snapshots.length <= 1) {
      window.alert('At least one snapshot is required.');
      return;
    }
    const ok = window.confirm(
      `Delete snapshot "${current.name}"?\n\n` +
        'Cards are not deleted — they will stay in other snapshots.'
    );
    if (ok) onDeleteSnapshot(current.id);
  }

  function handleAddColumn() {
    const name = window.prompt('New column name', 'New column');
    if (name && name.trim()) onAddColumn(name.trim());
  }

  return (
    <header className="toolbar">
      <div className="toolbar-left">
        <h1 className="app-title">🗂️ Idea Sorting Board</h1>
      </div>
      <div className="toolbar-center">
        <span className="toolbar-label">Snapshot</span>
        <select
          className="snapshot-select"
          value={currentSnapshotId || ''}
          onChange={(e) => onSwitch(e.target.value)}
        >
          {snapshots.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
        <button
          className="toolbar-btn"
          onClick={handleNewSnapshot}
          title="Create a new snapshot"
        >
          + New
        </button>
        <button
          className="toolbar-btn"
          onClick={handleRenameSnapshot}
          title="Rename current snapshot"
        >
          Rename
        </button>
        <button
          className="toolbar-btn danger"
          onClick={handleDeleteSnapshot}
          title="Delete current snapshot"
        >
          Delete
        </button>
      </div>
      <div className="toolbar-right">
        <button
          className="toolbar-icon-btn"
          onClick={handleToggleTheme}
          title={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
          aria-label="Toggle color theme"
        >
          {theme === 'dark' ? '☀️' : '🌙'}
        </button>
        <button
          className="toolbar-btn primary"
          onClick={handleAddColumn}
          title="Add a column to this snapshot"
        >
          + Add column
        </button>
      </div>
    </header>
  );
}
