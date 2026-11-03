import { app, ipcMain } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import {
  API_METHODS,
  channel,
  type AppInfo,
  type Startup,
  type WorkSyncApi,
} from '../shared/ipc';
import { toIsoDate } from '../shared/model';
import { dataFolderPath, isNetworkPath } from './dataFolder';
import { SCHEMA_VERSION, backupDaily, migrate, openDatabase } from './db';
import { addSampleProject } from './sample';
import { Store } from './store';

let db: DatabaseSync | null = null;
let store: Store | null = null;
let startup: Startup | null = null;

const today = () => toIsoDate(new Date());

/** Opens the data folder and the database once, backing up first. */
function open(): Startup {
  if (startup)
    return startup.ok
      ? {
          ...startup,
          projects: store!.listProjects(),
          tasks: store!.listTasks(),
          today: today(),
        }
      : startup;
  const dataFolder = dataFolderPath();
  try {
    if (isNetworkPath(dataFolder)) {
      throw new Error(
        `The data folder ${dataFolder} is on a network drive, where the database can be damaged. Move the WorkSync folder to a local drive, such as C: or D:, and start it again.`,
      );
    }
    fs.mkdirSync(dataFolder, { recursive: true });
    const file = path.join(dataFolder, 'worksync.db');
    const existed = fs.existsSync(file);
    db = openDatabase(file);
    const backups = path.join(dataFolder, 'backups');
    const version = Number(
      (db.prepare('PRAGMA user_version').get() as { user_version: number })
        .user_version,
    );
    if (existed && version > 0 && version < SCHEMA_VERSION) {
      fs.mkdirSync(backups, { recursive: true });
      db.exec(
        `VACUUM INTO '${path.join(backups, `before-upgrade-v${version}-${Date.now()}.db`).replaceAll("'", "''")}'`,
      );
    }
    migrate(db);
    if (existed) backupDaily(db, backups, today());
    store = new Store(db);
    startup = { ok: true, dataFolder, today: today(), projects: [], tasks: [] };
    return open();
  } catch (error) {
    startup = {
      ok: false,
      dataFolder,
      message: error instanceof Error ? error.message : String(error),
    };
    return startup;
  }
}

const need = (): Store => {
  if (!store)
    throw new Error('The data could not be opened. Restart WorkSync.');
  return store;
};

const handlers: WorkSyncApi = {
  getAppInfo: async (): Promise<AppInfo> => ({
    name: app.getName(),
    version: app.getVersion(),
    platform: process.platform,
    arch: process.arch,
    electronVersion: process.versions.electron,
    packaged: app.isPackaged,
  }),
  start: async () => open(),
  createProject: async (input) => need().createProject(input),
  updateProject: async (id, patch) => need().updateProject(id, patch),
  addSampleProject: async () => addSampleProject(need(), today()),
  listTasks: async () => need().listTasks(),
  createTask: async (projectId, input) => need().createTask(projectId, input),
  updateTask: async (id, patch) => need().updateTask(id, patch),
  setPriorityOverride: async (id, level) =>
    need().setPriorityOverride(id, level),
  setPinned: async (id, pinned) => need().setPinned(id, pinned),
  addSituationUpdate: async (id, input) => need().addSituationUpdate(id, input),
  setDifficultyOpen: async (taskId, difficultyId, isOpen) =>
    need().setDifficultyOpen(taskId, difficultyId, isOpen),
  deleteTask: async (id) => need().deleteTask(id),
  listActivity: async (taskId) => need().listActivity(taskId),
  addNote: async (taskId, text) => need().addNote(taskId, text),
};

/** Registers every IPC handler. Call once, before any window is created. */
export function registerIpcHandlers(): void {
  for (const method of API_METHODS) {
    const fn = handlers[method] as (...args: unknown[]) => Promise<unknown>;
    ipcMain.handle(channel(method), (_event, ...args: unknown[]) =>
      fn(...args),
    );
  }
}

/** Closes the database cleanly when the app quits. */
export function closeStore(): void {
  db?.close();
  db = null;
  store = null;
}
