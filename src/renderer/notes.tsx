import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  filterNotes,
  linkAt,
  noteLinks,
  parseTags,
  type Note,
  type NoteFilter,
} from '../shared/notes';
import { useApp } from './appState';
import { Icon } from './Icon';
import type { HeaderSlot } from './mine';

const when = (iso: string | null) => {
  if (!iso) return '';
  const d = new Date(iso);
  const mins = Math.round((Date.now() - d.getTime()) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const p = (n: number) => String(n).padStart(2, '0');
  const today = new Date();
  if (d.toDateString() === today.toDateString())
    return `today ${p(d.getHours())}:${p(d.getMinutes())}`;
  return `${d.getFullYear()}/${p(d.getMonth() + 1)}/${p(d.getDate())}`;
};

const preview = (n: Note) =>
  n.body
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(0, 2)
    .join(' · ');

/**
 * Notes: every note, or the notes of one project. The editor saves while
 * you type. A note on its own works as usual; one attached to a project also
 * shows inside that project.
 */
export function NotesView({
  notes,
  setNotes,
  projectId,
  query,
  head,
}: {
  notes: Note[];
  setNotes: (f: (list: Note[]) => Note[]) => void;
  /** Set for a project's Notes tab: only its notes, and new ones go there. */
  projectId?: string;
  query: string;
  head: HeaderSlot;
}) {
  const { attempt, toast, projects, project } = useApp();
  const [filter, setFilter] = useState<NoteFilter>('all');
  const [scope, setScope] = useState<'any' | 'none' | string>('any');
  const [sel, setSel] = useState<string | null>(null);
  const inProject = projectId ? project(projectId) : null;

  const scoped = useMemo(
    () =>
      notes.filter((n) =>
        projectId
          ? n.projectId === projectId
          : scope === 'any' ||
            (scope === 'none' ? !n.projectId : n.projectId === scope),
      ),
    [notes, projectId, scope],
  );
  const shown = filterNotes(scoped, filter, query, new Date());
  const selected = notes.find((n) => n.id === sel) ?? null;

  // Open the newest note when the page opens, or after the open one goes.
  useEffect(() => {
    if (!selected && shown.length) setSel(shown[0].id);
    // Only when the selection is gone.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, projectId]);

  const put = (n: Note) =>
    setNotes((list) =>
      list.some((x) => x.id === n.id)
        ? list.map((x) => (x.id === n.id ? n : x))
        : [n, ...list],
    );

  const open = (id: string) => {
    setSel(id);
    void window.worksync.viewNote(id).then(put, () => {});
  };

  const create = async () => {
    const n = await attempt(() =>
      window.worksync.saveNote({
        title: '',
        body: '',
        tags: [],
        favorite: false,
        projectId:
          projectId ?? (scope !== 'any' && scope !== 'none' ? scope : null),
      }),
    );
    if (n) {
      put(n);
      setFilter('all');
      setSel(n.id);
      window.setTimeout(
        () => document.getElementById('noteTitle')?.focus(),
        30,
      );
    }
  };

  const remove = async (n: Note) => {
    const gone = await attempt(() => window.worksync.deleteNote(n.id));
    if (!gone) return;
    setNotes((list) => list.filter((x) => x.id !== n.id));
    setSel(null);
    toast(`Deleted “${n.title || 'Untitled note'}”.`, {
      label: 'Undo',
      run: () =>
        void attempt(() => window.worksync.restoreNote(gone)).then((back) => {
          if (back) {
            put(back);
            setSel(back.id);
          }
        }),
    });
  };

  const filters: [NoteFilter, string][] = [
    ['all', 'All'],
    ['favorites', 'Favorites'],
    ['recent', 'Recent'],
    ['tagged', 'Tagged'],
  ];

  return (
    <div className="mine-page notes-page">
      {head &&
        createPortal(
          <div className="vh">
            <div>
              <h1>Notes</h1>
              <div className="sub">
                {inProject
                  ? `${inProject.name} · notes attached to this project. They also appear in Notes, with all your other notes.`
                  : 'All your notes. A note can belong to a project, or to none.'}
              </div>
            </div>
            <button className="btn primary" onClick={() => void create()}>
              <Icon name="plus" />
              {inProject ? 'New note in this project' : 'New note'}
            </button>
          </div>,
          head,
        )}
      <div className="notes-tools">
        <div className="seg-ctl" role="group" aria-label="Show">
          {filters.map(([k, l]) => (
            <button
              key={k}
              aria-pressed={filter === k}
              onClick={() => setFilter(k)}
            >
              {l}
            </button>
          ))}
        </div>
        {!projectId && (
          <select
            className="inp"
            aria-label="Project"
            value={scope}
            onChange={(e) => setScope(e.target.value)}
          >
            <option value="any">Any project</option>
            <option value="none">No project</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        )}
        <span className="muted notes-count">
          {shown.length} note{shown.length === 1 ? '' : 's'}
        </span>
      </div>
      <div className="notes-body">
        <div className="notes-list" role="list" aria-label="Notes">
          {shown.map((n) => (
            <button
              key={n.id}
              role="listitem"
              className={`note-item ${n.id === sel ? 'sel' : ''}`}
              onClick={() => open(n.id)}
            >
              <span className="note-item-top">
                <b>{n.title || 'Untitled note'}</b>
                {n.favorite && <Icon name="star" className="fav" />}
              </span>
              {preview(n) && <small>{preview(n)}</small>}
              <span className="note-item-meta">
                {!projectId && n.projectId && (
                  <span className="note-proj">
                    {project(n.projectId)?.name ?? 'Project'}
                  </span>
                )}
                {n.tags.map((t) => (
                  <span key={t} className="note-tag">
                    {t}
                  </span>
                ))}
                <span className="grow" />
                <span className="muted">{when(n.updatedAt)}</span>
              </span>
            </button>
          ))}
          {!shown.length && (
            <div className="empty">
              {scoped.length
                ? 'No note matches. Try another filter.'
                : inProject
                  ? 'No notes in this project yet. Meeting notes and memos that aren’t about one task go well here.'
                  : 'No notes yet. Choose New note to write one.'}
            </div>
          )}
        </div>
        <section className="note-editor" aria-label="Note">
          {selected ? (
            <NoteEditor
              key={selected.id}
              note={selected}
              onSaved={put}
              onDelete={() => void remove(selected)}
              fixedProject={!!projectId}
            />
          ) : (
            <div className="empty">Choose a note, or make a new one.</div>
          )}
        </section>
      </div>
    </div>
  );
}

function NoteEditor({
  note,
  onSaved,
  onDelete,
  fixedProject,
}: {
  note: Note;
  onSaved: (n: Note) => void;
  onDelete: () => void;
  fixedProject: boolean;
}) {
  const { attempt, projects } = useApp();
  const [title, setTitle] = useState(note.title);
  const [body, setBody] = useState(note.body);
  const [tagText, setTagText] = useState('');
  const [state, setState] = useState<'saved' | 'saving' | 'unsaved'>('saved');
  const pending = useRef<{ title?: string; body?: string } | null>(null);
  const timer = useRef<number | undefined>(undefined);

  const flush = async () => {
    window.clearTimeout(timer.current);
    const p = pending.current;
    if (!p) return;
    pending.current = null;
    setState('saving');
    const n = await attempt(() => window.worksync.saveNote(p, note.id));
    if (n) onSaved(n);
    setState(pending.current ? 'unsaved' : n ? 'saved' : 'unsaved');
  };
  // Saves a moment after typing stops, and when the note closes.
  const queue = (patch: { title?: string; body?: string }) => {
    pending.current = { ...pending.current, ...patch };
    setState('unsaved');
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => void flush(), 600);
  };
  useEffect(
    () => () => {
      void flush();
    },
    // On close only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const save = async (
    patch: Parameters<typeof window.worksync.saveNote>[0],
  ) => {
    const n = await attempt(() => window.worksync.saveNote(patch, note.id));
    if (n) onSaved(n);
  };
  const addTags = () => {
    const more = parseTags(tagText);
    if (!more.length) return;
    setTagText('');
    void save({ tags: [...note.tags, ...more] });
  };
  const links = noteLinks(body);
  const openLink = (url: string) =>
    void flush().then(() =>
      attempt(() => window.worksync.openNoteLink(note.id, url)),
    );

  return (
    <div className="note-edit">
      <div className="note-edit-head">
        <input
          id="noteTitle"
          className="note-title"
          aria-label="Title"
          placeholder="Untitled note"
          value={title}
          onChange={(e) => {
            setTitle(e.target.value);
            queue({ title: e.target.value });
          }}
        />
        <span className={`note-state ${state}`} role="status">
          {state === 'saved' ? (
            <>
              <Icon name="check" /> Saved
            </>
          ) : state === 'saving' ? (
            'Saving…'
          ) : (
            'Editing'
          )}
        </span>
        <button
          className={`icon-btn ${note.favorite ? 'on-fav' : ''}`}
          aria-pressed={note.favorite}
          aria-label="Favorite"
          title={note.favorite ? 'Remove from favorites' : 'Add to favorites'}
          onClick={() => void save({ favorite: !note.favorite })}
        >
          <Icon name="star" />
        </button>
        <button
          className="icon-btn"
          aria-label="Delete note"
          title="Delete note"
          onClick={onDelete}
        >
          <Icon name="trash" />
        </button>
      </div>
      <div className="note-meta">
        {!fixedProject && (
          <label className="note-meta-field">
            Project
            <select
              className="inp"
              value={note.projectId ?? ''}
              onChange={(e) => void save({ projectId: e.target.value || null })}
            >
              <option value="">No project</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
        )}
        <span className="note-tags">
          {note.tags.map((t) => (
            <span key={t} className="note-tag">
              {t}
              <button
                className="note-tag-x"
                aria-label={`Remove the tag ${t}`}
                onClick={() =>
                  void save({ tags: note.tags.filter((x) => x !== t) })
                }
              >
                <Icon name="x" />
              </button>
            </span>
          ))}
          <input
            className="inp note-tag-inp"
            aria-label="Add tags"
            placeholder="Add tags"
            value={tagText}
            onChange={(e) => setTagText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ',') {
                e.preventDefault();
                addTags();
              }
            }}
            onBlur={addTags}
          />
        </span>
      </div>
      <textarea
        className="note-body"
        aria-label="Note text"
        placeholder="Write here. It saves as you type. Web addresses open with Ctrl+click."
        value={body}
        onChange={(e) => {
          setBody(e.target.value);
          queue({ body: e.target.value });
        }}
        onClick={(e) => {
          if (!(e.ctrlKey || e.metaKey)) return;
          const url = linkAt(body, e.currentTarget.selectionStart);
          if (url) {
            e.preventDefault();
            openLink(url);
          }
        }}
        onBlur={() => void flush()}
      />
      {links.length > 0 && (
        <div className="note-links">
          <span className="muted">Links in this note</span>
          {links.map((u) => (
            <button
              key={u}
              className="linkbtn"
              title={`Open ${u} in your browser`}
              onClick={() => openLink(u)}
            >
              <Icon name="globe" />
              {u.replace(/^https?:\/\//, '')}
            </button>
          ))}
        </div>
      )}
      <div className="note-foot muted">
        <span>Created {when(note.createdAt)}</span>
        <span>Changed {when(note.updatedAt)}</span>
      </div>
    </div>
  );
}
