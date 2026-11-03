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
  Level,
  Project,
  ProjectInput,
  SituationInput,
  Task,
  TaskInput,
  ViewKey,
} from './model';

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

  createProject(input: ProjectInput): Promise<Project>;
  updateProject(id: string, patch: ProjectPatch): Promise<Project>;
  /** Adds the sample project and returns its id. */
  addSampleProject(): Promise<string>;
  listTasks(): Promise<Task[]>;

  createTask(projectId: string, input: TaskInput): Promise<Task>;
  updateTask(id: string, patch: Partial<TaskInput>): Promise<Task>;
  setPriorityOverride(id: string, level: Level | null): Promise<Task>;
  setPinned(id: string, pinned: boolean): Promise<Task>;
  addSituationUpdate(id: string, input: SituationInput): Promise<Task>;
  setDifficultyOpen(
    taskId: string,
    difficultyId: string,
    open: boolean,
  ): Promise<Task>;
  deleteTask(id: string): Promise<void>;

  listActivity(taskId: string): Promise<ActivityEntry[]>;
  addNote(taskId: string, text: string): Promise<void>;
}

/** Every method of the API. Each is sent on the channel `worksync:<name>`. */
export const API_METHODS = [
  'getAppInfo',
  'start',
  'createProject',
  'updateProject',
  'addSampleProject',
  'listTasks',
  'createTask',
  'updateTask',
  'setPriorityOverride',
  'setPinned',
  'addSituationUpdate',
  'setDifficultyOpen',
  'deleteTask',
  'listActivity',
  'addNote',
] as const satisfies readonly (keyof WorkSyncApi)[];

export const channel = (method: keyof WorkSyncApi): string =>
  `worksync:${method}`;
