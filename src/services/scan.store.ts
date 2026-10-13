import type { CriticalVulnerability, Scan, ScanStatus } from '../types/scan.js';

export interface ScanStore {
  create(scan: Scan): Promise<void>;
  get(id: string): Promise<Scan | null>;
  setStatus(id: string, status: ScanStatus, error?: string): Promise<void>;
  /** Drops previously stored criticals so a re-delivered job starts clean. */
  resetCriticals(id: string): Promise<void>;
  appendCriticals(id: string, items: CriticalVulnerability[]): Promise<void>;
  /** Records the final counters once streaming is done. */
  setCriticalSummary(id: string, count: number, truncated: boolean): Promise<void>;
  getCriticals(id: string, offset: number, limit: number): Promise<CriticalVulnerability[]>;
}
