import { GraphQLError } from 'graphql';
import { QueueUnavailableError } from '../queue/scan.queue.js';
import type { ScanService } from '../services/scan.service.js';
import type { CriticalVulnerability, Scan } from '../types/scan.js';
import { normalizeGithubUrl } from '../utils/repo-url.js';

const MAX_LIMIT = 5000;

interface PageArgs {
  limit?: number | null;
  offset?: number | null;
}

/**
 * Source object for the `Scan` type. graphql-js resolves each field from the property of the same
 * name, calling it (with the field arguments) when it is a method. That keeps the criticals lazy:
 * Redis is read only if a query actually selects `criticalVulnerabilities`.
 */
class ScanNode {
  constructor(
    private readonly scan: Scan,
    private readonly service: ScanService,
  ) {}

  get id(): string { return this.scan.id; }
  get status(): string { return this.scan.status; }
  get repoUrl(): string { return this.scan.repoUrl; }
  get error(): string | null { return this.scan.error ?? null; }
  get criticalCount(): number { return this.scan.criticalCount; }
  get truncated(): boolean { return this.scan.truncated; }

  async criticalVulnerabilities({ limit, offset }: PageArgs): Promise<CriticalVulnerability[] | null> {
    if (this.scan.status !== 'Finished') return null;
    const pageSize = Math.min(Math.max(limit ?? 1000, 1), MAX_LIMIT);
    return guard(() => this.service.getCriticals(this.scan, Math.max(offset ?? 0, 0), pageSize));
  }
}

/** Expected failures get a stable error code; anything else is logged and hidden from the client. */
async function guard<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (err) {
    if (err instanceof GraphQLError) throw err;
    if (err instanceof QueueUnavailableError) {
      throw new GraphQLError('Service temporarily unavailable, try again later', {
        extensions: { code: 'SERVICE_UNAVAILABLE' },
      });
    }
    console.error('[graphql]', err);
    throw new GraphQLError('Internal server error', { extensions: { code: 'INTERNAL_SERVER_ERROR' } });
  }
}

export interface RootValue {
  scan(args: { id: string }): Promise<ScanNode | null>;
  startScan(args: { repoUrl: string }): Promise<ScanNode>;
}

export function createRootValue(service: ScanService): RootValue {
  return {
    scan: ({ id }) =>
      guard(async () => {
        const scan = await service.getScan(id);
        return scan ? new ScanNode(scan, service) : null;
      }),

    startScan: ({ repoUrl }) =>
      guard(async () => {
        const normalized = normalizeGithubUrl(repoUrl);
        if (normalized === null) {
          throw new GraphQLError('repoUrl must be a https://github.com/<owner>/<repo> URL', {
            extensions: { code: 'BAD_USER_INPUT' },
          });
        }
        return new ScanNode(await service.enqueue(normalized), service);
      }),
  };
}
