import { useEffect, useState } from 'react';
import type { AppInfo } from '../shared/ipc';

export function App() {
  const [info, setInfo] = useState<AppInfo | null>(null);

  useEffect(() => {
    window.worksync.getAppInfo().then(setInfo);
  }, []);

  return (
    <div className="app">
      <header className="app-header">
        <h1>WorkSync</h1>
        <p>Create tasks and assign them to your team.</p>
      </header>

      <main className="app-main">
        <section className="empty-state">
          <h2>No tasks yet</h2>
          <p>Task management is coming soon.</p>
        </section>
      </main>

      <footer className="app-footer">
        {info ? (
          <span>
            {info.name} v{info.version} · {info.platform} · Electron{' '}
            {info.electronVersion}
          </span>
        ) : (
          <span>Loading…</span>
        )}
      </footer>
    </div>
  );
}
