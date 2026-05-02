import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { ManifestEntry } from '../shared/types.js';

export class ManifestStore {
  private readonly manifestPath: string;
  private writeQueue = Promise.resolve();

  constructor(userDataPath: string) {
    this.manifestPath = path.join(userDataPath, 'manifest.json');
  }

  async list(): Promise<ManifestEntry[]> {
    try {
      const raw = await fs.readFile(this.manifestPath, 'utf8');
      const parsed = JSON.parse(raw) as ManifestEntry[];
      return Array.isArray(parsed) ? parsed : [];
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') {
        return [];
      }
      throw e;
    }
  }

  async add(entry: ManifestEntry): Promise<void> {
    await this.write(async (entries) => [...entries.filter((item) => item.id !== entry.id), entry]);
  }

  async update(id: string, patch: Partial<ManifestEntry>): Promise<void> {
    await this.write(async (entries) => entries.map((entry) => (entry.id === id ? { ...entry, ...patch } : entry)));
  }

  async findByOriginalPath(originalPath: string): Promise<ManifestEntry | undefined> {
    const entries = await this.list();
    return entries.find((entry) => entry.originalPath === originalPath);
  }

  private async write(update: (entries: ManifestEntry[]) => Promise<ManifestEntry[]> | ManifestEntry[]): Promise<void> {
    this.writeQueue = this.writeQueue.then(async () => {
      try {
        const entries = await this.list();
        const nextEntries = await update(entries);
        await fs.mkdir(path.dirname(this.manifestPath), { recursive: true });
        const tempPath = `${this.manifestPath}.tmp`;
        await fs.writeFile(tempPath, JSON.stringify(nextEntries, null, 2));
        await fs.rename(tempPath, this.manifestPath);
      } catch (error) {
        console.error('Manifest write failed:', error);
      }
    });
    await this.writeQueue;
  }
}
