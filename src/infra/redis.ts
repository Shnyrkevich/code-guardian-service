import type { ConnectionOptions } from 'bullmq';

/** BullMQ takes plain connection options so it can manage its own ioredis connections. */
export function toBullConnection(redisUrl: string, overrides: Partial<ConnectionOptions> = {}): ConnectionOptions {
  const url = new URL(redisUrl);
  return {
    host: url.hostname,
    port: url.port ? Number(url.port) : 6379,
    ...(url.password ? { password: decodeURIComponent(url.password) } : {}),
    ...(url.pathname.length > 1 ? { db: Number(url.pathname.slice(1)) } : {}),
    ...overrides,
  } as ConnectionOptions;
}
