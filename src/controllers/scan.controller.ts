import type { Request, Response } from 'express';
import type { ScanService } from '../services/scan.service.js';
import { normalizeGithubUrl } from '../utils/repo-url.js';

const DEFAULT_LIMIT = 1000;
const MAX_LIMIT = 5000;

function intParam(value: unknown, fallback: number, max: number): number {
  if (typeof value !== 'string') return fallback;
  const n = Number.parseInt(value, 10);
  return Number.isInteger(n) && n >= 0 ? Math.min(n, max) : fallback;
}

export class ScanController {
  constructor(private readonly service: ScanService) {}

  create = async (req: Request, res: Response): Promise<void> => {
    const body: unknown = req.body;
    const input = typeof body === 'object' && body !== null ? (body as Record<string, unknown>)['repoUrl'] : undefined;
    const repoUrl = normalizeGithubUrl(input);
    if (repoUrl === null) {
      res.status(400).json({ error: 'repoUrl must be a https://github.com/<owner>/<repo> URL' });
      return;
    }
    const scan = await this.service.enqueue(repoUrl);
    res.status(202).json({ scanId: scan.id, status: scan.status });
  };

  get = async (req: Request, res: Response): Promise<void> => {
    const id = req.params['scanId'];
    const offset = intParam(req.query['offset'], 0, Number.MAX_SAFE_INTEGER);
    const limit = Math.max(1, intParam(req.query['limit'], DEFAULT_LIMIT, MAX_LIMIT));
    const details = typeof id === 'string' ? await this.service.get(id, offset, limit) : null;
    if (!details) {
      res.status(404).json({ error: 'Scan not found' });
      return;
    }
    const { scan, criticalVulnerabilities } = details;
    res.json({
      id: scan.id,
      status: scan.status,
      repoUrl: scan.repoUrl,
      ...(scan.error ? { error: scan.error } : {}),
      ...(criticalVulnerabilities
        ? {
            criticalCount: scan.criticalCount,
            truncated: scan.truncated,
            offset,
            limit,
            criticalVulnerabilities,
          }
        : {}),
    });
  };
}
