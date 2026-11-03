/**
 * Contract between the main process and the renderer.
 *
 * This file is imported by the main process, the preload script and the
 * renderer, so it must stay free of Node.js and Electron imports.
 * Add a channel here first, then implement it in `src/main/ipc.ts`,
 * expose it in `src/preload/preload.ts` and type it on `WorkSyncApi`.
 */

export const IpcChannel = {
  GetAppInfo: 'app:get-info',
  RunPcChecks: 'app:run-pc-checks',
} as const;

export interface AppInfo {
  name: string;
  version: string;
  /** Value of `process.platform`, e.g. `win32`, `darwin` or `linux`. */
  platform: string;
  /** Value of `process.arch`, e.g. `x64` or `arm64`. */
  arch: string;
  electronVersion: string;
  /** True for a built app, false when running with `npm start`. */
  packaged: boolean;
}

/** One line of the work PC check. */
export interface CheckResult {
  name: string;
  ok: boolean;
  detail: string;
}

/** The API the preload script exposes to the renderer as `window.worksync`. */
export interface WorkSyncApi {
  getAppInfo(): Promise<AppInfo>;
  runPcChecks(): Promise<CheckResult[]>;
}
