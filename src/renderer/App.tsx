import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { Startup } from '../shared/ipc';
import { BUILT_VIEWS, inFocus, type Project, type Task } from '../shared/model';
import { AppProvider, useApp } from './appState';
import {
  ConfirmDelete,
  ProjectDialog,
  TaskDialog,
  ViewsDialog,
  viewIcon,
  viewName,
} from './dialogs';
import { Icon } from './Icon';
import { Toast } from './parts';
import { PriorityMenu, type MenuAnchor } from './PriorityMenu';
import { TaskPopup } from './TaskPopup';
import { BoardView, FocusView, initials, type ViewProps } from './views';
import { FilesView, ReviewDialog } from './files';
import { CalendarView, DashboardView, TimelineView } from './views2';
import { TasksView } from './tasksView';
import { PublishDialog, PublishedView, usePublishStatus } from './publish';
import { WriteDialog, usePendingCount } from './writeCopy';
import { ReportDialog } from './reports';
import { SettingsDialog } from './settings';
import { PeopleDialog } from './people';
import { LinkWizard } from './LinkWizard';
import { AiDialog, GlossaryDialog, type AiSession } from './ai';
import type { SourceFile } from '../shared/sources';

type Route =
  | { view: 'focus'; scope: 'all' | string }
  | {
      view:
        | 'board'
        | 'tasks'
        | 'files'
        | 'timeline'
        | 'calendar'
        | 'dashboard'
        | 'published';
      projectId: string;
    };

type Dialog =
  | { kind: 'newProject' }
  | { kind: 'editProject'; project: Project }
  | { kind: 'views'; projectId: string }
  | { kind: 'newTask'; projectId: string }
  | { kind: 'editTask'; task: Task }
  | { kind: 'deleteTask'; task: Task }
  | { kind: 'link'; projectId: string }
  | { kind: 'review'; source: SourceFile }
  | {
      kind: 'ai';
      projectId: string;
      startAt: 'choose' | 'paste';
      preselect?: string[];
    }
  | { kind: 'glossary'; projectId: string }
  | { kind: 'people'; projectId: string }
  | { kind: 'publish'; projectId: string }
  | { kind: 'write' }
  | { kind: 'settings' }
  | { kind: 'report'; projectId: string; taskIds?: string[] };

export function App() {
  const [startup, setStartup] = useState<Startup | null>(null);
  useEffect(() => {
    void window.worksync.start().then(setStartup);
  }, []);
  if (!startup) return <div className="boot">Opening WorkSync…</div>;
  if (!startup.ok) {
    return (
      <div className="boot">
        <div className="panel boot-error">
          <h1>WorkSync could not open its data</h1>
          <p>{startup.message}</p>
          <p className="muted">Data folder: {startup.dataFolder}</p>
        </div>
      </div>
    );
  }
  return (
    <AppProvider initial={startup}>
      <Shell dataFolder={startup.dataFolder} warning={startup.warning} />
    </AppProvider>
  );
}

function Shell({
  dataFolder,
  warning,
}: {
  dataFolder: string;
  warning: string | null;
}) {
  const {
    projects,
    tasks,
    today,
    project,
    originalFirst,
    setOriginalFirst,
    attempt,
    reloadAll,
    toast,
    sources,
  } = useApp();
  const [route, setRoute] = useState<Route>({ view: 'focus', scope: 'all' });
  const [active, setActive] = useState<string | null>(projects[0]?.id ?? null);
  const [query, setQuery] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [menu, setMenu] = useState<MenuAnchor | null>(null);
  const [scrolled, setScrolled] = useState(false);
  const [sideOpen, setSideOpen] = useState(false);
  const search = useRef<HTMLInputElement>(null);
  const viewRef = useRef<HTMLElement>(null);
  const [headEl, setHeadEl] = useState<HTMLDivElement | null>(null);
  const [aiSession, setAiSession] = useState<AiSession | null>(null);
  const [dataWarning, setDataWarning] = useState(warning);

  // Keep the route valid when a view is turned off or a project changes.
  useEffect(() => {
    if (route.view !== 'focus' && !project(route.projectId)?.views[route.view])
      setRoute({ view: 'focus', scope: route.projectId });
  }, [route, project]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        search.current?.focus();
        search.current?.select();
      } else if (e.key === 'Escape' && !dialog && !menu && openId) {
        setOpenId(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [dialog, menu, openId]);

  const go = (r: Route) => {
    setRoute(r);
    setSideOpen(false);
    if (viewRef.current) viewRef.current.scrollTop = 0;
    setScrolled(false);
  };

  const openMenu = useCallback(
    (task: Task, opener: HTMLElement, at?: { x: number; y: number }) =>
      setMenu({ task, opener, at }),
    [],
  );
  const closeMenu = useCallback(() => setMenu(null), []);

  // Each view renders its header into the fixed area above the scrolling content.
  const props: ViewProps = {
    query,
    openTask: setOpenId,
    openMenu,
    header: (title, subtitle, right) =>
      headEl &&
      createPortal(
        <div className="vh">
          <div>
            <h1>{title}</h1>
            <div className="sub">{subtitle}</div>
          </div>
          {right}
        </div>,
        headEl,
      ),
  };

  const addSample = async () => {
    const id = await attempt(() => window.worksync.addSampleProject());
    if (id) {
      await reloadAll();
      setActive(id);
      go({ view: 'focus', scope: id });
      toast('Added the sample project. Delete or keep it as you like.');
    }
  };

  const currentProjectId =
    route.view !== 'focus'
      ? route.projectId
      : route.scope !== 'all'
        ? route.scope
        : active;
  const body = !projects.length ? (
    <Welcome
      onNew={() => setDialog({ kind: 'newProject' })}
      onSample={() => void addSample()}
    />
  ) : route.view === 'board' ? (
    <BoardView projectId={route.projectId} props={props} />
  ) : route.view === 'tasks' ? (
    <TasksView
      projectId={route.projectId}
      props={props}
      onCopyForAi={(ids) =>
        setDialog({
          kind: 'ai',
          projectId: route.projectId,
          startAt: 'choose',
          preselect: ids,
        })
      }
      onReport={(ids) =>
        setDialog({ kind: 'report', projectId: route.projectId, taskIds: ids })
      }
    />
  ) : route.view === 'timeline' ? (
    <TimelineView projectId={route.projectId} props={props} />
  ) : route.view === 'calendar' ? (
    <CalendarView projectId={route.projectId} props={props} />
  ) : route.view === 'dashboard' ? (
    <DashboardView projectId={route.projectId} props={props} />
  ) : route.view === 'published' ? (
    <PublishedView
      projectId={route.projectId}
      props={props}
      onPublish={() =>
        setDialog({ kind: 'publish', projectId: route.projectId })
      }
    />
  ) : route.view === 'files' ? (
    <FilesView
      projectId={route.projectId}
      props={props}
      onLink={() => setDialog({ kind: 'link', projectId: route.projectId })}
      onReview={(source) => setDialog({ kind: 'review', source })}
    />
  ) : (
    <FocusView
      scope={route.view === 'focus' ? route.scope : route.projectId}
      props={props}
      onNewTask={() =>
        currentProjectId &&
        setDialog({ kind: 'newTask', projectId: currentProjectId })
      }
    />
  );

  const changedSources = sources.filter((s) => s.state === 'changed');
  const [pubStatus] = usePublishStatus(currentProjectId);
  const pendingWrites = usePendingCount();
  const baseName = (f: string) => f.split(/[\\/]/).pop() ?? f;

  const focusCount = (scope: string | 'all') =>
    tasks.filter(
      (t) =>
        (scope === 'all' || t.projectId === scope) &&
        inFocus(t, today, project(t.projectId)?.dueSoonDays ?? 7),
    ).length;

  return (
    <div className="window" id="app">
      <div className="shell">
        <nav
          className={`sidebar ${sideOpen ? 'on' : ''}`}
          aria-label="Projects and views"
        >
          <div>
            <div className="nav-label">Today</div>
            <div className="nav">
              <button
                className="nav-item"
                aria-current={
                  route.view === 'focus' && route.scope === 'all'
                    ? 'page'
                    : undefined
                }
                onClick={() => go({ view: 'focus', scope: 'all' })}
              >
                <Icon name="focus" />
                <span className="grow">Focus, all projects</span>
                <span className="count">{focusCount('all')}</span>
              </button>
            </div>
          </div>
          <div>
            <div className="nav-label">Projects</div>
            <div className="nav">
              {projects.map((p) => {
                const isActive = p.id === active;
                return (
                  <div className="proj" key={p.id}>
                    <button
                      className={`proj-btn ${isActive ? 'active' : ''}`}
                      aria-expanded={isActive}
                      onClick={() => setActive(isActive ? null : p.id)}
                    >
                      <span className="mono-tile">{initials(p.name)}</span>
                      <span style={{ minWidth: 0 }}>
                        <span className="proj-name">{p.name}</span>
                        <span className="proj-lang">
                          {p.originalLanguages
                            .map((l) => l.toUpperCase())
                            .join(' · ')}{' '}
                          → {p.workingLanguage.toUpperCase()}
                        </span>
                      </span>
                      <span className="count">{focusCount(p.id)}</span>
                    </button>
                    {isActive && (
                      <div className="subnav">
                        {BUILT_VIEWS.filter((k) => p.views[k]).map((k) => (
                          <button
                            key={k}
                            className="nav-item"
                            aria-current={
                              (k === 'focus' &&
                                route.view === 'focus' &&
                                route.scope === p.id) ||
                              (k !== 'focus' &&
                                route.view === k &&
                                route.projectId === p.id)
                                ? 'page'
                                : undefined
                            }
                            onClick={() =>
                              go(
                                k === 'focus'
                                  ? { view: 'focus', scope: p.id }
                                  : {
                                      view: k as Exclude<
                                        Route['view'],
                                        'focus'
                                      >,
                                      projectId: p.id,
                                    },
                              )
                            }
                          >
                            <Icon name={viewIcon(k)} />
                            <span className="grow">{viewName(k)}</span>
                          </button>
                        ))}
                        <button
                          className="nav-item custom"
                          onClick={() =>
                            setDialog({ kind: 'newTask', projectId: p.id })
                          }
                        >
                          <Icon name="plus" />
                          <span className="grow">New task</span>
                        </button>
                        <button
                          className="nav-item custom"
                          onClick={() =>
                            setDialog({ kind: 'views', projectId: p.id })
                          }
                        >
                          <Icon name="sliders" />
                          <span className="grow">Choose views</span>
                        </button>
                        <button
                          className="nav-item custom"
                          onClick={() =>
                            setDialog({ kind: 'people', projectId: p.id })
                          }
                        >
                          <Icon name="user" />
                          <span className="grow">People</span>
                        </button>
                        <button
                          className="nav-item custom"
                          onClick={() =>
                            setDialog({ kind: 'glossary', projectId: p.id })
                          }
                        >
                          <Icon name="note" />
                          <span className="grow">Glossary</span>
                        </button>
                        <button
                          className="nav-item custom"
                          onClick={() =>
                            setDialog({ kind: 'report', projectId: p.id })
                          }
                        >
                          <Icon name="file" />
                          <span className="grow">Make a report</span>
                        </button>
                        <button
                          className="nav-item custom"
                          onClick={() =>
                            setDialog({ kind: 'editProject', project: p })
                          }
                        >
                          <Icon name="edit" />
                          <span className="grow">Project settings</span>
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
              <button
                className="nav-item custom"
                onClick={() => setDialog({ kind: 'newProject' })}
              >
                <Icon name="plus" />
                <span className="grow">New project</span>
              </button>
            </div>
          </div>
          <button
            className="nav-item custom side-settings"
            onClick={() => setDialog({ kind: 'settings' })}
          >
            <Icon name="sliders" />
            <span className="grow">Settings</span>
          </button>
          <div className="side-foot">
            <span>
              <Icon name="lock" />
              Data stays on this PC
            </span>
            <span className="path" title={dataFolder}>
              <Icon name="folder" />
              <span className="grow-ellipsis">{dataFolder}</span>
            </span>
          </div>
        </nav>
        <div className="main">
          <header className="topbar">
            <button
              className="icon-btn menu-btn"
              aria-label="Open the sidebar"
              onClick={() => setSideOpen(true)}
            >
              <Icon name="menu" />
            </button>
            <label className="search" htmlFor="q">
              <Icon name="search" />
              <input
                id="q"
                ref={search}
                type="search"
                placeholder="Search by number, label or title"
                autoComplete="off"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
              <span className="kbd">Ctrl K</span>
            </label>
            <button
              className="btn"
              aria-pressed={originalFirst}
              onClick={() => setOriginalFirst(!originalFirst)}
            >
              <Icon name="swap" />
              <span className="lbl">Original first</span>
            </button>
            <button
              className="btn"
              disabled={!currentProjectId}
              title="Build a request for the Gemini web app"
              onClick={() =>
                currentProjectId &&
                setDialog({
                  kind: 'ai',
                  projectId:
                    aiSession?.projectId === currentProjectId
                      ? aiSession.projectId
                      : currentProjectId,
                  startAt: 'choose',
                })
              }
            >
              <Icon name="spark" />
              <span className="lbl">Copy for AI</span>
            </button>
            <button
              className="btn"
              disabled={!aiSession}
              title={
                aiSession ? 'Paste Gemini’s answer' : 'Use Copy for AI first'
              }
              onClick={() =>
                aiSession &&
                setDialog({
                  kind: 'ai',
                  projectId: aiSession.projectId,
                  startAt: 'paste',
                })
              }
            >
              <Icon name="copy" />
              <span className="lbl">Paste from AI</span>
              {aiSession &&
                aiSession.batches.length - aiSession.done.length > 0 && (
                  <span className="badge">
                    {aiSession.batches.length - aiSession.done.length}
                  </span>
                )}
            </button>
            {sources.length > 0 && (
              <button
                className="btn"
                title={
                  pendingWrites
                    ? `${pendingWrites} changes not yet written to your copy`
                    : 'Write changes to your copy of a customer file'
                }
                onClick={() => setDialog({ kind: 'write' })}
              >
                <Icon name="save" />
                <span className="lbl">Write to copy</span>
                {pendingWrites > 0 && (
                  <span className="badge">{pendingWrites}</span>
                )}
              </button>
            )}
            <button
              className="btn"
              disabled={!currentProjectId}
              title={
                pubStatus?.unpublished
                  ? `${pubStatus.unpublished} changes not published yet`
                  : 'Publish to the shared folder'
              }
              onClick={() =>
                currentProjectId &&
                setDialog({ kind: 'publish', projectId: currentProjectId })
              }
            >
              <Icon name="upload" />
              <span className="lbl">Publish</span>
              {pubStatus?.folder && pubStatus.unpublished > 0 && (
                <span className="badge">{pubStatus.unpublished}</span>
              )}
            </button>
            <button
              className="btn primary"
              disabled={!currentProjectId}
              title={
                currentProjectId
                  ? `Add a task to ${project(currentProjectId)?.name}`
                  : 'Create a project first'
              }
              onClick={() =>
                currentProjectId &&
                setDialog({ kind: 'newTask', projectId: currentProjectId })
              }
            >
              <Icon name="plus" />
              <span className="lbl">New task</span>
            </button>
          </header>
          <div className="notices">
            {dataWarning && (
              <div className="notice warn" role="alert">
                <Icon name="alert" />
                <span className="notice-text">{dataWarning}</span>
                <span className="notice-actions">
                  <button
                    className="btn sm"
                    onClick={() => setDataWarning(null)}
                  >
                    Not now
                  </button>
                </span>
              </div>
            )}
            {pubStatus && pubStatus.tampered.length > 0 && currentProjectId && (
              <div className="notice warn" role="status">
                <Icon name="alert" />
                <span className="notice-text">
                  <b>
                    The published {pubStatus.tampered.join(' and ')} changed
                  </b>{' '}
                  · someone edited or deleted it in the shared folder after you
                  published
                </span>
                <span className="notice-actions">
                  <button
                    className="btn sm accent-outline"
                    onClick={() =>
                      setDialog({
                        kind: 'publish',
                        projectId: currentProjectId,
                      })
                    }
                  >
                    Publish again
                  </button>
                </span>
              </div>
            )}
            {changedSources.length > 0 && (
              <div className="notice" role="status">
                <Icon name="refresh" />
                <span className="notice-text">
                  <b>
                    {changedSources.length === 1
                      ? `${baseName(changedSources[0].currentFile)} changed`
                      : `${changedSources.length} linked files changed`}
                  </b>
                  {' · '}
                  {changedSources
                    .map((s) => project(s.projectId)?.name)
                    .filter((v, i, a) => v && a.indexOf(v) === i)
                    .join(', ')}
                </span>
                <span className="notice-actions">
                  <button
                    className="btn sm accent-outline"
                    onClick={() =>
                      setDialog({ kind: 'review', source: changedSources[0] })
                    }
                  >
                    Review changes
                  </button>
                </span>
              </div>
            )}
          </div>
          <div
            className={`vhead ${scrolled ? 'scrolled' : ''}`}
            ref={setHeadEl}
          />
          <main
            className="view"
            ref={viewRef}
            tabIndex={-1}
            onScroll={(e) => setScrolled(e.currentTarget.scrollTop > 2)}
          >
            <div className={`v-${route.view}`}>{body}</div>
          </main>
        </div>
        <div
          className={`scrim ${sideOpen ? 'on' : ''}`}
          onClick={() => setSideOpen(false)}
        />
      </div>

      {openId && (
        <TaskPopup
          taskId={openId}
          onClose={() => setOpenId(null)}
          onEdit={(task) => setDialog({ kind: 'editTask', task })}
          onDelete={(task) => setDialog({ kind: 'deleteTask', task })}
          openMenu={openMenu}
        />
      )}
      {menu && (
        <PriorityMenu
          anchor={{
            ...menu,
            task: tasks.find((t) => t.id === menu.task.id) ?? menu.task,
          }}
          onClose={closeMenu}
        />
      )}
      {dialog?.kind === 'newProject' && (
        <ProjectDialog
          onClose={() => setDialog(null)}
          onSaved={(p) => {
            setDialog(null);
            setActive(p.id);
            go({ view: 'focus', scope: p.id });
          }}
        />
      )}
      {dialog?.kind === 'editProject' && (
        <ProjectDialog
          project={dialog.project}
          onClose={() => setDialog(null)}
          onSaved={() => setDialog(null)}
        />
      )}
      {dialog?.kind === 'views' && project(dialog.projectId) && (
        <ViewsDialog
          project={project(dialog.projectId)!}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog?.kind === 'newTask' && (
        <TaskDialog
          projectId={dialog.projectId}
          onClose={() => setDialog(null)}
          onSaved={(t) => {
            setDialog(null);
            setOpenId(t.id);
          }}
        />
      )}
      {dialog?.kind === 'editTask' && (
        <TaskDialog
          projectId={dialog.task.projectId}
          task={dialog.task}
          onClose={() => setDialog(null)}
          onSaved={() => setDialog(null)}
        />
      )}
      {dialog?.kind === 'link' && project(dialog.projectId) && (
        <LinkWizard
          project={project(dialog.projectId)!}
          onClose={() => setDialog(null)}
          onLinked={() => {
            setDialog(null);
            go({ view: 'focus', scope: dialog.projectId });
          }}
        />
      )}
      {dialog?.kind === 'ai' && project(dialog.projectId) && (
        <AiDialog
          project={project(dialog.projectId)!}
          session={aiSession?.projectId === dialog.projectId ? aiSession : null}
          setSession={setAiSession}
          startAt={dialog.startAt}
          preselect={dialog.preselect}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog?.kind === 'settings' && (
        <SettingsDialog onClose={() => setDialog(null)} />
      )}
      {dialog?.kind === 'write' && (
        <WriteDialog onClose={() => setDialog(null)} />
      )}
      {dialog?.kind === 'report' && project(dialog.projectId) && (
        <ReportDialog
          project={project(dialog.projectId)!}
          taskIds={dialog.taskIds}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog?.kind === 'publish' && project(dialog.projectId) && (
        <PublishDialog
          project={project(dialog.projectId)!}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog?.kind === 'people' && project(dialog.projectId) && (
        <PeopleDialog
          project={project(dialog.projectId)!}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog?.kind === 'glossary' && project(dialog.projectId) && (
        <GlossaryDialog
          project={project(dialog.projectId)!}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog?.kind === 'review' && (
        <ReviewDialog source={dialog.source} onClose={() => setDialog(null)} />
      )}
      {dialog?.kind === 'deleteTask' && (
        <ConfirmDelete
          task={dialog.task}
          onClose={() => setDialog(null)}
          onDeleted={() => {
            setDialog(null);
            setOpenId(null);
          }}
        />
      )}
      <Toast />
    </div>
  );
}

function Welcome({
  onNew,
  onSample,
}: {
  onNew: () => void;
  onSample: () => void;
}) {
  return (
    <div className="welcome">
      <h1>Welcome to WorkSync</h1>
      <p>
        Start with a project for one customer. Link the customer’s Excel file to
        bring in its tasks, or add tasks by hand.
      </p>
      <div
        style={{
          display: 'flex',
          gap: 10,
          flexWrap: 'wrap',
          justifyContent: 'center',
        }}
      >
        <button className="btn primary" onClick={onNew}>
          <Icon name="plus" />
          New project
        </button>
        <button className="btn" onClick={onSample}>
          <Icon name="spark" />
          Try the sample project
        </button>
      </div>
    </div>
  );
}
