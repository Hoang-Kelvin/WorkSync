import { app, BrowserWindow, nativeTheme } from 'electron';
import path from 'node:path';
import {
  backupTick,
  checkLinkedFiles,
  closeStore,
  registerIpcHandlers,
} from './ipc';

/** Linked files are checked at start, when the window comes to the front, and every few minutes (spec 04). */
const CHECK_EVERY_MS = 3 * 60 * 1000;

const createWindow = (): void => {
  const mainWindow = new BrowserWindow({
    width: 1360,
    height: 860,
    minWidth: 900,
    minHeight: 600,
    title: 'WorkSync',
    // Matches the window color of the theme, so nothing flashes while it loads.
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#10141b' : '#f6f7f9',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      // The renderer is treated as untrusted web content: it gets no Node.js
      // access and talks to the main process only through the preload API.
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(
      path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`),
    );
  }

  if (!app.isPackaged) {
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  }
};

app.whenReady().then(() => {
  registerIpcHandlers();
  createWindow();
  setInterval(checkLinkedFiles, CHECK_EVERY_MS);
  // The day's backup, taken once the date changes while the app runs.
  setInterval(backupTick, 60 * 60 * 1000);
  app.on('browser-window-focus', () => checkLinkedFiles());

  // On macOS it's common to re-create a window when the dock icon is clicked
  // and there are no other windows open.
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

// Quit when all windows are closed, except on macOS, where apps stay active
// until the user quits explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('will-quit', closeStore);
