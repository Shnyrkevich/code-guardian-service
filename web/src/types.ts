export type ScanStatus = 'Queued' | 'Scanning' | 'Finished' | 'Failed';

export interface Vulnerability {
  id: string;
  pkgName: string;
  installedVersion: string;
  fixedVersion: string | null;
  title: string | null;
  primaryUrl: string | null;
}

export interface Scan {
  id: string;
  status: ScanStatus;
  repoUrl: string;
  error: string | null;
  criticalCount: number;
  truncated: boolean;
  /** Null until the scan is Finished. */
  criticalVulnerabilities: Vulnerability[] | null;
}
