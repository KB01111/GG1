import path from 'node:path';
import os from 'node:os';
import type { ProtectedPathMatch } from './types.js';

const WINDOWS_SYSTEM_PREFIXES = [
  'c:\\windows',
  'c:\\program files',
  'c:\\program files (x86)',
  'c:\\programdata\\microsoft\\windows',
  'c:\\users\\all users\\microsoft\\windows'
];

const SENSITIVE_SEGMENTS = [
  'appdata\\local\\google\\chrome\\user data',
  'appdata\\roaming\\mozilla\\firefox\\profiles',
  'appdata\\local\\microsoft\\edge\\user data',
  'appdata\\roaming\\microsoft\\credentials',
  'appdata\\roaming\\microsoft\\protect',
  'appdata\\local\\microsoft\\vault',
  '.ssh',
  '.gnupg',
  '.aws',
  '.azure',
  '.config\\gcloud',
  'keychains',
  'passwords',
  'credentials'
];

const ACTIVE_CONFIG_SEGMENTS = [
  'appdata\\roaming',
  'appdata\\local\\packages',
  'library/application support',
  '.config'
];

const normalizeForPolicy = (inputPath: string): string => inputPath.replace(/\//g, '\\').toLowerCase();

export function isProtectedPath(inputPath: string): ProtectedPathMatch {
  const normalized = normalizeForPolicy(path.resolve(inputPath));
  const home = normalizeForPolicy(os.homedir());
  const segments = normalized.split(/[\\/]+/).filter(Boolean);

  for (const prefix of WINDOWS_SYSTEM_PREFIXES) {
    if (normalized === prefix || normalized.startsWith(`${prefix}\\`)) {
      return { protected: true, reason: 'Windows system or program installation path' };
    }
  }

  for (const sensitiveSegment of SENSITIVE_SEGMENTS) {
    const sensitiveSegments = sensitiveSegment.split(/[\\/]+/).filter(Boolean);
    let match = true;
    for (let i = 0; i < sensitiveSegments.length; i++) {
      const found = segments.includes(sensitiveSegments[i]);
      if (!found) {
        match = false;
        break;
      }
    }
    if (match) {
      return { protected: true, reason: 'Browser profile, credential store, or secret-bearing folder' };
    }
  }

  for (const configSegment of ACTIVE_CONFIG_SEGMENTS) {
    const configSegments = configSegment.split(/[\\/]+/).filter(Boolean);
    let match = true;
    for (let i = 0; i < configSegments.length; i++) {
      const found = segments.includes(configSegments[i]);
      if (!found) {
        match = false;
        break;
      }
    }
    if (match && !segments.includes('temp')) {
      return { protected: true, reason: 'Active application configuration folder' };
    }
  }

  if (process.platform !== 'win32') {
    const unixSystemRoots = ['/bin', '/boot', '/dev', '/etc', '/lib', '/proc', '/root', '/sbin', '/sys', '/usr'];
    const resolved = path.resolve(inputPath);
    if (unixSystemRoots.some((prefix) => resolved === prefix || resolved.startsWith(`${prefix}/`))) {
      return { protected: true, reason: 'System folder' };
    }
  }

  if (normalized === home) {
    return { protected: true, reason: 'Home folder root must be narrowed before scanning' };
  }

  return { protected: false };
}
