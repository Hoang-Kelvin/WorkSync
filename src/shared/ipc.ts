/**
 * Contract between the main process and the renderer.
 *
 * This file is imported by the main process, the preload script and the
 * renderer, so it must stay free of Node.js and Electron imports.
 * Add a method to `WorkSyncApi` first, then implement it in `src/main/ipc.ts`;
 * the preload script exposes every method listed in `API_METHODS`.
 */
import type {
  ActivityEntry,
  BulkChange,
  Level,
  Project,
  ProjectInput,
  SituationInput,
  Task,
  TableSettings,
  TaskInput,
  ViewKey,
} from './model';
import type { FileFormat } from './importRules';
import type { AppSettings, StorageInfo } from './settings';
import type { Batch, ReadAnswer } from './aiBatch';
import type { PendingChange, WritePlan, WriteResult } from './writes';
import type { ReportOptions } from './reports';
import type {
  AiResult,
  GlossaryTerm,
  ImportSummary,
  PublishStatus,
} from './model';
import type {
  ApplySelection,
  FileInspection,
  FormatPreview,
  LinkInput,
  Review,
  SourceFile,
} from './sources';

export interface AppInfo {
  name: string;
  version: string;
  /** Value of `process.platform`, e.g. `win32`, `darwin` or `linux`. */
  platform: string;
  arch: string;
  electronVersion: string;
  /** True for a built app, false when running with `npm start`. */
  packaged: boolean;
}

/** What the window needs to start. */
export type Startup =
  | {
      ok: true;
      dataFolder: string;
      /** Today in the owner's local time, `YYYY-MM-DD`. */
      today: string;
      projects: Project[];
      tasks: Task[];
      sources: SourceFile[];
      settings: AppSettings;
      /** A warning about where the data folder is, such as in a synced folder. */
      warning: string | null;
    }
  | { ok: false; dataFolder: string; message: string };

export type ProjectPatch = Partial<ProjectInput> & {
  views?: Partial<Record<ViewKey, boolean>>;
  dueSoonDays?: number;
};

/** The API the preload script exposes to the renderer as `window.worksync`. */
export interface WorkSyncApi {
  getAppInfo(): Promise<AppInfo>;
  start(): Promise<Startup>;

  updateSettings(patch: Partial<AppSettings>): Promise<AppSettings>;
  storageInfo(): Promise<StorageInfo>;
  /** Asks for a backup folder; null when cancelled. */
  chooseBackupFolder(): Promise<string | null>;
  backupNow(): Promise<StorageInfo>;
  /** Asks for a backup file kept elsewhere, such as on a USB drive. */
  chooseBackupFile(): Promise<string | null>;
  inspectBackup(file: string): Promise<{ projects: number; tasks: number }>;
  /** Backs up the current data, puts the backup in its place and restarts. */
  restoreBackup(file: string): Promise<void>;
  openFolder(which: 'data' | 'backups' | 'logs'): Promise<void>;

  createProject(input: ProjectInput): Promise<Project>;
  updateProject(id: string, patch: ProjectPatch): Promise<Project>;
  /** Adds the sample project and returns its id. */
  addSampleProject(): Promise<string>;
  listTasks(): Promise<Task[]>;

  createTask(projectId: string, input: TaskInput): Promise<Task>;
  updateTask(id: string, patch: Partial<TaskInput>): Promise<Task>;
  setPriorityOverride(id: string, level: Level | null): Promise<Task>;
  setPinned(id: string, pinned: boolean): Promise<Task>;
  /** One change to several tasks, from the Tasks table. */
  bulkUpdate(ids: string[], change: BulkChange): Promise<Task[]>;
  setTableSettings(
    projectId: string,
    settings: TableSettings | null,
  ): Promise<Project>;
  addSituationUpdate(id: string, input: SituationInput): Promise<Task>;
  setDifficultyOpen(
    taskId: string,
    difficultyId: string,
    open: boolean,
  ): Promise<Task>;
  deleteTask(id: string): Promise<void>;

  listActivity(taskId: string): Promise<ActivityEntry[]>;
  addNote(taskId: string, text: string): Promise<void>;

  /** Opens the system file dialog. Returns the chosen file, or null. */
  chooseFile(): Promise<string | null>;
  inspectFile(file: string): Promise<FileInspection>;
  previewFormat(file: string, format: FileFormat): Promise<FormatPreview>;
  linkFile(
    input: LinkInput,
  ): Promise<{ source: SourceFile; added: number; skipped: number }>;
  listSources(): Promise<SourceFile[]>;
  /** Checks every linked file now. */
  checkSources(): Promise<SourceFile[]>;
  reviewSource(id: string, byTitle: boolean): Promise<Review>;
  applySource(
    id: string,
    selection: ApplySelection,
  ): Promise<{ added: number; changed: number; removed: number }>;
  updateSourceFormat(id: string, format: FileFormat): Promise<SourceFile>;
  unlinkSource(id: string): Promise<void>;
  /** Opens the linked file in Excel, or whatever opens it on this PC. */
  openSourceFile(id: string): Promise<void>;

  listGlossary(projectId: string): Promise<GlossaryTerm[]>;
  saveGlossaryTerm(
    input: Omit<GlossaryTerm, 'id'> & { id?: string },
  ): Promise<GlossaryTerm>;
  deleteGlossaryTerm(id: string): Promise<void>;

  /** Builds the Gemini requests for the chosen tasks, split into batches. */
  prepareAiBatches(projectId: string, taskIds: string[]): Promise<Batch[]>;
  /** Reads a pasted answer and checks it against its batch. */
  readAiAnswer(batch: Pick<Batch, 'keys'>, answer: string): Promise<ReadAnswer>;
  /** Fills in what the owner accepted. */
  applyAiResults(results: AiResult[]): Promise<Task[]>;
  copyText(text: string): Promise<void>;
  lastImport(projectId: string): Promise<ImportSummary | null>;

  /** Opens the folder dialog and saves the project's publish folder. Returns null when cancelled. */
  choosePublishFolder(projectId: string): Promise<Project | null>;
  setPublishNotes(projectId: string, include: boolean): Promise<Project>;
  publishStatus(projectId: string): Promise<PublishStatus>;
  /** Opens the page as it would be published, in its own window. */
  previewPublish(projectId: string): Promise<void>;
  publish(projectId: string): Promise<PublishStatus>;
  /** Opens the published page in the default browser. */
  openPublished(projectId: string): Promise<void>;

  /** The changes waiting to be written, per linked file. */
  writePlans(): Promise<WritePlan[]>;
  pendingCount(): Promise<number>;
  pendingForTask(taskId: string): Promise<PendingChange[]>;
  /** Opens the folder dialog for where copies are saved. Returns null when cancelled. */
  chooseCopyFolder(current: string): Promise<string | null>;
  /** Writes the chosen changes (`taskId:field`) into a new copy in the folder, and checks it. */
  writeCopy(
    sourceId: string,
    chosen: string[],
    folder: string,
  ): Promise<WriteResult>;
  /** Opens a copy WorkSync wrote, or shows it in its folder. */
  openCopy(file: string, inFolder: boolean): Promise<void>;

  /** Makes a report and asks where to save it. Returns the saved file, or null when cancelled. */
  makeReport(
    options: ReportOptions,
  ): Promise<{ file: string; tasks: number } | null>;

  /** Called whenever linked files change state. Returns a function that stops listening. */
  onSourcesChanged(listener: (sources: SourceFile[]) => void): () => void;
}

/** Sent by the main process when linked files change state. */
export const SOURCES_EVENT = 'worksync:sources-changed';

/** Every method of the API. Each is sent on the channel `worksync:<name>`. */
export const API_METHODS = [
  'getAppInfo',
  'start',
  'updateSettings',
  'storageInfo',
  'chooseBackupFolder',
  'backupNow',
  'chooseBackupFile',
  'inspectBackup',
  'restoreBackup',
  'openFolder',
  'createProject',
  'updateProject',
  'addSampleProject',
  'listTasks',
  'createTask',
  'updateTask',
  'setPriorityOverride',
  'setPinned',
  'bulkUpdate',
  'setTableSettings',
  'addSituationUpdate',
  'setDifficultyOpen',
  'deleteTask',
  'listActivity',
  'addNote',
  'chooseFile',
  'inspectFile',
  'previewFormat',
  'linkFile',
  'listSources',
  'checkSources',
  'reviewSource',
  'applySource',
  'updateSourceFormat',
  'unlinkSource',
  'openSourceFile',
  'listGlossary',
  'saveGlossaryTerm',
  'deleteGlossaryTerm',
  'prepareAiBatches',
  'readAiAnswer',
  'applyAiResults',
  'copyText',
  'lastImport',
  'choosePublishFolder',
  'setPublishNotes',
  'publishStatus',
  'previewPublish',
  'publish',
  'openPublished',
  'writePlans',
  'pendingCount',
  'pendingForTask',
  'chooseCopyFolder',
  'writeCopy',
  'openCopy',
  'makeReport',
] as const satisfies readonly Exclude<keyof WorkSyncApi, 'onSourcesChanged'>[];

export const channel = (method: (typeof API_METHODS)[number]): string =>
  `worksync:${method}`;
