import { useEffect, useState } from 'react';
import type { AppInfo, CheckResult } from '../shared/ipc';

/**
 * Work PC check: the first test build only confirms that WorkSync runs on the
 * work PC from an unzipped folder and can save data beside it. Task features
 * come in the next build step.
 */
export function App() {
  const [info, setInfo] = useState<AppInfo | null>(null);
  const [checks, setChecks] = useState<CheckResult[] | null>(null);

  useEffect(() => {
    window.worksync.getAppInfo().then(setInfo);
    window.worksync.runPcChecks().then(setChecks);
  }, []);

  const allOk = checks?.every((c) => c.ok) ?? false;

  return (
    <div className="app">
      <header className="app-header">
        <h1>WorkSync</h1>
        <p>Work PC check · test build</p>
      </header>

      <main className="app-main">
        <section className="panel" aria-live="polite">
          {checks === null ? (
            <p className="muted">Checking…</p>
          ) : (
            <>
              <h2 className={allOk ? 'ok' : 'bad'}>
                {allOk
                  ? 'WorkSync can run on this PC'
                  : 'Something needs attention'}
              </h2>
              <ul className="checks">
                {checks.map((c) => (
                  <li key={c.name} className={c.ok ? 'ok' : 'bad'}>
                    <span className="mark" aria-hidden="true">
                      {c.ok ? '✓' : '!'}
                    </span>
                    <span>
                      <b>{c.name}</b>
                      <span className="detail">{c.detail}</span>
                    </span>
                  </li>
                ))}
              </ul>
              <p className="muted">
                {allOk
                  ? 'Nothing else to do. You can close this window. Task features come in the next build.'
                  : 'Note what the failed line says. Often the fix is to unzip WorkSync into a folder on a local drive that you can write to.'}
              </p>
            </>
          )}
        </section>
      </main>

      <footer className="app-footer">
        {info ? (
          <span>
            {info.name} v{info.version} · {info.platform} {info.arch} · Electron{' '}
            {info.electronVersion}
            {info.packaged ? '' : ' · development'}
          </span>
        ) : (
          <span>Loading…</span>
        )}
      </footer>
    </div>
  );
}
