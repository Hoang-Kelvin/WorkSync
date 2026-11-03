import { app } from 'electron';
import path from 'node:path';

/**
 * Where WorkSync keeps its data.
 *
 * A packaged app is unzipped into a folder such as D:\Tools\WorkSync, and its
 * data lives in a folder beside it, WorkSync-data, so replacing the app folder
 * with a new version never touches the data. During development the data goes
 * into the user's app-data folder instead.
 */
export function dataFolderPath(): string {
  if (!app.isPackaged) {
    return path.join(app.getPath('userData'), 'WorkSync-data-dev');
  }
  // On macOS the executable sits inside WorkSync.app/Contents/MacOS.
  const appFolder =
    process.platform === 'darwin'
      ? path.resolve(path.dirname(process.execPath), '..', '..', '..')
      : path.dirname(process.execPath);
  return path.join(path.dirname(appFolder), 'WorkSync-data');
}

/** True for a path on a network share, such as \\server\share. */
export const isNetworkPath = (p: string): boolean =>
  p.startsWith('\\\\') || p.startsWith('//');
