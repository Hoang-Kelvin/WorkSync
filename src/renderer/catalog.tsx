import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { createPortal } from 'react-dom';
import {
  isApp,
  matchesEntry,
  passesFilter,
  shortcutLabel,
  sortEntries,
  type CatalogEntry,
  type CatalogFilter,
  type CatalogSort,
  type EverythingAnswer,
  type EverythingResult,
  type SearchSource,
} from '../shared/catalog';
import { parseTags } from '../shared/notes';
import { useApp } from './appState';
import { Icon } from './Icon';
import type { HeaderSlot } from './mine';
import { Modal } from './parts';

const SORT_KEY = 'worksync.catalog.sort';
const SOURCE_KEY = 'worksync.catalog.source';
const windows = navigator.userAgent.includes('Windows');

const remember = <T extends string>(key: string, fallback: T): T => {
  try {
    return (localStorage.getItem(key) as T | null) ?? fallback;
  } catch {
    return fallback;
  }
};
const keep = (key: string, v: string) => {
  try {
    localStorage.setItem(key, v);
  } catch {
    // A remembered choice is only a convenience.
  }
};

const ago = (iso: string | null) => {
  if (!iso) return 'Never opened';
  const d = new Date(iso);
  const mins = Math.round((Date.now() - d.getTime()) / 60000);
  if (mins < 1) return 'Opened just now';
  if (mins < 60) return `Opened ${mins} min ago`;
  if (mins < 24 * 60) return `Opened ${Math.round(mins / 60)} h ago`;
  const p = (n: number) => String(n).padStart(2, '0');
  return `Opened ${d.getFullYear()}/${p(d.getMonth() + 1)}/${p(d.getDate())}`;
};

/**
 * The Catalog: apps, files and folders you open often. On Windows, files on
 * this PC are found with Everything too.
 */
export function CatalogView({
  entries,
  setEntries,
  query,
  head,
}: {
  entries: CatalogEntry[];
  setEntries: (f: (list: CatalogEntry[]) => CatalogEntry[]) => void;
  query: string;
  head: HeaderSlot;
}) {
  const { attempt, toast, settings } = useApp();
  const [filter, setFilter] = useState<CatalogFilter>('all');
  const [sort, setSortState] = useState<CatalogSort>(() =>
    remember(SORT_KEY, 'lastOpened'),
  );
  const [source, setSourceState] = useState<SearchSource>(() =>
    windows ? remember(SOURCE_KEY, 'both') : 'catalog',
  );
  const [found, setFound] = useState<EverythingAnswer | null>(null);
  const [editing, setEditing] = useState<CatalogEntry | null>(null);
  const setSort = (s: CatalogSort) => {
    setSortState(s);
    keep(SORT_KEY, s);
  };
  const setSource = (s: SearchSource) => {
    setSourceState(s);
    keep(SOURCE_KEY, s);
  };
  const useEverything = windows && settings.everything && source !== 'catalog';

  const reload = () =>
    void attempt(() => window.worksync.listCatalog()).then(
      (list) => list && setEntries(() => list),
    );
  // Paths are checked again each time the page opens.
  useEffect(() => {
    reload();
    // Once per visit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const q = query.trim();
    if (!useEverything || !q) {
      setFound(null);
      return;
    }
    let live = true;
    const t = window.setTimeout(() => {
      void window.worksync.searchEverything(q).then(
        (r) => live && setFound(r),
        () => live && setFound(null),
      );
    }, 250);
    return () => {
      live = false;
      window.clearTimeout(t);
    };
  }, [query, useEverything]);

  const counts = useMemo(() => {
    const c = {} as Record<CatalogFilter, number>;
    for (const f of [
      'all',
      'apps',
      'files',
      'folders',
      'favorites',
      'missing',
    ] as const)
      c[f] = entries.filter((e) => passesFilter(e, f)).length;
    return c;
  }, [entries]);
  const shown = sortEntries(
    entries.filter((e) => passesFilter(e, filter) && matchesEntry(e, query)),
    sort,
  );

  const put = (e: CatalogEntry) =>
    setEntries((list) =>
      list.some((x) => x.id === e.id)
        ? list.map((x) => (x.id === e.id ? e : x))
        : [...list, e],
    );

  const add = async (kind: 'file' | 'folder') => {
    const r = await attempt(() => window.worksync.addToCatalog(kind));
    if (!r) return;
    r.added.forEach(put);
    toast(
      `${r.added.length ? `Added ${r.added.length === 1 ? r.added[0].name : `${r.added.length} entries`}.` : 'Nothing added.'}${r.skipped ? ` ${r.skipped} ${r.skipped === 1 ? 'was' : 'were'} already in the Catalog.` : ''}`,
    );
  };
  const open = async (e: CatalogEntry) => {
    const u = await attempt(() => window.worksync.openCatalogEntry(e.id));
    if (u) put(u);
  };
  const copy = async (p: string) => {
    if (await attempt(() => window.worksync.copyText(p).then(() => true)))
      toast('Path copied.');
  };
  const remove = async (e: CatalogEntry) => {
    const gone = await attempt(() => window.worksync.removeCatalogEntry(e.id));
    if (!gone) return;
    setEntries((list) => list.filter((x) => x.id !== e.id));
    toast(
      `Removed ${e.name} from the Catalog. The ${e.kind} itself is untouched.`,
      {
        label: 'Undo',
        run: () =>
          void attempt(() => window.worksync.restoreCatalogEntry(gone)).then(
            (b) => b && put(b),
          ),
      },
    );
  };
  const favorite = async (e: CatalogEntry) => {
    const u = await attempt(() =>
      window.worksync.saveCatalogEntry({ favorite: !e.favorite }, e.id),
    );
    if (u) put(u);
  };
  const addFound = async (r: EverythingResult) => {
    const u = await attempt(() => window.worksync.addFoundToCatalog(r.path));
    if (!u) return;
    put(u);
    setFound(
      (f) =>
        f && {
          ...f,
          results: f.results.map((x) =>
            x.path === r.path ? { ...x, saved: true } : x,
          ),
        },
    );
    toast(`Added ${u.name} to the Catalog.`);
  };

  const filters: [CatalogFilter, string][] = [
    ['all', 'All'],
    ['apps', 'Apps'],
    ['files', 'Files'],
    ['folders', 'Folders'],
    ['favorites', 'Favorites'],
    ['missing', 'Not found'],
  ];
  const showCatalog = source !== 'everything';
  const showFound = useEverything;

  return (
    <div
      className={`mine-page cat-page ${showCatalog && showFound ? 'both' : ''}`}
    >
      {head &&
        createPortal(
          <div className="vh">
            <div>
              <h1>Catalog</h1>
              <div className="sub">
                Apps, files and folders you open often.
                {settings.quickSearchKey && (
                  <>
                    {' '}
                    Press{' '}
                    <span className="cat-kbd">
                      {shortcutLabel(settings.quickSearchKey)}
                    </span>{' '}
                    anywhere to search them.
                  </>
                )}
              </div>
            </div>
            <div className="vh-actions">
              <button className="btn" onClick={() => void add('folder')}>
                <Icon name="folder" />
                Add a folder
              </button>
              <button className="btn primary" onClick={() => void add('file')}>
                <Icon name="plus" />
                Add an app or file
              </button>
            </div>
          </div>,
          head,
        )}
      <div className="cat-tools">
        {windows && settings.everything && (
          <div className="seg-ctl" role="group" aria-label="Search in">
            {(
              [
                ['both', 'Both'],
                ['catalog', 'Catalog'],
                ['everything', 'This PC'],
              ] as const
            ).map(([k, l]) => (
              <button
                key={k}
                aria-pressed={source === k}
                onClick={() => setSource(k)}
              >
                {l}
              </button>
            ))}
          </div>
        )}
        {showCatalog && (
          <>
            <div className="mt-chips" role="group" aria-label="Show">
              {filters.map(([k, l]) => (
                <button
                  key={k}
                  className="qchip"
                  aria-pressed={filter === k}
                  onClick={() => setFilter(k)}
                >
                  {l} <b>{counts[k]}</b>
                </button>
              ))}
            </div>
            <span className="grow" />
            <label className="cat-sort">
              Sort
              <select
                className="inp"
                value={sort}
                onChange={(e) => setSort(e.target.value as CatalogSort)}
              >
                <option value="lastOpened">Last opened</option>
                <option value="name">Name</option>
                <option value="kind">Type</option>
                <option value="added">Recently added</option>
              </select>
            </label>
            <button
              className="icon-btn"
              aria-label="Check the paths again"
              title="Check the paths again"
              onClick={reload}
            >
              <Icon name="refresh" />
            </button>
          </>
        )}
      </div>

      <div className="cat-body">
        {showCatalog && (
          <div className="cat-list" role="list" aria-label="Catalog">
            {shown.map((e) => (
              <div
                key={e.id}
                role="listitem"
                className={`cat-row ${e.missing ? 'missing' : ''}`}
                onDoubleClick={() => void open(e)}
              >
                <span
                  className={`qs-ico ${e.kind === 'folder' ? 'folder' : isApp(e) ? 'app' : 'file'}`}
                >
                  <Icon
                    name={
                      e.kind === 'folder' ? 'folder' : isApp(e) ? 'app' : 'file'
                    }
                  />
                </span>
                <span className="cat-main">
                  <span className="cat-name">
                    <b>{e.name}</b>
                    {e.favorite && <Icon name="star" className="fav" />}
                    {e.missing && <span className="cat-miss">Not found</span>}
                  </span>
                  <small className="cat-path" title={e.path}>
                    {e.path}
                  </small>
                </span>
                <span className="cat-meta">
                  <span className="cat-tags">
                    {e.tags.map((t) => (
                      <span key={t} className="note-tag">
                        {t}
                      </span>
                    ))}
                  </span>
                  {e.note && <small>{e.note}</small>}
                </span>
                <span className="cat-when muted">{ago(e.lastOpened)}</span>
                <span className="cat-acts">
                  <button
                    className="btn sm"
                    disabled={e.missing}
                    onClick={() => void open(e)}
                  >
                    Open
                  </button>
                  <button
                    className="icon-btn"
                    aria-label={`Show ${e.name} in its folder`}
                    title="Show in folder"
                    disabled={e.missing}
                    onClick={() =>
                      void attempt(() =>
                        window.worksync.revealCatalogEntry(e.id),
                      )
                    }
                  >
                    <Icon name="folder" />
                  </button>
                  <button
                    className="icon-btn"
                    aria-label={`Copy the path of ${e.name}`}
                    title="Copy path"
                    onClick={() => void copy(e.path)}
                  >
                    <Icon name="copy" />
                  </button>
                  <button
                    className={`icon-btn ${e.favorite ? 'on-fav' : ''}`}
                    aria-pressed={e.favorite}
                    aria-label={`Favorite: ${e.name}`}
                    title={
                      e.favorite ? 'Remove from favorites' : 'Add to favorites'
                    }
                    onClick={() => void favorite(e)}
                  >
                    <Icon name="star" />
                  </button>
                  <button
                    className="icon-btn"
                    aria-label={`Edit ${e.name}`}
                    title="Edit"
                    onClick={() => setEditing(e)}
                  >
                    <Icon name="edit" />
                  </button>
                  <button
                    className="icon-btn"
                    aria-label={`Remove ${e.name} from the Catalog`}
                    title="Remove from the Catalog (the file stays)"
                    onClick={() => void remove(e)}
                  >
                    <Icon name="x" />
                  </button>
                </span>
              </div>
            ))}
            {!shown.length && (
              <div className="empty">
                {entries.length
                  ? 'No entry matches. Try another filter or search.'
                  : 'Your Catalog is empty. Add the apps, files and folders you open often.'}
              </div>
            )}
          </div>
        )}
        {showFound && (
          <section className="cat-found" aria-label="Files on this PC">
            <div className="cat-found-head">
              <span className="k">Files on this PC</span>
              <FoundState answer={found} query={query} />
            </div>
            <div className="cat-found-list">
              {found?.results.map((r) => (
                <div key={r.path} className="cat-found-row">
                  <span className={`qs-ico ${r.isFolder ? 'folder' : 'found'}`}>
                    <Icon name={r.isFolder ? 'folder' : 'file'} />
                  </span>
                  <span className="cat-main">
                    <b>{r.name}</b>
                    <small className="cat-path" title={r.path}>
                      {r.folder}
                    </small>
                  </span>
                  <span className="cat-acts">
                    <button
                      className="btn sm"
                      onClick={() =>
                        void attempt(() =>
                          window.worksync.openFound(r.path, false),
                        )
                      }
                    >
                      Open
                    </button>
                    <button
                      className="icon-btn"
                      aria-label={`Show ${r.name} in its folder`}
                      title="Show in folder"
                      onClick={() =>
                        void attempt(() =>
                          window.worksync.openFound(r.path, true),
                        )
                      }
                    >
                      <Icon name="folder" />
                    </button>
                    <button
                      className="icon-btn"
                      aria-label={`Copy the path of ${r.name}`}
                      title="Copy path"
                      onClick={() => void copy(r.path)}
                    >
                      <Icon name="copy" />
                    </button>
                    <button
                      className="btn sm"
                      disabled={r.saved}
                      onClick={() => void addFound(r)}
                    >
                      {r.saved ? 'In the Catalog' : 'Add'}
                    </button>
                  </span>
                </div>
              ))}
            </div>
          </section>
        )}
      </div>
      {editing && (
        <EntryEditor
          entry={editing}
          onClose={() => setEditing(null)}
          onSaved={(e) => {
            put(e);
            setEditing(null);
            toast('Saved.');
          }}
        />
      )}
    </div>
  );
}

function FoundState({
  answer,
  query,
}: {
  answer: EverythingAnswer | null;
  query: string;
}) {
  const text = !query.trim()
    ? 'Type in the search box above to look for files and folders.'
    : !answer
      ? 'Searching…'
      : answer.state === 'starting'
        ? 'Everything is starting or building its index. Results appear in a moment.'
        : answer.state === 'unavailable'
          ? 'Everything isn’t available on this PC.'
          : `${answer.results.length} found for “${query.trim()}”`;
  return (
    <span className={`cat-found-state ${answer?.state ?? ''}`} role="status">
      {answer?.state === 'ok' && <span className="dot" />}
      {text}
    </span>
  );
}

function EntryEditor({
  entry,
  onClose,
  onSaved,
}: {
  entry: CatalogEntry;
  onClose: () => void;
  onSaved: (e: CatalogEntry) => void;
}) {
  const { attempt } = useApp();
  const [v, setV] = useState({
    name: entry.name,
    path: entry.path,
    tags: entry.tags.join(', '),
    note: entry.note,
  });
  const save = async (e?: FormEvent) => {
    e?.preventDefault();
    const u = await attempt(() =>
      window.worksync.saveCatalogEntry(
        { name: v.name, path: v.path, tags: parseTags(v.tags), note: v.note },
        entry.id,
      ),
    );
    if (u) onSaved(u);
  };
  return (
    <Modal
      title={`Edit ${entry.name}`}
      onClose={onClose}
      narrow
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary" onClick={() => void save()}>
            <Icon name="check" />
            Save
          </button>
        </>
      }
    >
      <form className="form" onSubmit={(e) => void save(e)}>
        <label>
          Name
          <input
            className="inp"
            value={v.name}
            onChange={(e) => setV({ ...v, name: e.target.value })}
          />
        </label>
        <label>
          Path
          <input
            className="inp mono"
            value={v.path}
            onChange={(e) => setV({ ...v, path: e.target.value })}
          />
        </label>
        <label>
          Tags
          <input
            className="inp"
            value={v.tags}
            placeholder="office, customer"
            onChange={(e) => setV({ ...v, tags: e.target.value })}
          />
        </label>
        <label>
          Note
          <textarea
            className="inp"
            rows={3}
            value={v.note}
            onChange={(e) => setV({ ...v, note: e.target.value })}
          />
        </label>
        <button type="submit" hidden />
      </form>
    </Modal>
  );
}
