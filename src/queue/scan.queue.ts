import { Queue } from 'bullmq';
import type { Config } from '../config.js';
import { toBullConnection } from '../infra/redis.js';
import type { ScanJobData, ScanJobQueue } from '../types/scan.js';

export const SCAN_QUEUE = 'scan';

export class QueueUnavailableError extends Error {
  constructor(options?: ErrorOptions) {
    super('Job queue is unavailable', options);
    this.name = 'QueueUnavailableError';
  }
}

export interface BullScanQueue extends ScanJobQueue {
  close(): Promise<void>;
}

export function createScanQueue(config: Config): BullScanQueue {
  // fail fast instead of buffering commands while Redis is down, so POST can answer 503
  const queue = new Queue<ScanJobData>(SCAN_QUEUE, {
    connection: toBullConnection(config.redisUrl, { enableOfflineQueue: false }),
    defaultJobOptions: {
      attempts: config.jobAttempts,
      backoff: { type: 'exponential', delay: 2000 },
      removeOnComplete: { age: config.scanTtlSeconds },
      removeOnFail: { age: config.scanTtlSeconds },
    },
  });
  // keep a Redis outage from becoming an unhandled 'error' event
  queue.on('error', (err) => console.error('[queue]', err.message));

  return {
    async add(data) {
      try {
        // jobId = scanId keeps the job addressable and de-duplicates accidental double adds
        await queue.add('scan', data, { jobId: data.scanId });
      } catch (err) {
        throw new QueueUnavailableError({ cause: err });
      }
    },
    close: () => queue.close(),
  };
}
