import { EventEmitter } from 'node:events';
import path from 'node:path';
import { Worker } from 'node:worker_threads';
import { classifyItems } from '../shared/classification.js';
import type { ScanProgress, ScanRequest, ScanSummary, ScannerWorkerEvent } from '../shared/types.js';

export class ScannerService extends EventEmitter {
  private activeWorkers = new Map<string, Worker>();

  scan(request: ScanRequest): Promise<ScanSummary> {
    const scanId = `scan-${Date.now()}`;
    const workerPath = path.join(__dirname, 'workers', 'scanner.worker.js');
    const worker = new Worker(workerPath, {
      workerData: {
        scanId,
        roots: request.roots,
        options: request.options
      }
    });

    this.activeWorkers.set(scanId, worker);

    return new Promise((resolve, reject) => {
      worker.on('message', (event: ScannerWorkerEvent) => {
        if (event.type === 'progress') {
          this.emit('progress', event.progress);
          return;
        }

        if (event.type === 'done') {
          const classifications = classifyItems(event.summary.items, {
            oldFileDays: request.options.oldFileDays,
            minCandidateBytes: request.options.minCandidateBytes
          });
          const summary: ScanSummary = { ...event.summary, classifications };
          this.activeWorkers.delete(scanId);
          resolve(summary);
          return;
        }

        this.activeWorkers.delete(scanId);
        reject(new Error(event.message));
      });

      worker.on('error', (error) => {
        this.activeWorkers.delete(scanId);
        reject(error);
      });

      worker.on('exit', (code) => {
        this.activeWorkers.delete(scanId);
        if (code !== 0) {
          reject(new Error(`Scanner worker exited with code ${code}`));
        }
      });
    });
  }

  cancel(scanId: string): void {
    const worker = this.activeWorkers.get(scanId);
    if (!worker) {
      return;
    }
    worker.terminate().catch(() => undefined);
    this.activeWorkers.delete(scanId);
    const progress: ScanProgress = {
      scanId,
      scannedCount: 0,
      skippedCount: 0,
      protectedCount: 0,
      totalBytes: 0,
      status: 'cancelled'
    };
    this.emit('progress', progress);
  }
}
