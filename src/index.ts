import { Redis } from 'ioredis';
import { createApp } from './app.js';
import { loadConfig } from './config.js';
import { createScanQueue } from './queue/scan.queue.js';
import { startScanWorker } from './workers/scan.worker.js';
import { RedisScanStore } from './services/redis-scan.store.js';
import { ScanService } from './services/scan.service.js';
import { emptyDir } from './utils/empty-dir.js';
import { createSemaphore } from './utils/semaphore.js';
import { createGitClone } from './clients/git.client.js';
import { streamCriticals } from './services/report-parser.js';
import { createScanProcessor } from './workers/scan.processor.js';
import { createTrivyRunner } from './clients/trivy.client.js';

const config = loadConfig();

// a hard crash skips `finally`: whatever is left in the work dir belongs to a dead process
await emptyDir(config.workDir);

const redis = new Redis(config.redisUrl);
redis.on('error', (err) => console.error('[redis]', err.message));

const store = new RedisScanStore(redis, config.scanTtlSeconds);
const queue = createScanQueue(config);
const service = new ScanService(store, queue);

// git clone is the memory-heavy step and runs inside this process's container, so clones take turns
// even when several workers run scans at once. The rest of the pipeline still overlaps.
const cloneGate = createSemaphore(config.cloneConcurrency);
const gitClone = createGitClone(config.commandTimeoutMs);

const processor = createScanProcessor({
  store,
  cloneRepo: (repoUrl, destination) => cloneGate.run(() => gitClone(repoUrl, destination)),
  runTrivy: createTrivyRunner({
    image: config.trivyImage,
    cacheVolume: config.trivyCacheVolume,
    timeoutMs: config.commandTimeoutMs,
  }),
  parseReport: streamCriticals,
  workRoot: config.workDir,
  keepWorkFiles: config.keepWorkFiles,
  maxCriticals: config.maxCriticals,
  batchSize: config.batchSize,
});
const worker = startScanWorker(config, store, processor);

const server = createApp(service).listen(config.port, () => {
  console.log(`code-guardian listening on :${config.port}`);
});

let stopping = false;
async function shutdown(signal: string): Promise<void> {
  if (stopping) return;
  stopping = true;
  console.log(`${signal} received, shutting down`);
  server.close();
  // closing the worker waits for the active job; stalled-job recovery covers a forced kill
  await worker.close();
  await queue.close();
  redis.disconnect();
  process.exit(0);
}
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
