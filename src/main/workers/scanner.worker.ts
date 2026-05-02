import { parentPort, workerData } from 'node:worker_threads';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createStableId } from '../../shared/manifest.js';
import { isProtectedPath } from '../../shared/protected-paths.js';
import type { FileSystemItem, ScanProgress, ScannerWorkerEvent, ScannerWorkerRequest } from '../../shared/types.js';

interface ScanState {
  scanId: string;
  items: FileSystemItem[];
  scannedCount: number;
  skippedCount: number;
  protectedCount: number;
  totalBytes: number;
  startedAt: string;
  lastEmitAt: number;
}

const request = workerData as ScannerWorkerRequest;

function post(event: ScannerWorkerEvent): void {
  parentPort?.postMessage(event);
}

function emitProgress(state: ScanState, currentPath: string, status: ScanProgress['status'], message?: string): void {
  const now = Date.now();
  if (status === 'scanning' && now - state.lastEmitAt < 150) {
    return;
  }
  state.lastEmitAt = now;
  post({
    type: 'progress',
    progress: {
      scanId: state.scanId,
      currentPath,
      scannedCount: state.scannedCount,
      skippedCount: state.skippedCount,
      protectedCount: state.protectedCount,
      totalBytes: state.totalBytes,
      status,
      message
    }
  });
}

function toItem(fullPath: string, stats: Awaited<ReturnType<typeof fs.stat>>, kind: 'file' | 'folder', size: number, childrenCount?: number): FileSystemItem {
  const protectedMatch = isProtectedPath(fullPath);
  return {
    id: createStableId(`${fullPath}:${stats.mtimeMs}:${size}`),
    path: fullPath,
    name: path.basename(fullPath),
    kind,
    size,
    modifiedAt: stats.mtime.toISOString(),
    accessedAt: stats.atime.toISOString(),
    depth: path.resolve(fullPath).split(path.sep).filter(Boolean).length,
    extension: kind === 'file' ? path.extname(fullPath).toLowerCase() : undefined,
    childrenCount,
    protected: protectedMatch.protected,
    reasons: protectedMatch.reason ? [protectedMatch.reason] : []
  };
}

async function scanPath(fullPath: string, state: ScanState): Promise<number> {
  const protectedMatch = isProtectedPath(fullPath);
  if (protectedMatch.protected) {
    state.protectedCount += 1;
    state.skippedCount += 1;
    try {
      const stats = await fs.lstat(fullPath);
      state.items.push(toItem(fullPath, stats, stats.isDirectory() ? 'folder' : 'file', stats.isFile() ? stats.size : 0));
    } catch {
      state.items.push({
        id: createStableId(fullPath),
        path: fullPath,
        name: path.basename(fullPath),
        kind: 'folder',
        size: 0,
        modifiedAt: new Date().toISOString(),
        depth: path.resolve(fullPath).split(path.sep).filter(Boolean).length,
        protected: true,
        reasons: [protectedMatch.reason ?? 'Protected path']
      });
    }
    emitProgress(state, fullPath, 'scanning', protectedMatch.reason);
    return 0;
  }

  let stats;
  try {
    stats = await fs.lstat(fullPath);
  } catch (error) {
    state.skippedCount += 1;
    emitProgress(state, fullPath, 'scanning', error instanceof Error ? error.message : 'Unable to read path');
    return 0;
  }

  if (stats.isSymbolicLink()) {
    state.skippedCount += 1;
    emitProgress(state, fullPath, 'scanning', 'Symbolic link skipped');
    return 0;
  }

  if (stats.isFile()) {
    state.scannedCount += 1;
    state.totalBytes += stats.size;
    const item = toItem(fullPath, stats, 'file', stats.size);
    state.items.push(item);
    emitProgress(state, fullPath, 'scanning');
    return stats.size;
  }

  if (!stats.isDirectory()) {
    state.skippedCount += 1;
    return 0;
  }

  let directory;
  try {
    directory = await fs.opendir(fullPath);
  } catch (error) {
    state.skippedCount += 1;
    emitProgress(state, fullPath, 'scanning', error instanceof Error ? error.message : 'Unable to open folder');
    return 0;
  }

  let size = 0;
  let childrenCount = 0;
  for await (const entry of directory) {
    if (entry.isSymbolicLink()) {
      continue;
    }
    childrenCount += 1;
    size += await scanPath(path.join(fullPath, entry.name), state);
    if (state.items.length > request.options.maxItems * 3) {
      state.items.sort((a, b) => b.size - a.size);
      state.items = state.items.slice(0, request.options.maxItems);
    }
  }

  state.scannedCount += 1;
  const item = toItem(fullPath, stats, 'folder', size, childrenCount);
  state.items.push(item);
  emitProgress(state, fullPath, 'scanning');
  return size;
}

async function run(): Promise<void> {
  const state: ScanState = {
    scanId: request.scanId,
    items: [],
    scannedCount: 0,
    skippedCount: 0,
    protectedCount: 0,
    totalBytes: 0,
    startedAt: new Date().toISOString(),
    lastEmitAt: 0
  };

  emitProgress(state, request.roots[0] ?? '', 'started');
  for (const root of request.roots) {
    await scanPath(root, state);
  }

  state.items.sort((a, b) => b.size - a.size);
  state.items = state.items.slice(0, request.options.maxItems);

  post({
    type: 'done',
    summary: {
      scanId: request.scanId,
      roots: request.roots,
      items: state.items,
      totalBytes: state.totalBytes,
      scannedCount: state.scannedCount,
      skippedCount: state.skippedCount,
      protectedCount: state.protectedCount,
      startedAt: state.startedAt,
      finishedAt: new Date().toISOString()
    }
  });
}

run().catch((error: unknown) => {
  post({ type: 'error', message: error instanceof Error ? error.message : 'Scanner failed' });
});
