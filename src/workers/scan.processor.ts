import { mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import type { ScanStore } from '../services/scan.store.js';
import type { ScanJobData } from '../types/scan.js';
import type { CloneRepo } from '../clients/git.client.js';
import type { streamCriticals } from '../services/report-parser.js';
import { REPO_DIR, type RunTrivy } from '../clients/trivy.client.js';

export interface ScanProcessorDeps {
  store: ScanStore;
  cloneRepo: CloneRepo;
  runTrivy: RunTrivy;
  parseReport: typeof streamCriticals;
  workRoot: string;
  /** Debug only: leave the clone and report on disk after the scan. */
  keepWorkFiles?: boolean;
  maxCriticals: number;
  batchSize: number;
}

export type ProcessScan = (job: ScanJobData) => Promise<void>;

/**
 * One scan, start to finish: clone -> Trivy -> stream the report -> store criticals.
 * Throws on any failure (the queue decides about retries and the final Failed status),
 * but always removes the clone and the report, whatever happens.
 */
export function createScanProcessor(deps: ScanProcessorDeps): ProcessScan {
  return async ({ scanId, repoUrl }) => {
    const workDir = join(deps.workRoot, scanId);
    // a re-delivered job (crash, stall) must not see leftovers of the previous attempt
    await rm(workDir, { recursive: true, force: true });
    try {
      await deps.store.setStatus(scanId, 'Scanning');
      await deps.store.resetCriticals(scanId);
      await mkdir(workDir, { recursive: true });

      await deps.cloneRepo(repoUrl, join(workDir, REPO_DIR));
      const reportPath = await deps.runTrivy(scanId, workDir);

      let stored = 0;
      const summary = await deps.parseReport(
        reportPath,
        async (batch) => {
          const room = deps.maxCriticals - stored;
          if (room <= 0) return;
          const accepted = batch.slice(0, room);
          await deps.store.appendCriticals(scanId, accepted);
          stored += accepted.length;
        },
        deps.batchSize,
      );

      await deps.store.setCriticalSummary(scanId, summary.critical, summary.critical > stored);
      await deps.store.setStatus(scanId, 'Finished');
    } finally {
      if (!deps.keepWorkFiles) await rm(workDir, { recursive: true, force: true });
    }
  };
}
