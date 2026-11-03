import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Schema migrations, in order. The database keeps the number of the last one
 * applied, and the app takes a backup before applying any new ones (spec 06).
 * Never edit a migration that has shipped; add a new one instead.
 */
const MIGRATIONS: string[] = [
  `
  CREATE TABLE projects (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    customer TEXT NOT NULL DEFAULT '',
    original_languages TEXT NOT NULL,   -- JSON array of language codes
    working_language TEXT NOT NULL,
    views TEXT NOT NULL,                -- JSON object: view key -> shown
    due_soon_days INTEGER NOT NULL DEFAULT 7,
    created_at TEXT NOT NULL
  );
  CREATE TABLE tasks (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    customer_id TEXT NOT NULL DEFAULT '',
    source TEXT NOT NULL DEFAULT 'hand',
    language TEXT NOT NULL,
    title_original TEXT NOT NULL,
    title_translation TEXT NOT NULL DEFAULT '',
    description_original TEXT NOT NULL DEFAULT '',
    description_translation TEXT NOT NULL DEFAULT '',
    translation_state TEXT NOT NULL,
    summary TEXT NOT NULL DEFAULT '',
    notes TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL,
    priority TEXT NOT NULL,
    priority_override TEXT,
    labels TEXT NOT NULL DEFAULT '[]',  -- JSON array
    assignee TEXT NOT NULL DEFAULT '',
    category TEXT NOT NULL DEFAULT '',
    remarks TEXT NOT NULL DEFAULT '',
    planned_start TEXT, planned_end TEXT, actual_start TEXT, actual_end TEXT,
    pinned INTEGER NOT NULL DEFAULT 0,
    next_action TEXT NOT NULL DEFAULT '',
    next_action_date TEXT,
    -- the current situation, carried forward from the newest situation update
    handled_by TEXT NOT NULL DEFAULT '',
    doing_now TEXT NOT NULL DEFAULT '',
    waiting_on TEXT NOT NULL DEFAULT 'Nobody',
    next_step TEXT NOT NULL DEFAULT '',
    next_date TEXT,
    as_of TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX tasks_project ON tasks(project_id);
  CREATE TABLE situation_updates (
    id TEXT PRIMARY KEY,
    task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    at TEXT NOT NULL,
    handled_by TEXT NOT NULL, doing_now TEXT NOT NULL, waiting_on TEXT NOT NULL,
    next_step TEXT NOT NULL, next_date TEXT, as_of TEXT NOT NULL
  );
  CREATE TABLE difficulties (
    id TEXT PRIMARY KEY,
    task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    text TEXT NOT NULL,
    raised_on TEXT NOT NULL,
    resolver TEXT NOT NULL DEFAULT '',
    open INTEGER NOT NULL DEFAULT 1,
    position INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE activity (
    id TEXT PRIMARY KEY,
    task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    at TEXT NOT NULL,
    kind TEXT NOT NULL,
    text TEXT NOT NULL
  );
  CREATE INDEX activity_task ON activity(task_id, at);
  `,
  // 2: linked source files (spec 04)
  `
  CREATE TABLE source_files (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    path TEXT NOT NULL,                 -- the file, or the folder for a name pattern
    pattern TEXT,                       -- such as WBS_*.xlsx; the newest match is read
    current_file TEXT NOT NULL,         -- the file read last
    format TEXT NOT NULL,               -- JSON FileFormat
    main_language TEXT NOT NULL,
    fingerprint TEXT NOT NULL,
    size INTEGER NOT NULL,
    mtime_ms REAL NOT NULL,
    last_read_at TEXT NOT NULL,
    state TEXT NOT NULL DEFAULT 'ok',   -- ok, changed, missing, unavailable, unreadable
    state_detail TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL
  );
  CREATE TABLE file_versions (
    id TEXT PRIMARY KEY,
    source_id TEXT NOT NULL REFERENCES source_files(id) ON DELETE CASCADE,
    read_at TEXT NOT NULL,
    fingerprint TEXT NOT NULL,
    snapshot TEXT NOT NULL,
    file_name TEXT NOT NULL
  );
  ALTER TABLE tasks ADD COLUMN source_file_id TEXT REFERENCES source_files(id) ON DELETE SET NULL;
  ALTER TABLE tasks ADD COLUMN sheet_row INTEGER;
  ALTER TABLE tasks ADD COLUMN file_state TEXT NOT NULL DEFAULT 'hand';
  ALTER TABLE tasks ADD COLUMN status_word TEXT NOT NULL DEFAULT '';
  ALTER TABLE tasks ADD COLUMN priority_word TEXT NOT NULL DEFAULT '';
  ALTER TABLE tasks ADD COLUMN extra TEXT NOT NULL DEFAULT '{}';
  -- the row as last read from the file, so file changes can be told from the owner's edits
  ALTER TABLE tasks ADD COLUMN file_row TEXT;
  CREATE INDEX tasks_source ON tasks(source_file_id);
  `,
  // 3: the project glossary (spec 02)
  `
  CREATE TABLE glossary_terms (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    term TEXT NOT NULL,
    translation TEXT NOT NULL,
    language TEXT NOT NULL,
    note TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL
  );
  CREATE INDEX glossary_project ON glossary_terms(project_id);
  `,
  // 4: what each import changed, for the dashboard
  `
  ALTER TABLE file_versions ADD COLUMN summary TEXT;
  `,
  // 5: publishing to the shared folder (spec 05)
  `
  ALTER TABLE projects ADD COLUMN publish_folder TEXT;
  ALTER TABLE projects ADD COLUMN publish_notes INTEGER NOT NULL DEFAULT 0;
  CREATE TABLE publish_records (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    at TEXT NOT NULL,
    folder TEXT NOT NULL,
    files TEXT NOT NULL               -- JSON: file name -> SHA-256
  );
  CREATE INDEX publish_project ON publish_records(project_id, at);
  `,
];

export const SCHEMA_VERSION = MIGRATIONS.length;

const userVersion = (db: DatabaseSync): number =>
  Number(
    (db.prepare('PRAGMA user_version').get() as { user_version: number })
      .user_version,
  );

/** Applies any migrations the database has not had yet. */
export function migrate(db: DatabaseSync): void {
  const from = userVersion(db);
  if (from > SCHEMA_VERSION) {
    throw new Error(
      `This data was saved by a newer version of WorkSync (database version ${from}). Use that version or newer.`,
    );
  }
  for (let v = from; v < SCHEMA_VERSION; v++) {
    db.exec('BEGIN');
    try {
      db.exec(MIGRATIONS[v]);
      db.exec(`PRAGMA user_version = ${v + 1}`);
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  }
}

export function openDatabase(file: string): DatabaseSync {
  const db = new DatabaseSync(file);
  db.exec(
    'PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 3000;',
  );
  return db;
}

const BACKUPS_KEPT = 14;

/**
 * Backs up the database once a day, named by date, and keeps the last 14
 * (spec 06). Uses VACUUM INTO, which writes a complete copy even while the
 * database is open.
 */
export function backupDaily(
  db: DatabaseSync,
  backupFolder: string,
  today: string,
): string | null {
  fs.mkdirSync(backupFolder, { recursive: true });
  const target = path.join(backupFolder, `worksync-${today}.db`);
  if (fs.existsSync(target)) return null;
  db.exec(`VACUUM INTO '${target.replaceAll("'", "''")}'`);
  const old = fs
    .readdirSync(backupFolder)
    .filter((f) => /^worksync-\d{4}-\d{2}-\d{2}\.db$/.test(f))
    .sort()
    .slice(0, -BACKUPS_KEPT);
  for (const f of old) fs.rmSync(path.join(backupFolder, f));
  return target;
}
