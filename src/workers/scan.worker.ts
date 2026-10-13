import { UnrecoverableError, Worker, type Job } from 'bullmq';
import type { Config } from '../config.js';
import { toBullConnection } from '../infra/redis.js';
import type { ScanStore } from '../services/scan.store.js';
import type { ScanJobData } from '../types/scan.js';
import { ReportParseError } from '../services/report-parser.js';
import type { ProcessScan } from './scan.processor.js';
import { SCAN_QUEUE } from '../queue/scan.queue.js';

export interface ScanWorkerHost {
  close(): Promise<void>;
}

export interface FailureContext {
  store: ScanStore;
  maxAttempts: number;
}

/** Marks the scan Failed only when BullMQ will not retry it any more. */
export async function handleJobFailure(
  ctx: FailureContext,
  job: Pick<ScanJobData, 'scanId'> & { attemptsMade: number; unrecoverable: boolean },
  error: Error,
): Promise<void> {
  const exhausted = job.unrecoverable || job.attemptsMade >= ctx.maxAttempts;
  if (exhausted) await ctx.store.setStatus(job.scanId, 'Failed', error.message);
}

export function startScanWorker(config: Config, store: ScanStore, process: ProcessScan): ScanWorkerHost {
  const worker = new Worker<ScanJobData>(
    SCAN_QUEUE,
    async (job: Job<ScanJobData>) => {
      try {
        await process(job.data);
      } catch (err) {
        // a corrupt report will not get better on retry
        if (err instanceof ReportParseError) throw new UnrecoverableError(err.message);
        throw err;
      }
    },
    {
      // maxRetriesPerRequest: null is required by BullMQ for blocking worker connections
      connection: toBullConnection(config.redisUrl, { maxRetriesPerRequest: null }),
      concurrency: config.workerConcurrency,
      // scans run for minutes; BullMQ renews the lock while the event loop is free
      lockDuration: config.lockDurationMs,
      maxStalledCount: 2,
    },
  );

  worker.on('failed', (job, err) => {
    if (!job) return;
    console.error(`[worker] scan ${job.data.scanId} attempt ${job.attemptsMade} failed:`, err.message);
    handleJobFailure(
      { store, maxAttempts: config.jobAttempts },
      { scanId: job.data.scanId, attemptsMade: job.attemptsMade, unrecoverable: err instanceof UnrecoverableError },
      err,
    ).catch((e: unknown) => console.error('[worker] could not record failure', e));
  });
  worker.on('error', (err) => console.error('[worker]', err.message));

  return { close: () => worker.close() };
}
