export const SCAN_STATUSES = ['Queued', 'Scanning', 'Finished', 'Failed'] as const;
export type ScanStatus = (typeof SCAN_STATUSES)[number];

export interface Scan {
  id: string;
  repoUrl: string;
  status: ScanStatus;
  error?: string;
  criticalCount: number;
  truncated: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CriticalVulnerability {
  id: string;
  pkgName: string;
  installedVersion: string;
  fixedVersion?: string;
  severity: 'CRITICAL';
  title?: string;
  primaryUrl?: string;
}

export interface ScanJobData {
  scanId: string;
  repoUrl: string;
}

export interface ScanJobQueue {
  add(data: ScanJobData): Promise<void>;
}
