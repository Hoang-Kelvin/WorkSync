import { app, ipcMain } from 'electron';
import { IpcChannel, type AppInfo } from '../shared/ipc';
import { runPcChecks } from './dataFolder';

/** Registers every IPC handler. Call once, before any window is created. */
export function registerIpcHandlers(): void {
  ipcMain.handle(IpcChannel.GetAppInfo, (): AppInfo => ({
    name: app.getName(),
    version: app.getVersion(),
    platform: process.platform,
    arch: process.arch,
    electronVersion: process.versions.electron,
    packaged: app.isPackaged,
  }));
  ipcMain.handle(IpcChannel.RunPcChecks, () => runPcChecks());
}
