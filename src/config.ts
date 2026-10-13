import { resolve } from 'node:path';

function int(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const value = Number.parseInt(raw, 10);
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${name} must be a positive integer`);
  return value;
}

export interface Config {
  port: number;
  redisUrl: string;
  workDir: string;
  keepWorkFiles: boolean;
  trivyImage: string;
  trivyCacheVolume: string;
  workerConcurrency: number;
  cloneConcurrency: number;
  jobAttempts: number;
  lockDurationMs: number;
  commandTimeoutMs: number;
  maxCriticals: number;
  batchSize: number;
  scanTtlSeconds: number;
}

export function loadConfig(): Config {
  return {
    port: int('PORT', 3000),
    redisUrl: process.env['REDIS_URL'] ?? 'redis://localhost:6379',
    // absolute on purpose: Docker treats a relative `-v` source as a named volume, not a path
    workDir: resolve(process.env['SCAN_WORK_DIR'] ?? '.scan-work'),
    keepWorkFiles: process.env['KEEP_WORK_FILES'] === 'true',
    trivyImage: process.env['TRIVY_IMAGE'] ?? 'aquasec/trivy:latest',
    trivyCacheVolume: process.env['TRIVY_CACHE_VOLUME'] ?? 'trivy-cache',
    workerConcurrency: int('WORKER_CONCURRENCY', 1),
    cloneConcurrency: int('CLONE_CONCURRENCY', 1),
    jobAttempts: int('JOB_ATTEMPTS', 2),
    lockDurationMs: int('LOCK_DURATION_MS', 60_000),
    commandTimeoutMs: int('COMMAND_TIMEOUT_MS', 15 * 60_000),
    maxCriticals: int('MAX_CRITICALS', 10_000),
    batchSize: int('BATCH_SIZE', 500),
    scanTtlSeconds: int('SCAN_TTL_SECONDS', 24 * 3600),
  };
}
