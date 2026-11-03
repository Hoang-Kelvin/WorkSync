import { useEffect, useState } from 'react';
import { columnLetter, type FileFormat } from '../shared/importRules';
import {
  LANGUAGES,
  LEVELS,
  LEVEL_NAME,
  STATUSES,
  type Level,
  type Status,
} from '../shared/model';
import {
  SOURCE_STATE_NAME,
  type Review,
  type SourceFile,
} from '../shared/sources';
import { useApp } from './appState';
import { Icon } from './Icon';
import { Modal } from './parts';
import type { ViewProps } from './views';

const STATE_CLASS = {
  ok: 'ok',
  changed: 'chg',
  missing: 'miss',
  unavailable: 'na',
  unreadable: 'miss',
} as const;
const name = (p: string) => p.split(/[\\/]/).pop() ?? p;
const when = (iso: string) =>
  new Date(iso).toLocaleString('en-GB', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });

/** Each project's linked source files and their state (spec 03, Files). */
export function FilesView({
  projectId,
  props,
  onLink,
  onReview,
}: {
  projectId: string;
  props: ViewProps;
  onLink: () => void;
  onReview: (s: SourceFile) => void;
}) {
  const { sources, project, attempt, toast, setSources, reloadTasks } =
    useApp();
  const p = project(projectId)!;
  const list = sources.filter((s) => s.projectId === projectId);
  const [confirm, setConfirm] = useState<SourceFile | null>(null);
  const check = async () => {
    const s = await attempt(() => window.worksync.checkSources());
    if (s) {
      setSources(s);
      toast('Checked the linked files.');
    }
  };
  return (
    <>
      {props.header(
        'Files',
        `${p.name} · files are linked by their path and only ever read`,
        <div style={{ display: 'flex', gap: 8 }}>
          {list.length > 0 && (
            <button className="btn" onClick={() => void check()}>
              <Icon name="refresh" />
              <span className="lbl">Check now</span>
            </button>
          )}
          <button className="btn primary" onClick={onLink}>
            <Icon name="link" />
            <span className="lbl">Link a file</span>
          </button>
        </div>,
      )}
      {list.length ? (
        <div className="panel">
          <div className="tbl-wrap">
            <table>
              <thead>
                <tr>
                  <th>File</th>
                  <th>State</th>
                  <th>Last read</th>
                  <th>Main language</th>
                  <th>Tasks</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {list.map((s) => (
                  <tr key={s.id}>
                    <td>
                      <div style={{ fontWeight: 600 }}>
                        {s.pattern
                          ? `${s.pattern} (newest: ${name(s.currentFile)})`
                          : name(s.path)}
                      </div>
                      <div className="path">{s.pattern ? s.path : s.path}</div>
                      <div className="muted" style={{ fontSize: 12 }}>
                        Format {s.format.name} · sheet {s.format.sheet}
                      </div>
                    </td>
                    <td>
                      <span className={`state ${STATE_CLASS[s.state]}`}>
                        {SOURCE_STATE_NAME[s.state]}
                      </span>
                      {s.stateDetail && (
                        <div className="muted state-detail">
                          {s.stateDetail}
                        </div>
                      )}
                    </td>
                    <td>{when(s.lastReadAt)}</td>
                    <td>{LANGUAGES[s.mainLanguage]}</td>
                    <td className="mono">{s.taskCount}</td>
                    <td>
                      <div
                        style={{
                          display: 'flex',
                          gap: 6,
                          justifyContent: 'flex-end',
                          flexWrap: 'wrap',
                        }}
                      >
                        {s.state === 'changed' && (
                          <button
                            className="btn sm accent-outline"
                            onClick={() => onReview(s)}
                          >
                            Review changes
                          </button>
                        )}
                        <button
                          className="btn sm"
                          title="Open in Excel"
                          onClick={() =>
                            void attempt(() =>
                              window.worksync.openSourceFile(s.id),
                            )
                          }
                        >
                          Open
                        </button>
                        <button
                          className="btn sm"
                          title="Stop following this file"
                          onClick={() => setConfirm(s)}
                        >
                          Unlink
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <div className="empty">
          <p style={{ margin: '0 0 12px' }}>
            No files linked yet. Link the customer’s Excel file, for example the
            WBS or the issue list in your Box Drive folder.
          </p>
          <button className="btn primary" onClick={onLink}>
            <Icon name="link" />
            Link a file
          </button>
        </div>
      )}
      <div className="legend">
        <span>
          <Icon name="shield" />
          WorkSync copies each version into its own data folder and reads the
          copy, so the customer’s file is never changed or kept open.
        </span>
      </div>
      {confirm && (
        <Modal
          title={`Unlink ${name(confirm.currentFile)}?`}
          subtitle="Its tasks stay, with their history, and are marked Removed from file. The file itself is not touched."
          onClose={() => setConfirm(null)}
          narrow
          footer={
            <>
              <button className="btn" onClick={() => setConfirm(null)}>
                Keep it
              </button>
              <button
                className="btn danger"
                onClick={() =>
                  void attempt(async () => {
                    await window.worksync.unlinkSource(confirm.id);
                    setSources(await window.worksync.listSources());
                    await reloadTasks();
                    setConfirm(null);
                    toast('Unlinked. The tasks are kept.');
                  })
                }
              >
                Unlink
              </button>
            </>
          }
        >
          <div className="path">{confirm.currentFile}</div>
        </Modal>
      )}
    </>
  );
}

const FIELD_LABEL: Record<string, string> = {
  customerId: 'ID',
  title: 'Title',
  description: 'Description',
  assignee: 'Assignee',
  plannedStart: 'Planned start',
  plannedEnd: 'Planned end',
  actualStart: 'Actual start',
  actualEnd: 'Actual end',
  statusWord: 'Status',
  priorityWord: 'Priority',
  category: 'Category',
  remarks: 'Remarks',
};
const label = (f: string) =>
  f.startsWith('extra:') ? f.slice(6) : (FIELD_LABEL[f] ?? f);

/** Reviewing a new version (spec 03): nothing changes until the owner applies it. */
export function ReviewDialog({
  source,
  onClose,
}: {
  source: SourceFile;
  onClose: () => void;
}) {
  const { attempt, toast, reloadTasks, setSources } = useApp();
  const [review, setReview] = useState<Review | null>(null);
  const [byTitle, setByTitle] = useState(false);
  const [tab, setTab] = useState<'added' | 'changed' | 'removed'>('changed');
  const [add, setAdd] = useState<Set<number>>(new Set());
  const [change, setChange] = useState<Set<string>>(new Set());
  const [remove, setRemove] = useState<Set<string>>(new Set());
  const [keepMine, setKeepMine] = useState<Record<string, Set<string>>>({});
  const [format, setFormat] = useState<FileFormat>(source.format);
  const [busy, setBusy] = useState(false);

  const load = async (bt: boolean, f?: FileFormat) => {
    if (f) {
      const s = await attempt(() =>
        window.worksync.updateSourceFormat(source.id, f),
      );
      if (!s) return;
    }
    const r = await attempt(() => window.worksync.reviewSource(source.id, bt));
    if (!r) return onClose();
    setReview(r);
    setAdd(new Set(r.added.map((x) => x.row)));
    setChange(new Set(r.changed.map((x) => x.taskId)));
    setRemove(new Set(r.removed.map((x) => x.taskId)));
    // Where the owner also changed a field, keep the owner's value until they choose otherwise.
    setKeepMine(
      Object.fromEntries(
        r.changed.map((c) => [
          c.taskId,
          new Set(c.changes.filter((x) => x.conflict).map((x) => x.field)),
        ]),
      ),
    );
    setTab(r.changed.length ? 'changed' : r.added.length ? 'added' : 'removed');
  };
  useEffect(() => {
    void load(false);
    // Load once when the dialog opens.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!review) {
    return (
      <Modal
        title="Review the new version"
        subtitle={name(source.currentFile)}
        onClose={onClose}
        narrow
      >
        <p className="muted">Reading the file…</p>
      </Modal>
    );
  }

  const unmapped =
    review.unmappedStatus.length + review.unmappedPriority.length > 0;
  const toggle = <T,>(set: Set<T>, v: T, put: (s: Set<T>) => void) => {
    const n = new Set(set);
    if (n.has(v)) n.delete(v);
    else n.add(v);
    put(n);
  };
  const count = add.size + change.size + remove.size;

  const apply = async () => {
    setBusy(true);
    const r = await attempt(() =>
      window.worksync.applySource(source.id, {
        byTitle,
        addRows: [...add],
        change: [...change].map((taskId) => ({
          taskId,
          keepMine: [...(keepMine[taskId] ?? [])],
        })),
        removeTaskIds: [...remove],
      }),
    );
    setBusy(false);
    if (!r) return;
    await reloadTasks();
    setSources(await window.worksync.listSources());
    toast(
      `Applied: ${r.added} new, ${r.changed} changed, ${r.removed} removed. Each task’s history records it.`,
    );
    onClose();
  };

  return (
    <Modal
      title="Review the new version"
      subtitle={`${review.fileName} changed ${when(review.modifiedAt)}. Nothing changes until you apply it.`}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Later
          </button>
          <button
            className="btn primary"
            disabled={busy || unmapped}
            onClick={() => void apply()}
          >
            <Icon name="check" />
            {count
              ? `Apply ${count} change${count === 1 ? '' : 's'}`
              : 'Mark as reviewed'}
          </button>
        </>
      }
    >
      {unmapped && (
        <div className="panel" style={{ padding: 12 }}>
          <b>New values in the file</b>
          <p className="muted" style={{ margin: '4px 0 10px' }}>
            Say what they mean once. The file format remembers them.
          </p>
          <div className="map-grid">
            {review.unmappedStatus.map((v) => (
              <label key={`s${v}`}>
                Status “{v}”
                <select
                  className="inp"
                  defaultValue=""
                  onChange={(e) =>
                    setFormat({
                      ...format,
                      statusWords: {
                        ...format.statusWords,
                        [v]: e.target.value as Status,
                      },
                    })
                  }
                >
                  <option value="">Choose…</option>
                  {STATUSES.map((s) => (
                    <option key={s}>{s}</option>
                  ))}
                </select>
              </label>
            ))}
            {review.unmappedPriority.map((v) => (
              <label key={`p${v}`}>
                Priority “{v}”
                <select
                  className="inp"
                  defaultValue=""
                  onChange={(e) =>
                    setFormat({
                      ...format,
                      priorityWords: {
                        ...format.priorityWords,
                        [v]: e.target.value as Level,
                      },
                    })
                  }
                >
                  <option value="">Choose…</option>
                  {LEVELS.map((l) => (
                    <option key={l} value={l}>
                      {LEVEL_NAME[l]}
                    </option>
                  ))}
                </select>
              </label>
            ))}
          </div>
          <button
            className="btn sm primary"
            style={{ marginTop: 10 }}
            disabled={
              [...review.unmappedStatus].some((v) => !format.statusWords[v]) ||
              [...review.unmappedPriority].some((v) => !format.priorityWords[v])
            }
            onClick={() => void load(byTitle, format)}
          >
            Save and continue
          </button>
        </div>
      )}
      {review.looksRenumbered && !byTitle && (
        <div className="keepnote">
          <Icon name="alert" />
          <span>
            Many IDs changed while the titles stayed the same, so the file seems
            to be renumbered.{' '}
            <button
              className="linkbtn"
              onClick={() => {
                setByTitle(true);
                void load(true);
              }}
            >
              Match by title instead
            </button>
          </span>
        </div>
      )}
      <div className="tabs" role="tablist">
        {(
          [
            ['added', 'New tasks', review.added.length],
            ['changed', 'Changed', review.changed.length],
            ['removed', 'Removed', review.removed.length],
          ] as const
        ).map(([k, l, n]) => (
          <button
            key={k}
            role="tab"
            aria-selected={tab === k}
            onClick={() => setTab(k)}
          >
            {l} · {n}
          </button>
        ))}
      </div>
      <div className="review-list">
        {tab === 'added' &&
          (review.added.length ? (
            review.added.map((r) => (
              <label className="diff-row" key={r.row}>
                <input
                  type="checkbox"
                  checked={add.has(r.row)}
                  onChange={() => toggle(add, r.row, setAdd)}
                />
                <div>
                  <span className="tid">
                    No. {r.customerId || '–'} · row {r.row}
                  </span>
                  <div
                    className="title"
                    style={{ fontSize: 14 }}
                    lang={source.mainLanguage}
                  >
                    {r.title}
                  </div>
                  <div className="chg">
                    New row · added as Not translated · {r.status}
                  </div>
                </div>
              </label>
            ))
          ) : (
            <p className="muted">No new rows.</p>
          ))}
        {tab === 'changed' &&
          (review.changed.length ? (
            review.changed.map((c) => (
              <div className="diff-row" key={c.taskId}>
                <input
                  type="checkbox"
                  checked={change.has(c.taskId)}
                  onChange={() => toggle(change, c.taskId, setChange)}
                  aria-label={`Apply changes to No. ${c.customerId}`}
                />
                <div>
                  <span className="tid">No. {c.customerId}</span>
                  <div className="title" style={{ fontSize: 14 }}>
                    {c.title}
                  </div>
                  {c.changes.map((x) => (
                    <div key={x.field} className="chg">
                      <span>{label(x.field)}</span>:{' '}
                      <span className="old">{x.from || '(empty)'}</span>
                      <span className="arrow">→</span>
                      <span className="new">{x.to || '(empty)'}</span>
                      {x.conflict && (
                        <div className="conflict">
                          <b>You changed this too</b>
                          <label>
                            <input
                              type="radio"
                              name={`${c.taskId}:${x.field}`}
                              checked={
                                keepMine[c.taskId]?.has(x.field) ?? false
                              }
                              onChange={() =>
                                setKeepMine({
                                  ...keepMine,
                                  [c.taskId]: new Set([
                                    ...(keepMine[c.taskId] ?? []),
                                    x.field,
                                  ]),
                                })
                              }
                            />{' '}
                            Keep yours: {x.appValue || '(empty)'}
                          </label>
                          <label>
                            <input
                              type="radio"
                              name={`${c.taskId}:${x.field}`}
                              checked={!keepMine[c.taskId]?.has(x.field)}
                              onChange={() =>
                                setKeepMine({
                                  ...keepMine,
                                  [c.taskId]: new Set(
                                    [...(keepMine[c.taskId] ?? [])].filter(
                                      (f) => f !== x.field,
                                    ),
                                  ),
                                })
                              }
                            />{' '}
                            Use the file: {x.to || '(empty)'}
                          </label>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ))
          ) : (
            <p className="muted">No changed tasks.</p>
          ))}
        {tab === 'removed' &&
          (review.removed.length ? (
            review.removed.map((r) => (
              <label className="diff-row" key={r.taskId}>
                <input
                  type="checkbox"
                  checked={remove.has(r.taskId)}
                  onChange={() => toggle(remove, r.taskId, setRemove)}
                />
                <div>
                  <span className="tid">No. {r.customerId}</span>
                  <div className="title" style={{ fontSize: 14 }}>
                    {r.title}
                  </div>
                  <div className="chg">
                    No longer in the file. The task is kept with its history and
                    marked Removed from file.
                  </div>
                </div>
              </label>
            ))
          ) : (
            <p className="muted">No removed rows.</p>
          ))}
      </div>
      {review.skipped.length > 0 && (
        <details className="skipped">
          <summary>
            {review.skipped.length} rows were skipped, such as blank rows,
            totals and section titles
          </summary>
          <ul>
            {review.skipped.slice(0, 50).map((s) => (
              <li key={s.row}>
                <span className="mono">Row {s.row}</span> ·{' '}
                {s.text.slice(0, 80)}
              </li>
            ))}
          </ul>
        </details>
      )}
      <p className="muted" style={{ fontSize: 12 }}>
        Columns:{' '}
        {Object.entries(source.format.columns)
          .map(
            ([f, c]) =>
              `${label(f === 'status' ? 'statusWord' : f === 'priority' ? 'priorityWord' : f)} ${columnLetter(c!)}`,
          )
          .join(' · ')}
      </p>
    </Modal>
  );
}
