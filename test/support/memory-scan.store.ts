import type { ScanStore } from '../../src/services/scan.store.js';
import type { CriticalVulnerability, Scan, ScanStatus } from '../../src/types/scan.js';

/** Test double for ScanStore; records the order of status changes. */
export class MemoryScanStore implements ScanStore {
  readonly scans = new Map<string, Scan>();
  readonly criticals = new Map<string, CriticalVulnerability[]>();
  readonly statusHistory: ScanStatus[] = [];

  async create(scan: Scan): Promise<void> {
    this.scans.set(scan.id, { ...scan });
    this.criticals.set(scan.id, []);
  }
  async get(id: string): Promise<Scan | null> {
    return this.scans.get(id) ?? null;
  }
  async setStatus(id: string, status: ScanStatus, error?: string): Promise<void> {
    const scan = this.scans.get(id);
    if (!scan) return;
    this.statusHistory.push(status);
    const { error: _old, ...rest } = scan;
    this.scans.set(id, { ...rest, status, ...(error === undefined ? {} : { error }) });
  }
  async resetCriticals(id: string): Promise<void> {
    this.criticals.set(id, []);
  }
  async appendCriticals(id: string, items: CriticalVulnerability[]): Promise<void> {
    this.criticals.get(id)?.push(...items);
  }
  async setCriticalSummary(id: string, count: number, truncated: boolean): Promise<void> {
    const scan = this.scans.get(id);
    if (scan) this.scans.set(id, { ...scan, criticalCount: count, truncated });
  }
  async getCriticals(id: string, offset: number, limit: number): Promise<CriticalVulnerability[]> {
    return (this.criticals.get(id) ?? []).slice(offset, offset + limit);
  }
}
