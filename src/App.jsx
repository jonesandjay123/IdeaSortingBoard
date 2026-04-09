import { useEffect, useState } from 'react';
import { ensureSeeded } from './lib/seedData.js';
import Board from './components/Board.jsx';

export default function App() {
  const [ready, setReady] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    ensureSeeded()
      .then(() => setReady(true))
      .catch((err) => {
        console.error('Seed failed:', err);
        setError(err.message || String(err));
      });
  }, []);

  if (error) {
    return (
      <div className="loading-screen">
        <div>
          <div style={{ marginBottom: 8 }}>Failed to start.</div>
          <div style={{ fontSize: 12, opacity: 0.7 }}>{error}</div>
        </div>
      </div>
    );
  }

  if (!ready) return <div className="loading-screen">Setting up…</div>;
  return <Board />;
}
