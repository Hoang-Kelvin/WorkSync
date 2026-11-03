import { contextBridge, ipcRenderer } from 'electron';
import { IpcChannel, type WorkSyncApi } from '../shared/ipc';

// Expose a narrow, typed API instead of ipcRenderer itself, so the renderer
// can only call the channels listed here.
const api: WorkSyncApi = {
  getAppInfo: () => ipcRenderer.invoke(IpcChannel.GetAppInfo),
  runPcChecks: () => ipcRenderer.invoke(IpcChannel.RunPcChecks),
};

contextBridge.exposeInMainWorld('worksync', api);
