import type { StorageCleanerApi } from '../shared/types';

declare global {
  interface Window {
    storageCleaner: StorageCleanerApi;
  }
}

export {};
