import { contextBridge, ipcRenderer } from 'electron';
import { API_METHODS, channel, type WorkSyncApi } from '../shared/ipc';

// Expose a narrow, typed API instead of ipcRenderer itself, so the renderer
// can only call the methods listed in API_METHODS.
const api = Object.fromEntries(
  API_METHODS.map((method) => [
    method,
    async (...args: unknown[]) => {
      try {
        return await ipcRenderer.invoke(channel(method), ...args);
      } catch (error) {
        // Electron prefixes errors with "Error invoking remote method ...";
        // keep only the message the main process wrote for the owner.
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(
          message.replace(
            /^Error invoking remote method '[^']+': (Error: )?/,
            '',
          ),
        );
      }
    },
  ]),
) as unknown as WorkSyncApi;

contextBridge.exposeInMainWorld('worksync', api);
