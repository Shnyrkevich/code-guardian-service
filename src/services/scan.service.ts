import { randomUUID } from 'node:crypto';
import type { CriticalVulnerability, Scan, ScanJobQueue } from '../types/scan.js';
import type { ScanStore } from './scan.store.js';

export interface ScanDetails {
  scan: Scan;
  /** Present only once the scan is Finished. */
  criticalVulnerabilities?: CriticalVulnerability[];
}

export class ScanService {
  constructor(
    private readonly store: ScanStore,
    private readonly queue: ScanJobQueue,
  ) {}

  async enqueue(repoUrl: string): Promise<Scan> {
    const now = new Date().toISOString();
    const scan: Scan = {
      id: randomUUID(),
      repoUrl,
      status: 'Queued',
      criticalCount: 0,
      truncated: false,
      createdAt: now,
      updatedAt: now,
    };
    // store first: once the job exists a worker may start immediately and expects the scan record
    await this.store.create(scan);
    try {
      await this.queue.add({ scanId: scan.id, repoUrl });
    } catch (err) {
      await this.store.setStatus(scan.id, 'Failed', 'Could not enqueue scan');
      throw err;
    }
    return scan;
  }

  /** The scan record only; never touches the (potentially large) criticals list. */
  getScan(id: string): Promise<Scan | null> {
    return this.store.get(id);
  }

  /** One page of criticals. Empty unless the scan is Finished, so a half-written list is never exposed. */
  async getCriticals(scan: Scan, offset: number, limit: number): Promise<CriticalVulnerability[]> {
    if (scan.status !== 'Finished') return [];
    return this.store.getCriticals(scan.id, offset, limit);
  }

  async get(id: string, offset: number, limit: number): Promise<ScanDetails | null> {
    const scan = await this.getScan(id);
    if (!scan) return null;
    if (scan.status !== 'Finished') return { scan };
    return { scan, criticalVulnerabilities: await this.getCriticals(scan, offset, limit) };
  }
}
