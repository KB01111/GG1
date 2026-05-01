import { contextBridge, ipcRenderer } from 'electron';
import type { Classification, DestructiveApproval, FileSystemItem, ScanProgress, ScanRequest, StorageCleanerApi, UploadProgress } from '../shared/types.js';

const api: StorageCleanerApi = {
  selectFolders: () => ipcRenderer.invoke('folders:select') as Promise<string[]>,
  startScan: (request: ScanRequest) => ipcRenderer.invoke('scan:start', request),
  onScanProgress: (callback: (progress: ScanProgress) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, progress: ScanProgress) => callback(progress);
    ipcRenderer.on('scan:progress', listener);
    return () => ipcRenderer.off('scan:progress', listener);
  },
  getDriveAuthState: () => ipcRenderer.invoke('drive:auth-state'),
  beginDriveOAuth: () => ipcRenderer.invoke('drive:auth:start'),
  uploadItems: (items: FileSystemItem[]) => ipcRenderer.invoke('drive:upload', items),
  onUploadProgress: (callback: (progress: UploadProgress) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, progress: UploadProgress) => callback(progress);
    ipcRenderer.on('upload:progress', listener);
    return () => ipcRenderer.off('upload:progress', listener);
  },
  listManifest: () => ipcRenderer.invoke('manifest:list'),
  classifyWithAi: (items: FileSystemItem[], baseline: Classification[]) => ipcRenderer.invoke('ai:classify', items, baseline),
  planDeletion: (entryIds: string[]) => ipcRenderer.invoke('safe:plan-delete', entryIds),
  quarantine: (entryIds: string[]) => ipcRenderer.invoke('safe:quarantine', entryIds),
  deleteVerified: (approval: DestructiveApproval) => ipcRenderer.invoke('safe:delete', approval),
  restore: (entryId: string, destinationPath: string) => ipcRenderer.invoke('restore:start', entryId, destinationPath)
};

contextBridge.exposeInMainWorld('storageCleaner', api);
