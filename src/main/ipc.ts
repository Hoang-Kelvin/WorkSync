import { app, ipcMain } from 'electron';
import { IpcChannel, type AppInfo } from '../shared/ipc';

/** Registers every IPC handler. Call once, before any window is created. */
export function registerIpcHandlers(): void {
  ipcMain.handle(IpcChannel.GetAppInfo, (): AppInfo => ({
    name: app.getName(),
    version: app.getVersion(),
    platform: process.platform,
    electronVersion: process.versions.electron,
  }));
}
