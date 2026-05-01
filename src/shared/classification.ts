import path from 'node:path';
import type { Classification, ClassificationOptions, FileSystemItem } from './types.js';

const ARCHIVE_EXTENSIONS = new Set(['.zip', '.rar', '.7z', '.tar', '.gz', '.tgz', '.iso', '.dmg']);
const LOG_EXTENSIONS = new Set(['.log', '.tmp', '.temp']);
const OFFLOAD_EXTENSIONS = new Set(['.mp4', '.mov', '.mkv', '.avi', '.psd', '.ai', '.fig', '.sketch', '.wav', '.flac']);
const BUILD_FOLDER_NAMES = new Set(['node_modules', 'dist', 'build', 'out', '.cache', 'coverage', '.turbo', '.next']);
const TARGET_FOLDER_NAMES = new Set(['downloads', 'videos', 'archives', 'projects', 'temp', 'logs']);

const daysSince = (isoDate: string): number => {
  const time = new Date(isoDate).getTime();
  if (Number.isNaN(time)) {
    return 0;
  }
  return (Date.now() - time) / 86_400_000;
};

const basenameLower = (itemPath: string): string => path.basename(itemPath).toLowerCase();

export function classifyItem(item: FileSystemItem, options: ClassificationOptions): Classification {
  const ruleIds: string[] = [];
  const ageDays = daysSince(item.modifiedAt);
  const extension = (item.extension ?? '').toLowerCase();
  const name = basenameLower(item.path);
  const pathLower = item.path.toLowerCase();

  if (item.protected) {
    return {
      itemId: item.id,
      kind: 'protected_do_not_touch',
      riskScore: 100,
      reason: item.reasons[0] ?? 'Protected path',
      ruleIds: ['protected-path']
    };
  }

  if (item.size < options.minCandidateBytes) {
    return {
      itemId: item.id,
      kind: 'review_manually',
      riskScore: 55,
      reason: 'Below the configured MVP candidate size threshold',
      ruleIds: ['small-item-review']
    };
  }

  if (item.kind === 'folder' && BUILD_FOLDER_NAMES.has(name)) {
    ruleIds.push('generated-build-folder');
    return {
      itemId: item.id,
      kind: 'safe_delete',
      riskScore: 18,
      reason: `${item.name} is commonly reproducible generated dependency/build output`,
      ruleIds
    };
  }

  if (LOG_EXTENSIONS.has(extension) || name === 'logs' || pathLower.includes('\\temp') || pathLower.includes('/temp')) {
    ruleIds.push('temporary-or-log-file');
    return {
      itemId: item.id,
      kind: ageDays >= 7 ? 'safe_delete' : 'review_manually',
      riskScore: ageDays >= 7 ? 22 : 58,
      reason: ageDays >= 7 ? 'Old temporary/log artifact' : 'Recent temporary/log artifact needs review',
      ruleIds
    };
  }

  if (ARCHIVE_EXTENSIONS.has(extension) && ageDays >= options.oldFileDays) {
    ruleIds.push('old-archive');
    return {
      itemId: item.id,
      kind: 'safe_offload',
      riskScore: 30,
      reason: 'Old archive file is a strong Drive offload candidate',
      ruleIds
    };
  }

  if (OFFLOAD_EXTENSIONS.has(extension) || [...TARGET_FOLDER_NAMES].some((folderName) => pathLower.includes(folderName))) {
    ruleIds.push('large-user-content');
    return {
      itemId: item.id,
      kind: 'safe_offload',
      riskScore: 35,
      reason: 'Large user content should be offloaded before any local cleanup',
      ruleIds
    };
  }

  return {
    itemId: item.id,
    kind: 'review_manually',
    riskScore: 65,
    reason: 'No deterministic safe-delete/offload rule matched',
    ruleIds: ['default-review']
  };
}

export function classifyItems(items: FileSystemItem[], options: ClassificationOptions): Classification[] {
  return items.map((item) => classifyItem(item, options));
}
