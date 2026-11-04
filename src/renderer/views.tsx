import {
  useMemo,
  useState,
  type DragEvent,
  type MouseEvent,
  type ReactNode,
} from 'react';
import {
  STATUSES,
  byPriority,
  flags,
  focusReasons,
  inFocus,
  isClosed,
  type Project,
  type Status,
  type Task,
} from '../shared/model';
import { useApp } from './appState';
import { Icon } from './Icon';
import {
  Labels,
  MetaChips,
  PriorityTag,
  StatusChip,
  TaskNumber,
  Titles,
  DeadlineChip,
  priorityClass,
} from './parts';

export interface ViewProps {
  query: string;
  /** The search and the top bar filter together. */
  match: (t: Task) => boolean;
  /** The top bar filter alone, for views that search on their own. */
  passes: (t: Task) => boolean;
  openTask: (id: string) => void;
  openMenu: (
    task: Task,
    opener: HTMLElement,
    at?: { x: number; y: number },
  ) => void;
  /** Renders the fixed header: title, subtitle and the controls beside them. */
  header: (title: string, subtitle: string, right?: ReactNode) => ReactNode;
}

/** Right-click, or the context menu key, opens the priority menu without opening the task. */
const contextMenu =
  (task: Task, openMenu: ViewProps['openMenu']) =>
  (e: MouseEvent<HTMLElement>) => {
    e.preventDefault();
    const r = e.currentTarget.getBoundingClientRect();
    const keyboard = !e.clientX && !e.clientY;
    openMenu(
      task,
      e.currentTarget,
      keyboard
        ? { x: r.left + 16, y: r.top + 44 }
        : { x: e.clientX, y: e.clientY },
    );
  };

const keyOpen =
  (id: string, openTask: (id: string) => void) => (e: React.KeyboardEvent) => {
    if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault();
      openTask(id);
    }
  };

/** Moves the soft light on a card with the pointer. */
const spotlight = (e: MouseEvent<HTMLElement>) => {
  const r = e.currentTarget.getBoundingClientRect();
  e.currentTarget.style.setProperty('--mx', `${e.clientX - r.left}px`);
  e.currentTarget.style.setProperty('--my', `${e.clientY - r.top}px`);
};

function FocusCard({
  task,
  project,
  showProject,
  props,
}: {
  task: Task;
  project: Project;
  showProject: boolean;
  props: ViewProps;
}) {
  const { today } = useApp();
  const why = focusReasons(task, today, project.dueSoonDays);
  const s = task.situation;
  return (
    <article
      className={`tcard ${priorityClass(task)}`}
      tabIndex={0}
      role="button"
      aria-label={`Open No. ${task.customerId}, ${task.titleTranslation || task.titleOriginal}`}
      onClick={() => props.openTask(task.id)}
      onKeyDown={keyOpen(task.id, props.openTask)}
      onContextMenu={contextMenu(task, props.openMenu)}
      onMouseMove={spotlight}
    >
      <div className="tc-top">
        <TaskNumber task={task} />
        {showProject && (
          <span className="tc-proj" title={project.name}>
            {initials(project.name)}
          </span>
        )}
        <span className="sp" />
        {task.pinned && (
          <span className="pin" title="Pinned">
            <Icon name="pin" />
          </span>
        )}
        <PriorityTag task={task} />
      </div>
      <Labels labels={task.labels} />
      <div>
        <Titles task={task} />
      </div>
      {s.handledBy || s.doingNow ? (
        <div className="tc-sit">
          <Icon name="user" />
          <span className="clamp2">
            <b>{s.handledBy || 'Someone'}</b>
            {s.doingNow ? ` · ${s.doingNow}` : ''}
          </span>
        </div>
      ) : (
        <div className="tc-sit muted">
          <Icon name="user" />
          <span>No situation recorded yet</span>
        </div>
      )}
      <div className="tc-foot">
        <MetaChips task={task} dueSoonDays={project.dueSoonDays} />
      </div>
      {why.length > 0 && <div className="why">{why.join(' · ')}</div>}
    </article>
  );
}

export const initials = (name: string): string => {
  const words = name
    .replace(/^sample:\s*/i, '')
    .replace(/[(（][^)）]*[)）]/g, ' ')
    .split(/[\s・,]+/)
    .filter((w) => /\p{L}/u.test(w));
  if (!words.length) return '–';
  const first = [...words[0]];
  return (
    words.length > 1 ? first[0] + [...words[1]][0] : first.slice(0, 2).join('')
  ).toUpperCase();
};

const QUICK = {
  overdue: {
    label: 'Overdue',
    test: (f: ReturnType<typeof flags>) => f.overdue,
  },
  soon: { label: 'Due soon', test: (f: ReturnType<typeof flags>) => f.dueSoon },
  me: {
    label: 'Needs my action',
    test: (f: ReturnType<typeof flags>) => f.needsMyAction,
  },
  next: {
    label: 'Next step overdue',
    test: (f: ReturnType<typeof flags>) => f.nextStepOverdue,
  },
  diff: {
    label: 'Open difficulties',
    test: (f: ReturnType<typeof flags>) => f.openDifficulties > 0,
  },
} as const;
type QuickKey = keyof typeof QUICK;

export function FocusView({
  scope,
  props,
  onNewTask,
}: {
  scope: string | 'all';
  props: ViewProps;
  onNewTask: () => void;
}) {
  const { tasks, today, project, projects } = useApp();
  const [quick, setQuick] = useState<QuickKey | null>(null);
  const all = scope === 'all';
  const base = useMemo(
    () =>
      tasks.filter((t) => {
        const p = project(t.projectId);
        return (
          p &&
          (all || t.projectId === scope) &&
          inFocus(t, today, p.dueSoonDays)
        );
      }),
    [tasks, scope, all, today, project],
  );
  const days = (t: Task) => project(t.projectId)?.dueSoonDays ?? 7;
  const shown = base
    .filter((t) => !quick || QUICK[quick].test(flags(t, today, days(t))))
    .filter((t) => props.match(t))
    .sort(byPriority);
  const chips = (
    <div className="qchips" role="group" aria-label="Quick filters">
      {(Object.keys(QUICK) as QuickKey[]).map((k) => (
        <button
          key={k}
          className="qchip"
          aria-pressed={quick === k}
          onClick={() => setQuick(quick === k ? null : k)}
        >
          {QUICK[k].label}{' '}
          <b>
            {base.filter((t) => QUICK[k].test(flags(t, today, days(t)))).length}
          </b>
        </button>
      ))}
    </div>
  );
  const date = new Date(`${today}T00:00:00`).toLocaleDateString('en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
  const scopeName = all ? 'All projects' : (project(scope)?.name ?? '');
  const projectTasks = all ? tasks : tasks.filter((t) => t.projectId === scope);
  return (
    <>
      {props.header(
        'Focus',
        `${scopeName} · ${date} · sorted by priority, then due date · right-click a card to change its priority`,
        chips,
      )}
      {shown.length ? (
        <div className="grid">
          {shown.map((t) => (
            <FocusCard
              key={t.id}
              task={t}
              project={project(t.projectId)!}
              showProject={all && projects.length > 1}
              props={props}
            />
          ))}
        </div>
      ) : (
        <div className="empty">
          {props.query || quick ? (
            'No tasks match. Clear the search or the filter to see the full focus list.'
          ) : projectTasks.length ? (
            'Nothing needs attention right now. Tasks appear here when they are pinned, urgent, overdue, due soon, late to start, waiting on you, or past their next step.'
          ) : (
            <>
              <p style={{ margin: '0 0 12px' }}>No tasks yet.</p>
              {!all && (
                <button className="btn primary" onClick={onNewTask}>
                  <Icon name="plus" />
                  New task
                </button>
              )}
            </>
          )}
        </div>
      )}
    </>
  );
}

/** Columns for each status. Cancelled is hidden unless the owner shows it. */
export function BoardView({
  projectId,
  props,
}: {
  projectId: string;
  props: ViewProps;
}) {
  const { tasks, project, putTask, toast, attempt } = useApp();
  const p = project(projectId)!;
  const [showCancelled, setShowCancelled] = useState(false);
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<Status | null>(null);
  const list = tasks.filter((t) => t.projectId === projectId && props.match(t));
  const columns = STATUSES.filter((s) => s !== 'Cancelled' || showCancelled);

  const move = async (id: string, to: Status) => {
    const t = tasks.find((x) => x.id === id);
    if (!t || t.status === to) return;
    const from = t.status;
    putTask({ ...t, status: to });
    const u = await attempt(() =>
      window.worksync.updateTask(id, { status: to }),
    );
    if (!u) return putTask(t);
    putTask(u);
    toast(`No. ${t.customerId} moved to ${to}.`, {
      label: 'Undo',
      run: () =>
        void attempt(async () =>
          putTask(await window.worksync.updateTask(id, { status: from })),
        ),
    });
  };

  const sorted = (s: Status) => {
    const col = list.filter((t) => t.status === s);
    return s === 'Done' || s === 'Cancelled'
      ? col.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      : col.sort(byPriority);
  };

  return (
    <>
      {props.header(
        'Board',
        `${p.name} · drag a card to change its status, right-click it to change its priority`,
        <button
          className="btn sm"
          aria-pressed={showCancelled}
          onClick={() => setShowCancelled(!showCancelled)}
        >
          {showCancelled ? 'Hide Cancelled' : 'Show Cancelled'}
        </button>,
      )}
      <div className="hscroll">
        <div className="board" style={{ minWidth: columns.length * 218 }}>
          {columns.map((s) => {
            const col = sorted(s);
            return (
              <section
                key={s}
                className={`col ${over === s ? 'drop' : ''}`}
                aria-label={s}
                onDragOver={(e: DragEvent) => {
                  e.preventDefault();
                  setOver(s);
                }}
                onDragLeave={() => setOver((o) => (o === s ? null : o))}
                onDrop={(e: DragEvent) => {
                  e.preventDefault();
                  setOver(null);
                  const id = e.dataTransfer.getData('text/plain');
                  if (id) void move(id, s);
                }}
              >
                <div className="col-h">
                  <StatusChip status={s} />
                  <span className="count">{col.length}</span>
                </div>
                {col.map((t) => (
                  <article
                    key={t.id}
                    className={`card ${priorityClass(t)} ${dragging === t.id ? 'dragging' : ''}`}
                    draggable
                    tabIndex={0}
                    role="button"
                    aria-label={`Open No. ${t.customerId}`}
                    onDragStart={(e) => {
                      e.dataTransfer.setData('text/plain', t.id);
                      setDragging(t.id);
                    }}
                    onDragEnd={() => setDragging(null)}
                    onClick={() => props.openTask(t.id)}
                    onKeyDown={keyOpen(t.id, props.openTask)}
                    onContextMenu={contextMenu(t, props.openMenu)}
                    onMouseMove={spotlight}
                  >
                    <div className="tc-top">
                      <TaskNumber task={t} />
                      <span className="sp" />
                      {t.pinned && (
                        <span className="pin">
                          <Icon name="pin" />
                        </span>
                      )}
                      <PriorityTag task={t} />
                    </div>
                    <Labels labels={t.labels} />
                    <Titles task={t} />
                    <div className="card-foot">
                      <span
                        style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}
                      >
                        {!isClosed(t) && (
                          <DeadlineChip task={t} dueSoonDays={p.dueSoonDays} />
                        )}
                        {t.difficulties.some((d) => d.open) && (
                          <span className="chip">
                            <Icon name="alert" />
                            {t.difficulties.filter((d) => d.open).length}
                          </span>
                        )}
                      </span>
                      <span
                        className="avatar"
                        title={
                          t.situation.handledBy || t.assignee || 'Nobody yet'
                        }
                      >
                        {initials(t.situation.handledBy || t.assignee || '–')}
                      </span>
                    </div>
                  </article>
                ))}
              </section>
            );
          })}
        </div>
      </div>
    </>
  );
}
