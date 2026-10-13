import type { Redis } from 'ioredis';
import { SCAN_STATUSES, type CriticalVulnerability, type Scan, type ScanStatus } from '../types/scan.js';
import type { ScanStore } from './scan.store.js';

const scanKey = (id: string): string => `scan:${id}`;
const criticalsKey = (id: string): string => `scan:${id}:criticals`;

function isStatus(value: string | undefined): value is ScanStatus {
  return SCAN_STATUSES.some((s) => s === value);
}

export class RedisScanStore implements ScanStore {
  constructor(
    private readonly redis: Redis,
    private readonly ttlSeconds: number,
  ) {}

  async create(scan: Scan): Promise<void> {
    const fields: Record<string, string> = {
      id: scan.id,
      repoUrl: scan.repoUrl,
      status: scan.status,
      criticalCount: String(scan.criticalCount),
      truncated: String(scan.truncated),
      createdAt: scan.createdAt,
      updatedAt: scan.updatedAt,
    };
    await this.redis.multi().hset(scanKey(scan.id), fields).expire(scanKey(scan.id), this.ttlSeconds).exec();
  }

  async get(id: string): Promise<Scan | null> {
    const h = await this.redis.hgetall(scanKey(id));
    if (!isStatus(h['status']) || h['id'] === undefined || h['repoUrl'] === undefined) return null;
    return {
      id: h['id'],
      repoUrl: h['repoUrl'],
      status: h['status'],
      ...(h['error'] ? { error: h['error'] } : {}),
      criticalCount: Number(h['criticalCount'] ?? 0),
      truncated: h['truncated'] === 'true',
      createdAt: h['createdAt'] ?? '',
      updatedAt: h['updatedAt'] ?? '',
    };
  }

  async setStatus(id: string, status: ScanStatus, error?: string): Promise<void> {
    const tx = this.redis.multi().hset(scanKey(id), { status, updatedAt: new Date().toISOString() });
    if (error === undefined) tx.hdel(scanKey(id), 'error');
    else tx.hset(scanKey(id), 'error', error.slice(0, 2000));
    await tx.exec();
  }

  async resetCriticals(id: string): Promise<void> {
    await this.redis
      .multi()
      .del(criticalsKey(id))
      .hset(scanKey(id), { criticalCount: '0', truncated: 'false' })
      .exec();
  }

  async appendCriticals(id: string, items: CriticalVulnerability[]): Promise<void> {
    if (items.length === 0) return;
    await this.redis
      .multi()
      .rpush(criticalsKey(id), ...items.map((i) => JSON.stringify(i)))
      .expire(criticalsKey(id), this.ttlSeconds)
      .exec();
  }

  async setCriticalSummary(id: string, count: number, truncated: boolean): Promise<void> {
    await this.redis.hset(scanKey(id), { criticalCount: String(count), truncated: String(truncated) });
  }

  async getCriticals(id: string, offset: number, limit: number): Promise<CriticalVulnerability[]> {
    const raw = await this.redis.lrange(criticalsKey(id), offset, offset + limit - 1);
    return raw.map((r) => JSON.parse(r) as CriticalVulnerability);
  }
}
