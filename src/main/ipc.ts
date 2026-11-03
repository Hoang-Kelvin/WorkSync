import {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  ipcMain,
  shell,
} from 'electron';
import { buildBatches, readAnswer } from '../shared/aiBatch';
import { randomUUID } from 'node:crypto';
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
import { SOURCES_EVENT } from '../shared/ipc';
import { dataFolderPath, isNetworkPath } from './dataFolder';
import { SCHEMA_VERSION, backupDaily, migrate, openDatabase } from './db';
import { addSampleProject } from './sample';
import { FileLinks } from './fileLinks';
import { CopyWriter } from './copyWriter';
import { PAGE_FILE, Publisher } from './publisher';
import { Sources } from './sources';
import { Store } from './store';
import { UnreadableFileError } from './workbook';

let db: DatabaseSync | null = null;
let store: Store | null = null;
let sources: Sources | null = null;
let links: FileLinks | null = null;
let publisher: Publisher | null = null;
let writer: CopyWriter | null = null;
/** Copies written in this session, which the window may open. */
const writtenCopies = new Set<string>();
/** Files the owner picked in this session; only these and linked files are read. */
const chosenFiles = new Set<string>();
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
          sources: sources!.list(),
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
    sources = new Sources(db, store);
    links = new FileLinks(sources, path.join(dataFolder, 'snapshots'));
    publisher = new Publisher(store, sources, path.join(dataFolder, 'preview'));
    writer = new CopyWriter(
      db,
      store,
      sources,
      links,
      path.join(app.getPath('documents'), 'WorkSync', 'Copies'),
    );
    startup = {
      ok: true,
      dataFolder,
      today: today(),
      projects: [],
      tasks: [],
      sources: [],
    };
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

const needLinks = (): { sources: Sources; links: FileLinks } => {
  if (!sources || !links)
    throw new Error('The data could not be opened. Restart WorkSync.');
  return { sources, links };
};

const needWriter = (): CopyWriter => {
  if (!writer)
    throw new Error('The data could not be opened. Restart WorkSync.');
  return writer;
};

const needPublisher = (): Publisher => {
  if (!publisher)
    throw new Error('The data could not be opened. Restart WorkSync.');
  return publisher;
};

const allowed = (file: string): string => {
  if (!chosenFiles.has(file)) throw new Error('Choose the file again.');
  return file;
};

/** Turns a read error into a message the owner can act on, and marks the source. */
function readOrMark<T>(sourceId: string, fn: () => T): T {
  try {
    return fn();
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    needLinks().sources.setState(
      sourceId,
      error instanceof UnreadableFileError ? 'unreadable' : 'unavailable',
      msg,
    );
    notifySources();
    throw error;
  }
}

/** Tells the window that linked files changed state. */
function notifySources(): void {
  if (!sources) return;
  const list = sources.list();
  for (const w of BrowserWindow.getAllWindows())
    w.webContents.send(SOURCES_EVENT, list);
}

let checking = false;
/** Checks every linked file and tells the window. */
export function checkLinkedFiles(): void {
  if (!links || checking) return;
  checking = true;
  try {
    links.checkAll();
    notifySources();
  } finally {
    checking = false;
  }
}

const handlers: Omit<WorkSyncApi, 'onSourcesChanged'> = {
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

  chooseFile: async () => {
    // Automated tests cannot click through the system dialog; they name the file instead.
    const testPick = process.env.WORKSYNC_TEST_PICK_FILE;
    if (testPick) {
      chosenFiles.add(testPick);
      return testPick;
    }
    const win =
      BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
    const r = await dialog.showOpenDialog(win, {
      title: 'Choose the customer’s Excel file',
      properties: ['openFile'],
      filters: [
        { name: 'Excel and CSV', extensions: ['xlsx', 'xlsm', 'xls', 'csv'] },
      ],
    });
    if (r.canceled || !r.filePaths[0]) return null;
    chosenFiles.add(r.filePaths[0]);
    return r.filePaths[0];
  },
  inspectFile: async (file) => needLinks().links.inspect(allowed(file)),
  previewFormat: async (file, format) =>
    needLinks().links.preview(allowed(file), format),
  linkFile: async (input) => {
    const { sources: s, links: l } = needLinks();
    allowed(input.file);
    const id = randomUUID();
    const v = l.readVersion(
      {
        id,
        path: input.file,
        pattern: input.pattern,
        currentFile: input.file,
        format: input.format,
      },
      input.file,
    );
    const r = s.link(input, v, id);
    notifySources();
    return r;
  },
  listSources: async () => needLinks().sources.list(),
  checkSources: async () => {
    checkLinkedFiles();
    return needLinks().sources.list();
  },
  reviewSource: async (id, byTitle) => {
    const { sources: s, links: l } = needLinks();
    const src = s.get(id);
    return readOrMark(id, () => s.review(id, l.readVersion(src), byTitle));
  },
  applySource: async (id, selection) => {
    const { sources: s, links: l } = needLinks();
    const src = s.get(id);
    const r = readOrMark(id, () => s.apply(id, l.readVersion(src), selection));
    notifySources();
    return r;
  },
  updateSourceFormat: async (id, format) =>
    needLinks().sources.updateFormat(id, format),
  unlinkSource: async (id) => {
    needLinks().sources.remove(id);
    notifySources();
  },
  listGlossary: async (projectId) => need().listGlossary(projectId),
  saveGlossaryTerm: async (input) => need().saveGlossaryTerm(input),
  deleteGlossaryTerm: async (id) => need().deleteGlossaryTerm(id),
  // All AI work goes through these calls (spec 06). The only provider is the
  // clipboard: the owner pastes the request into the Gemini web app.
  prepareAiBatches: async (projectId, taskIds) => {
    const st = need();
    const project = st.getProject(projectId);
    const tasks = taskIds
      .map((id) => st.getTask(id))
      .filter((t) => t.projectId === projectId);
    return buildBatches(
      tasks.map((t) => ({
        taskId: t.id,
        customerId: t.customerId,
        language: t.language,
        title: t.titleOriginal,
        description: t.descriptionOriginal,
        summary: t.summary,
      })),
      project.workingLanguage,
      st.listGlossary(projectId),
    );
  },
  readAiAnswer: async (batch, answer) => readAnswer(batch, answer),
  applyAiResults: async (results) => need().applyAiResults(results),
  copyText: async (text) => clipboard.writeText(text),
  lastImport: async (projectId) => need().lastImport(projectId),

  choosePublishFolder: async (projectId) => {
    const win =
      BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
    const current = need().getProject(projectId).publishFolder;
    // Automated tests cannot click through the system dialog; they name the folder instead.
    let folder = process.env.WORKSYNC_TEST_PICK_FOLDER ?? null;
    if (!folder) {
      const r = await dialog.showOpenDialog(win, {
        title: 'Choose the publish folder on the shared drive',
        defaultPath: current ?? undefined,
        properties: ['openDirectory', 'createDirectory'],
      });
      folder = r.canceled ? null : (r.filePaths[0] ?? null);
    }
    if (!folder) return null;
    const problem = needPublisher().folderProblem(folder);
    if (problem) throw new Error(problem);
    return need().setPublishOptions(projectId, { folder });
  },
  setPublishNotes: async (projectId, include) =>
    need().setPublishOptions(projectId, { notes: include }),
  publishStatus: async (projectId) => needPublisher().status(projectId),
  previewPublish: async (projectId) => {
    const file = needPublisher().preview(projectId);
    const win = new BrowserWindow({
      width: 1100,
      height: 820,
      title: 'Preview of the published page',
      backgroundColor: '#10141b',
      autoHideMenuBar: true,
      webPreferences: {
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
      },
    });
    // Links in the page open in the browser, never inside the app.
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    win.webContents.on('will-navigate', (e) => e.preventDefault());
    await win.loadFile(file);
  },
  publish: async (projectId) => needPublisher().publish(projectId),
  writePlans: async () => {
    const plans = needWriter().plans();
    notifySources();
    return plans;
  },
  pendingCount: async () => needWriter().pendingCount(),
  pendingForTask: async (taskId) => {
    const t = need().getTask(taskId);
    if (!t.sourceFileId) return [];
    return needWriter()
      .pending(needLinks().sources.get(t.sourceFileId))
      .filter((c) => c.taskId === taskId);
  },
  chooseCopyFolder: async (current) => {
    // Automated tests cannot click through the system dialog; they name the folder instead.
    if (process.env.WORKSYNC_TEST_COPY_FOLDER)
      return process.env.WORKSYNC_TEST_COPY_FOLDER;
    const win =
      BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
    const r = await dialog.showOpenDialog(win, {
      title: 'Choose where to save your copies',
      defaultPath: current,
      properties: ['openDirectory', 'createDirectory'],
    });
    return r.canceled ? null : (r.filePaths[0] ?? null);
  },
  writeCopy: async (sourceId, chosen, folder) => {
    const r = needWriter().write(sourceId, chosen, folder);
    writtenCopies.add(r.file);
    return r;
  },
  openCopy: async (file, inFolder) => {
    if (!writtenCopies.has(file))
      throw new Error(
        'Only copies written in this session can be opened from here.',
      );
    if (inFolder) shell.showItemInFolder(file);
    else {
      const err = await shell.openPath(file);
      if (err) throw new Error(err);
    }
  },
  openPublished: async (projectId) => {
    const folder = need().getProject(projectId).publishFolder;
    if (!folder) throw new Error('This project has not been published yet.');
    const err = await shell.openPath(path.join(folder, PAGE_FILE));
    if (err) throw new Error(err);
  },
  openSourceFile: async (id) => {
    const src = needLinks().sources.get(id);
    const err = await shell.openPath(src.currentFile);
    if (err) throw new Error(err);
  },
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
