import { useEffect, useRef, useState, type FormEvent } from 'react';
import {
  LANGUAGES,
  LEVEL_NAME,
  WAITING_ON,
  brief,
  daysBetween,
  fileDate,
  flags,
  shortDate,
  shownPriority,
  type ActivityEntry,
  type Task,
  type WaitingOn,
} from '../shared/model';
import { useApp } from './appState';
import { Icon } from './Icon';
import {
  DeadlineChip,
  StatusChip,
  TaskNumber,
  Titles,
  priorityClass,
} from './parts';

/** Splits text into paragraphs on blank lines, or on single lines when there are none. */
const paragraphs = (text: string): string[] => {
  const t = text.trim();
  if (!t) return [];
  const blocks = t.split(/\n\s*\n/);
  return (blocks.length > 1 ? blocks : t.split('\n'))
    .map((p) => p.trim())
    .filter(Boolean);
};

function Description({ task }: { task: Task }) {
  const { originalFirst } = useApp();
  const [mode, setMode] = useState<'both' | 'translation' | 'original'>('both');
  const [open, setOpen] = useState(false);
  const orig = paragraphs(task.descriptionOriginal);
  const tr = paragraphs(task.descriptionTranslation);
  if (!orig.length && !tr.length) {
    return (
      <section className="sec">
        <h3>Description</h3>
        <div className="muted">No description.</div>
      </section>
    );
  }
  const langName = LANGUAGES[task.language];
  const same = task.translationState === 'Not needed' || !tr.length;
  const long =
    Math.max(orig.length, tr.length) > 2 ||
    (orig.join(' ') + tr.join(' ')).length > 700;
  let body;
  if (same || mode === 'original') {
    body = (
      <div className="single">
        {orig.map((p, i) => (
          <p key={i} lang={task.language}>
            {p}
          </p>
        ))}
      </div>
    );
  } else if (mode === 'translation') {
    body = (
      <div className="single">
        {tr.map((p, i) => (
          <p key={i}>{p}</p>
        ))}
      </div>
    );
  } else {
    const left = originalFirst ? orig : tr;
    const right = originalFirst ? tr : orig;
    const n = Math.max(left.length, right.length);
    body = (
      <div className="pairs">
        <div className="ph">
          <span>
            {originalFirst ? `Original · ${langName}` : 'Translation'}
          </span>
          <span>
            {originalFirst ? 'Translation' : `Original · ${langName}`}
          </span>
        </div>
        {Array.from({ length: n }, (_, i) => (
          <div className="pp" key={i}>
            <p lang={originalFirst ? task.language : undefined}>
              {left[i] ?? ''}
            </p>
            <p lang={originalFirst ? undefined : task.language}>
              {right[i] ?? ''}
            </p>
          </div>
        ))}
      </div>
    );
  }
  return (
    <section className="sec">
      <div className="desc-h">
        <h3>
          Description
          {long && (
            <span className="fresh">
              · {Math.max(orig.length, tr.length)} paragraphs
            </span>
          )}
        </h3>
        {same ? (
          <span className="muted" style={{ fontSize: 12.5 }}>
            {task.translationState === 'Not needed'
              ? 'Already in the working language'
              : 'Not translated yet'}
          </span>
        ) : (
          <div
            className="seg-ctl"
            role="group"
            aria-label="Description language"
          >
            {(
              [
                ['both', 'Side by side'],
                ['translation', 'Translation'],
                ['original', 'Original'],
              ] as const
            ).map(([k, l]) => (
              <button
                key={k}
                aria-pressed={mode === k}
                onClick={() => setMode(k)}
              >
                {l}
              </button>
            ))}
          </div>
        )}
      </div>
      <div
        className={`desc-body ${long && !open ? 'clipped' : ''}`}
        id="descBody"
      >
        {body}
      </div>
      {long && (
        <div className="desc-more">
          <button
            className="btn sm"
            aria-expanded={open}
            aria-controls="descBody"
            onClick={() => setOpen(!open)}
          >
            <Icon name="chev" />
            {open ? 'Show less' : 'Show the full description'}
          </button>
        </div>
      )}
    </section>
  );
}

function SituationForm({ task, onDone }: { task: Task; onDone: () => void }) {
  const { putTask, toast, attempt } = useApp();
  const s = task.situation;
  const [v, setV] = useState({
    handledBy: s.handledBy,
    doingNow: s.doingNow,
    waitingOn: s.waitingOn,
    nextStep: s.nextStep,
    nextDate: s.nextDate ?? '',
    difficulty: '',
    resolver: '',
  });
  const set = (k: keyof typeof v) => (e: { target: { value: string } }) =>
    setV({ ...v, [k]: e.target.value });
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const u = await attempt(() =>
      window.worksync.addSituationUpdate(task.id, {
        handledBy: v.handledBy,
        doingNow: v.doingNow,
        waitingOn: v.waitingOn as WaitingOn,
        nextStep: v.nextStep,
        nextDate: v.nextDate || null,
        newDifficulty: v.difficulty.trim()
          ? { text: v.difficulty, resolver: v.resolver }
          : undefined,
      }),
    );
    if (u) {
      putTask(u);
      toast('Situation updated. The brief now shows it.');
      onDone();
    }
  };
  return (
    <form className="update" onSubmit={submit}>
      <div className="two">
        <label>
          Handled by
          <input
            className="inp"
            value={v.handledBy}
            onChange={set('handledBy')}
            placeholder="Who is working on it now"
            autoFocus
          />
        </label>
        <label>
          Waiting on
          <select
            className="inp"
            value={v.waitingOn}
            onChange={set('waitingOn')}
          >
            {WAITING_ON.map((w) => (
              <option key={w}>{w}</option>
            ))}
          </select>
        </label>
      </div>
      <label>
        Doing now
        <textarea
          className="inp"
          rows={2}
          value={v.doingNow}
          onChange={set('doingNow')}
        />
      </label>
      <div className="two">
        <label>
          Next step
          <input
            className="inp"
            value={v.nextStep}
            onChange={set('nextStep')}
          />
        </label>
        <label>
          Expected date
          <input
            className="inp"
            type="date"
            value={v.nextDate}
            onChange={set('nextDate')}
          />
        </label>
      </div>
      <div className="two">
        <label>
          New difficulty (optional)
          <input
            className="inp"
            value={v.difficulty}
            onChange={set('difficulty')}
            placeholder="What is slowing the work down?"
          />
        </label>
        <label>
          Who can resolve it
          <input
            className="inp"
            value={v.resolver}
            onChange={set('resolver')}
          />
        </label>
      </div>
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <button type="button" className="btn" onClick={onDone}>
          Cancel
        </button>
        <button className="btn primary" type="submit">
          <Icon name="check" />
          Save update
        </button>
      </div>
    </form>
  );
}

function History({ task }: { task: Task }) {
  const { attempt } = useApp();
  const [entries, setEntries] = useState<ActivityEntry[]>([]);
  const [note, setNote] = useState('');
  const [adding, setAdding] = useState(false);
  useEffect(() => {
    void window.worksync.listActivity(task.id).then(setEntries);
  }, [task.id, task.updatedAt]);
  const add = async (e: FormEvent) => {
    e.preventDefault();
    if (!note.trim()) return;
    await attempt(() => window.worksync.addNote(task.id, note));
    setNote('');
    setAdding(false);
    setEntries(await window.worksync.listActivity(task.id));
  };
  return (
    <section className="sec">
      <h3>
        History
        <button
          className="linkbtn"
          style={{
            marginLeft: 'auto',
            textTransform: 'none',
            letterSpacing: 0,
          }}
          onClick={() => setAdding(!adding)}
        >
          Add an entry
        </button>
      </h3>
      {adding && (
        <form className="update" onSubmit={add} style={{ marginBottom: 12 }}>
          <label>
            What happened
            <textarea
              className="inp"
              rows={2}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="For example, a decision made in a meeting with the customer"
              autoFocus
            />
          </label>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button
              type="button"
              className="btn sm"
              onClick={() => setAdding(false)}
            >
              Cancel
            </button>
            <button className="btn sm primary" type="submit">
              Add
            </button>
          </div>
        </form>
      )}
      <ul className="hist">
        {entries.map((h) => (
          <li
            key={h.id}
            className={h.kind === 'Situation update' ? 'situation' : ''}
          >
            <span className="when">
              {fileDate(h.at.slice(0, 10))}{' '}
              {new Date(h.at).toTimeString().slice(0, 5)}
            </span>
            <span className="kind">{h.kind}</span>
            <div>{h.text}</div>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function TaskPopup({
  taskId,
  onClose,
  onEdit,
  onDelete,
  openMenu,
}: {
  taskId: string;
  onClose: () => void;
  onEdit: (t: Task) => void;
  onDelete: (t: Task) => void;
  openMenu: (task: Task, opener: HTMLElement) => void;
}) {
  const { tasks, project, today, putTask, toast, attempt } = useApp();
  const task = tasks.find((t) => t.id === taskId);
  const [updating, setUpdating] = useState(false);
  const titleRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    setTimeout(
      () => document.getElementById('tmTitle')?.focus({ preventScroll: true }),
      30,
    );
    return () => opener?.focus?.();
  }, [taskId]);

  if (!task) return null;
  const p = project(task.projectId)!;
  const f = flags(task, today, p.dueSoonDays);
  const s = task.situation;
  const asOfDays = s.asOf ? daysBetween(s.asOf, today) : null;
  const fresh =
    asOfDays === null
      ? 'never confirmed'
      : asOfDays === 0
        ? 'confirmed today'
        : `confirmed ${asOfDays} day${asOfDays > 1 ? 's' : ''} ago`;
  const level = shownPriority(task);
  const flagChips = [
    f.nextStepOverdue && 'Next step overdue',
    f.lateToStart && 'Late to start',
    f.briefIncomplete && 'Brief incomplete',
  ].filter(Boolean) as string[];

  const copyBrief = async () => {
    try {
      await navigator.clipboard.writeText(brief(task).text);
      toast('Brief copied. Paste it into chat or email.');
    } catch {
      toast('Copying was blocked. Try again with the window in front.');
    }
  };
  const pin = async () => {
    const u = await attempt(() =>
      window.worksync.setPinned(task.id, !task.pinned),
    );
    if (u) {
      putTask(u);
      toast(
        u.pinned
          ? `Pinned No. ${u.customerId} to the focus list.`
          : `Unpinned No. ${u.customerId}.`,
      );
    }
  };
  const toggleDifficulty = async (id: string, open: boolean) => {
    const u = await attempt(() =>
      window.worksync.setDifficultyOpen(task.id, id, open),
    );
    if (u) putTask(u);
  };

  return (
    <div
      className="tm-bg"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        className={`tm ${priorityClass(task)}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="tmTitle"
      >
        <header className="tm-head">
          <div className="tm-top">
            <TaskNumber task={task} />
            <button
              className={`pri-btn ${level} ${task.priorityOverride ? 'ovr' : ''}`}
              aria-haspopup="dialog"
              title="Change priority"
              onClick={(e) => openMenu(task, e.currentTarget)}
            >
              {task.priorityOverride && <Icon name="user" />}
              {LEVEL_NAME[level]}
              {task.priorityOverride && (
                <span className="sr">, your override</span>
              )}
              <Icon name="chev" />
            </button>
            <span className="pname">{p.name}</span>
            <span className="sp" />
            <button
              className="icon-btn"
              title="Edit task"
              aria-label="Edit task"
              onClick={() => onEdit(task)}
            >
              <Icon name="edit" />
            </button>
            <button
              className="icon-btn"
              aria-pressed={task.pinned}
              title={
                task.pinned
                  ? 'Unpin from the focus list'
                  : 'Pin to the focus list'
              }
              style={task.pinned ? { color: 'var(--accent)' } : undefined}
              onClick={() => void pin()}
            >
              <Icon name="pin" />
            </button>
            <button
              className="icon-btn"
              title="Delete task"
              aria-label="Delete task"
              onClick={() => onDelete(task)}
            >
              <Icon name="trash" />
            </button>
            <button className="icon-btn" aria-label="Close" onClick={onClose}>
              <Icon name="x" />
            </button>
          </div>
          <div ref={titleRef}>
            <Titles task={task} big />
          </div>
          <div className="tm-meta">
            <StatusChip status={task.status} />
            <DeadlineChip task={task} dueSoonDays={p.dueSoonDays} />
            {flagChips.map((x) => (
              <span key={x} className="chip over">
                {x}
              </span>
            ))}
            {task.labels.map((l) => (
              <span key={l} className="label">
                {l}
              </span>
            ))}
            <span className="sp" />
            <button className="btn" onClick={() => void copyBrief()}>
              <Icon name="copy" />
              Copy brief
            </button>
            <button className="btn primary" onClick={() => setUpdating(true)}>
              <Icon name="edit" />
              Update situation
            </button>
          </div>
        </header>
        <div className="tm-body">
          <div className="tm-main">
            <section className="sec">
              <h3>Summary</h3>
              {task.summary ? (
                <div className="summary">{task.summary}</div>
              ) : (
                <div className="summary missing">
                  <span>
                    No summary yet, so this task’s brief is incomplete.
                  </span>
                  <button className="btn sm" onClick={() => onEdit(task)}>
                    Write a summary
                  </button>
                </div>
              )}
            </section>
            <section className="sec">
              <h3>
                Situation <span className="fresh">· {fresh}</span>
              </h3>
              <div className="situ">
                {updating ? (
                  <SituationForm
                    task={task}
                    onDone={() => setUpdating(false)}
                  />
                ) : (
                  <dl className="kv">
                    <dt>Handled by</dt>
                    <dd>{s.handledBy || 'Not recorded'}</dd>
                    <dt>Doing now</dt>
                    <dd>{s.doingNow || 'Not recorded'}</dd>
                    <dt>Difficulties</dt>
                    <dd>
                      {task.difficulties.length ? (
                        <ul className="diffs">
                          {task.difficulties.map((d) => (
                            <li key={d.id}>
                              <Icon name={d.open ? 'alert' : 'check'} />
                              <span>
                                <span className={d.open ? '' : 'res'}>
                                  {d.text}
                                </span>
                                <br />
                                <span className="by">
                                  {d.resolver ? `${d.resolver} · ` : ''}since{' '}
                                  {shortDate(d.raisedOn)}
                                  {d.open ? '' : ' · resolved'} ·{' '}
                                  <button
                                    className="linkbtn"
                                    onClick={() =>
                                      void toggleDifficulty(d.id, !d.open)
                                    }
                                  >
                                    {d.open ? 'Mark resolved' : 'Reopen'}
                                  </button>
                                </span>
                              </span>
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <span className="muted">None</span>
                      )}
                    </dd>
                    <dt>Waiting on</dt>
                    <dd>
                      {s.waitingOn === 'Nobody' ? (
                        'Nobody'
                      ) : (
                        <span className="chip">
                          <Icon name="ball" />
                          {s.waitingOn}
                        </span>
                      )}
                    </dd>
                    <dt>Next step</dt>
                    <dd>
                      {s.nextStep ? (
                        <>
                          <b>{s.nextStep}</b>
                          {s.nextDate && (
                            <span className="muted">
                              {' '}
                              by {shortDate(s.nextDate)}
                            </span>
                          )}
                        </>
                      ) : (
                        'Not decided yet'
                      )}
                    </dd>
                    <dt>As of</dt>
                    <dd className="mono">
                      {s.asOf ? fileDate(s.asOf) : 'Never'}
                    </dd>
                  </dl>
                )}
              </div>
            </section>
            <Description task={task} />
          </div>
          <aside className="tm-side">
            <section className="sec">
              <h3>Task fields</h3>
              <div className="fields">
                <Field
                  k="Assignee"
                  v={task.assignee || <span className="muted">Not set</span>}
                />
                <Field k="Status" v={task.status} />
                <Field
                  k="Planned"
                  v={
                    task.plannedStart || task.plannedEnd ? (
                      <span className="mono">
                        {fileDate(task.plannedStart) || '…'} →{' '}
                        {fileDate(task.plannedEnd) || '…'}
                      </span>
                    ) : (
                      <span className="muted">No dates</span>
                    )
                  }
                />
                <Field
                  k="Actual"
                  v={
                    task.actualStart ? (
                      <span className="mono">
                        {fileDate(task.actualStart)} →{' '}
                        {task.actualEnd ? fileDate(task.actualEnd) : 'ongoing'}
                      </span>
                    ) : (
                      <span className="muted">Not started</span>
                    )
                  }
                />
                <Field
                  k="Priority"
                  v={
                    <>
                      {LEVEL_NAME[task.priority]}{' '}
                      <button
                        className="linkbtn"
                        onClick={(e) => openMenu(task, e.currentTarget)}
                      >
                        Change
                      </button>
                    </>
                  }
                />
                <Field
                  k="Category"
                  v={task.category || <span className="muted">Not set</span>}
                />
                <Field
                  k="Remarks"
                  v={
                    task.remarks ? (
                      <span lang={task.language}>{task.remarks}</span>
                    ) : (
                      <span className="muted">Empty</span>
                    )
                  }
                />
              </div>
            </section>
            <section className="sec">
              <h3>Only for you</h3>
              <div className="fields">
                <Field
                  k={
                    <>
                      <Icon name="check" />
                      Next action
                    </>
                  }
                  v={
                    task.nextAction ? (
                      <>
                        {task.nextAction}
                        {task.nextActionDate && (
                          <span className="muted">
                            {' '}
                            · {shortDate(task.nextActionDate)}
                          </span>
                        )}
                      </>
                    ) : (
                      <span className="muted">None</span>
                    )
                  }
                />
                <Field
                  k="Notes"
                  v={
                    task.notes ? (
                      <span style={{ whiteSpace: 'pre-wrap' }}>
                        {task.notes}
                      </span>
                    ) : (
                      <span className="muted">None</span>
                    )
                  }
                />
              </div>
            </section>
            <History task={task} />
            <section className="sec">
              <h3>Source</h3>
              <div className="field">
                <div className="v">
                  Added by hand in WorkSync · {LANGUAGES[task.language]}
                </div>
              </div>
            </section>
          </aside>
        </div>
      </div>
    </div>
  );
}

const Field = ({ k, v }: { k: React.ReactNode; v: React.ReactNode }) => (
  <div className="field">
    <div className="k">{k}</div>
    <div className="v">{v}</div>
  </div>
);
