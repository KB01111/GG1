import type { EventEmitter } from 'node:events';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { dialog, ipcMain } from 'electron';
import type { BrowserWindow } from 'electron';
import { createStableId } from '../shared/manifest.js';
import { isProtectedPath } from '../shared/protected-paths.js';
import type { FileSystemItem, ManifestEntry, ScanRequest, UploadJob, UploadProgress } from '../shared/types.js';
import type { AiService } from './ai-service.js';
import type { DriveService } from './drive-service.js';
import type { ManifestStore } from './manifest-store.js';
import type { SafeActionsService } from './safe-actions.js';
import type { ScannerService } from './scanner-service.js';

export interface Services {
  scanner: ScannerService;
  drive: DriveService;
  manifest: ManifestStore;
  safeActions: SafeActionsService;
  ai: AiService;
  events: EventEmitter;
}

async function collectUploadableFiles(item: FileSystemItem): Promise<FileSystemItem[]> {
  if (item.kind === 'file') {
    return [item];
  }

  const files: FileSystemItem[] = [];
  async function walk(currentPath: string): Promise<void> {
    const protectedMatch = isProtectedPath(currentPath);
    if (protectedMatch.protected) {
      return;
    }

    const stats = await fs.stat(currentPath);
    if (stats.isFile()) {
      files.push({
        id: createStableId(`${currentPath}:${stats.mtimeMs}:${stats.size}`),
        path: currentPath,
        name: path.basename(currentPath),
        kind: 'file',
        size: stats.size,
        modifiedAt: stats.mtime.toISOString(),
        accessedAt: stats.atime.toISOString(),
        depth: path.resolve(currentPath).split(path.sep).filter(Boolean).length,
        extension: path.extname(currentPath).toLowerCase(),
        protected: false,
        reasons: []
      });
      return;
    }

    if (!stats.isDirectory()) {
      return;
    }

    const directory = await fs.opendir(currentPath);
    for await (const entry of directory) {
      await walk(path.join(currentPath, entry.name));
    }
  }

  await walk(item.path);
  return files;
}

export function registerIpcHandlers(mainWindow: BrowserWindow, services: Services): void {
  services.scanner.on('progress', (progress) => {
    mainWindow.webContents.send('scan:progress', progress);
  });

  services.events.on('upload:progress', (progress: UploadProgress) => {
    mainWindow.webContents.send('upload:progress', progress);
  });

  ipcMain.handle('folders:select', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Select folders to scan',
      properties: ['openDirectory', 'multiSelections']
    });
    return result.canceled ? [] : result.filePaths;
  });

  ipcMain.handle('scan:start', async (_event, request: ScanRequest) => services.scanner.scan(request));
  ipcMain.handle('scan:cancel', async (_event, scanId: string) => services.scanner.cancel(scanId));
  ipcMain.handle('drive:auth-state', async () => services.drive.getAuthState());
  ipcMain.handle('drive:auth:start', async () => services.drive.beginOAuth());
  ipcMain.handle('manifest:list', async () => services.manifest.list());
  ipcMain.handle('ai:classify', async (_event, items, baseline) => services.ai.classifyWithExplanation(items, baseline));

  ipcMain.handle('drive:upload', async (_event, selectedItems: FileSystemItem[]) => {
    const entries: ManifestEntry[] = [];
    for (const selectedItem of selectedItems) {
      const protectedMatch = isProtectedPath(selectedItem.path);
      if (protectedMatch.protected) {
        throw new Error(`Refusing to upload protected path: ${selectedItem.path}`);
      }

      const uploadFiles = await collectUploadableFiles(selectedItem);
      for (const item of uploadFiles) {
        const job: UploadJob = {
          id: createStableId(`upload:${item.path}:${Date.now()}`),
          item,
          status: 'queued',
          progressBytes: 0,
          totalBytes: item.size
        };
        const result = await services.drive.uploadFile(job, (progress) => services.events.emit('upload:progress', progress));
        const entry = services.drive.createManifestEntry(item.path, result);
        await services.manifest.add(entry);
        entries.push(entry);
      }
    }
    return entries;
  });

  ipcMain.handle('safe:plan-delete', async (_event, entryIds: string[]) => {
    const entries = (await services.manifest.list()).filter((entry) => entryIds.includes(entry.id));
    return services.safeActions.planDeletion(entries);
  });

  ipcMain.handle('safe:quarantine', async (_event, entryIds: string[]) => {
    const entries = (await services.manifest.list()).filter((entry) => entryIds.includes(entry.id));
    return services.safeActions.quarantine(entries);
  });

  ipcMain.handle('safe:delete', async (_event, approval) => {
    const entries = (await services.manifest.list()).filter((entry) => approval.approvedEntryIds.includes(entry.id));
    return services.safeActions.deleteVerified(entries, approval);
  });

  ipcMain.handle('restore:start', async (_event, entryId: string, destinationPath: string) => {
    const entry = (await services.manifest.list()).find((candidate) => candidate.id === entryId);
    if (!entry) {
      throw new Error('Manifest entry not found');
    }
    return services.safeActions.restore(entry, destinationPath);
  });
}
