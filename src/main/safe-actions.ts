import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createStableId } from '../shared/manifest.js';
import { isProtectedPath } from '../shared/protected-paths.js';
import type { DeletionPlan, DestructiveApproval, LocalActionResult, ManifestEntry, RestoreResult } from '../shared/types.js';
import type { DriveService } from './drive-service.js';
import type { ManifestStore } from './manifest-store.js';

const APPROVAL_PHRASE = 'DELETE VERIFIED LOCAL COPIES';

export class SafeActionsService {
  private readonly quarantineRoot: string;

  constructor(private readonly manifest: ManifestStore, private readonly drive: DriveService, userDataPath: string) {
    this.quarantineRoot = path.join(userDataPath, 'quarantine');
  }

  async planDeletion(entries: ManifestEntry[], dryRun = true): Promise<DeletionPlan> {
    const refused: DeletionPlan['refused'] = [];
    const approved: ManifestEntry[] = [];

    for (const entry of entries) {
      const protectedMatch = isProtectedPath(entry.originalPath);
      if (protectedMatch.protected) {
        refused.push({ entry, reason: protectedMatch.reason ?? 'Protected path' });
        continue;
      }
      if (entry.verification.status !== 'verified' || !entry.verification.sizeMatches) {
        refused.push({ entry, reason: 'Upload has not been verified' });
        continue;
      }
      approved.push(entry);
    }

    return { dryRun, entries: approved, refused, approvalPhrase: APPROVAL_PHRASE };
  }

  async quarantine(entries: ManifestEntry[]): Promise<LocalActionResult[]> {
    const results: LocalActionResult[] = [];
    await fs.mkdir(this.quarantineRoot, { recursive: true });

    for (const entry of entries) {
      const plan = await this.planDeletion([entry], false);
      if (plan.refused.length > 0) {
        results.push({ entryId: entry.id, action: 'quarantined', path: entry.originalPath, success: false, message: plan.refused[0].reason });
        continue;
      }

      const destination = path.join(this.quarantineRoot, `${createStableId(entry.originalPath)}-${path.basename(entry.originalPath)}`);
      try {
        await fs.rename(entry.originalPath, destination);
        await this.manifest.update(entry.id, { actionTaken: 'quarantined', localActionAt: new Date().toISOString(), restorePath: destination });
        results.push({ entryId: entry.id, action: 'quarantined', path: destination, success: true, message: 'Moved to app quarantine' });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'EXDEV') {
          try {
            await fs.copyFile(entry.originalPath, destination);
            await fs.unlink(entry.originalPath);
            await this.manifest.update(entry.id, { actionTaken: 'quarantined', localActionAt: new Date().toISOString(), restorePath: destination });
            results.push({ entryId: entry.id, action: 'quarantined', path: destination, success: true, message: 'Moved to app quarantine' });
          } catch (copyError) {
            results.push({ entryId: entry.id, action: 'quarantined', path: entry.originalPath, success: false, message: copyError instanceof Error ? copyError.message : 'Quarantine failed' });
          }
        } else {
          results.push({ entryId: entry.id, action: 'quarantined', path: entry.originalPath, success: false, message: error instanceof Error ? error.message : 'Quarantine failed' });
        }
      }
    }

    return results;
  }

  async deleteVerified(entries: ManifestEntry[], approval: DestructiveApproval): Promise<LocalActionResult[]> {
    const plan = await this.planDeletion(entries, approval.dryRun);
    const approvedIds = new Set(approval.approvedEntryIds);
    const results: LocalActionResult[] = plan.refused.map(({ entry, reason }) => ({ entryId: entry.id, action: 'deleted', path: entry.originalPath, success: false, message: reason }));

    if (approval.dryRun) {
      return [...results, ...plan.entries.map((entry) => ({ entryId: entry.id, action: 'deleted' as const, path: entry.originalPath, success: true, message: 'Dry run: no files deleted' }))];
    }

    if (approval.phrase !== APPROVAL_PHRASE) {
      throw new Error(`Type ${APPROVAL_PHRASE} to approve deletion`);
    }

    for (const entry of plan.entries) {
      if (!approvedIds.has(entry.id)) {
        results.push({ entryId: entry.id, action: 'deleted', path: entry.originalPath, success: false, message: 'Entry was not explicitly selected for deletion' });
        continue;
      }
      try {
        await fs.rm(entry.originalPath, { recursive: true, force: false });
        await this.manifest.update(entry.id, { actionTaken: 'deleted', localActionAt: new Date().toISOString() });
        results.push({ entryId: entry.id, action: 'deleted', path: entry.originalPath, success: true, message: 'Deleted verified local copy' });
      } catch (error) {
        results.push({ entryId: entry.id, action: 'deleted', path: entry.originalPath, success: false, message: error instanceof Error ? error.message : 'Deletion failed' });
      }
    }

    return results;
  }

  async restore(entry: ManifestEntry, destinationPath: string): Promise<RestoreResult> {
    const protectedMatch = isProtectedPath(destinationPath);
    if (protectedMatch.protected) {
      return { entryId: entry.id, destinationPath, success: false, message: `Cannot restore to protected path: ${protectedMatch.reason}` };
    }

    try {
      await fs.access(destinationPath);
      return { entryId: entry.id, destinationPath, success: false, message: 'Destination file already exists. Remove it or provide an explicit overwrite flag.' };
    } catch {
      // File doesn't exist, proceed
    }

    try {
      await this.drive.downloadFile(entry, destinationPath, () => undefined);
      await this.manifest.update(entry.id, { actionTaken: 'restored', restorePath: destinationPath, localActionAt: new Date().toISOString() });
      return { entryId: entry.id, destinationPath, success: true, message: 'Restored from Google Drive manifest entry' };
    } catch (error) {
      return { entryId: entry.id, destinationPath, success: false, message: error instanceof Error ? error.message : 'Restore failed' };
    }
  }
}
