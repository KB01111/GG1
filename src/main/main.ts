import path from 'node:path';
import { app, BrowserWindow, shell } from 'electron';
import started from 'electron-squirrel-startup';
import { AiService } from './ai-service.js';
import { DriveService } from './drive-service.js';
import { registerIpcHandlers } from './ipc.js';
import { ManifestStore } from './manifest-store.js';
import { SafeActionsService } from './safe-actions.js';
import { ScannerService } from './scanner-service.js';
import { EventEmitter } from 'node:events';

const isDev = Boolean(process.env.VITE_DEV_SERVER_URL);

if (started) {
  app.quit();
}

let mainWindow: BrowserWindow | undefined;

const userDataPath = app.getPath('userData');
const manifest = new ManifestStore(userDataPath);
const drive = new DriveService(userDataPath);
const services = {
  scanner: new ScannerService(),
  drive,
  manifest,
  safeActions: new SafeActionsService(manifest, drive, userDataPath),
  ai: new AiService(),
  events: new EventEmitter()
};

function setMainWindow(window: BrowserWindow): void {
  mainWindow = window;
}

function createWindow(): void {
  const preload = path.join(__dirname, 'preload.js');
  const window = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 1080,
    minHeight: 720,
    title: 'Drive Offloader',
    backgroundColor: '#0f172a',
    webPreferences: {
      preload,
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true
    }
  });

  window.webContents.setWindowOpenHandler(({ url }) => {
    try {
      const parsed = new URL(url);
      if (parsed.protocol === 'https:' || parsed.protocol === 'http:') {
        shell.openExternal(url).catch(() => undefined);
      }
    } catch {
      // Invalid URL, deny
    }
    return { action: 'deny' };
  });

  setMainWindow(window);

  if (isDev && process.env.VITE_DEV_SERVER_URL) {
    window.loadURL(process.env.VITE_DEV_SERVER_URL).catch((error) => console.error(error));
  } else {
    window.loadFile(path.join(app.getAppPath(), 'dist', 'renderer', 'index.html')).catch((error) => console.error(error));
  }
}

app.whenReady().then(() => {
  createWindow();
  if (mainWindow) {
    registerIpcHandlers(mainWindow, services);
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
}).catch((error: unknown) => {
  console.error(error);
  app.quit();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
