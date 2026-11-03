import { app } from 'electron';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { CheckResult } from '../shared/ipc';

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

const isNetworkPath = (p: string): boolean =>
  p.startsWith('\\\\') || p.startsWith('//');

/**
 * Checks that the app can run from where it was unzipped and keep its data
 * there. Used by the work PC check in the first test build.
 */
export async function runPcChecks(): Promise<CheckResult[]> {
  const results: CheckResult[] = [];
  const folder = dataFolderPath();

  results.push({
    name: 'App started',
    ok: true,
    detail: `Running from ${path.dirname(process.execPath)}`,
  });

  if (isNetworkPath(folder)) {
    results.push({
      name: 'Data folder on a local drive',
      ok: false,
      detail: `${folder} is on a network drive. Unzip WorkSync to a local drive, such as C: or D:.`,
    });
  } else {
    results.push({
      name: 'Data folder on a local drive',
      ok: true,
      detail: folder,
    });
  }

  try {
    await fs.mkdir(folder, { recursive: true });
    const probe = path.join(folder, `.write-test-${process.pid}`);
    await fs.writeFile(probe, 'WorkSync write test');
    const back = await fs.readFile(probe, 'utf8');
    await fs.rm(probe);
    results.push({
      name: 'Can save data',
      ok: back === 'WorkSync write test',
      detail: `Created, read and deleted a test file in ${folder}`,
    });
  } catch (error) {
    results.push({
      name: 'Can save data',
      ok: false,
      detail: `Could not write to ${folder}: ${error instanceof Error ? error.message : String(error)}`,
    });
  }

  return results;
}
