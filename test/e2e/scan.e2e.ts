import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';

/**
 * Needs Redis (REDIS_URL, default localhost:6379), Docker with aquasec/trivy, and network access.
 * Runs the built app (dist/index.js) as a child process with the production 150MB heap limit.
 */
const PORT = 3999;
const BASE = `http://localhost:${PORT}`;
const REPO = 'https://github.com/Shnyrkevich/NodeGoat';

interface ScanResponse {
  id: string;
  status: string;
  error?: string;
  criticalCount?: number;
  criticalVulnerabilities?: { id: string; severity: string }[];
}

async function post(body: unknown): Promise<Response> {
  return fetch(`${BASE}/api/scan`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function waitFor(scanId: string, done: (s: ScanResponse) => boolean, timeoutMs = 120_000): Promise<ScanResponse> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const s = (await (await fetch(`${BASE}/api/scan/${scanId}`)).json()) as ScanResponse;
    if (done(s)) return s;
    if (Date.now() > deadline) throw new Error(`timed out, last status ${s.status}`);
    await new Promise((r) => setTimeout(r, 1000));
  }
}

describe('scan API (e2e)', () => {
  let app: ChildProcess;
  let workDir: string;

  before(async () => {
    workDir = await mkdtemp(join(tmpdir(), 'cg-e2e-'));
    app = spawn('node', ['--max-old-space-size=150', 'dist/index.js'], {
      env: { ...process.env, PORT: String(PORT), SCAN_WORK_DIR: workDir, JOB_ATTEMPTS: '1' },
      stdio: 'inherit',
    });
    for (let i = 0; i < 50; i++) {
      try {
        await fetch(`${BASE}/api/scan/ping`);
        return;
      } catch {
        await new Promise((r) => setTimeout(r, 200));
      }
    }
    throw new Error('app did not start');
  });

  after(async () => {
    app.kill('SIGTERM');
    await rm(workDir, { recursive: true, force: true });
  });

  it('answers immediately with Queued, then finishes with the CRITICAL vulnerabilities', async () => {
    const started = Date.now();
    const res = await post({ repoUrl: REPO });
    assert.equal(res.status, 202);
    assert.ok(Date.now() - started < 1000, 'POST must not wait for the scan');
    const { scanId, status } = (await res.json()) as { scanId: string; status: string };
    assert.equal(status, 'Queued');

    const finished = await waitFor(scanId, (s) => s.status === 'Finished' || s.status === 'Failed');
    assert.equal(finished.status, 'Finished', finished.error ?? 'scan did not fail');
    assert.equal(finished.criticalCount, 12);
    assert.equal(finished.criticalVulnerabilities?.length, 12);
    assert.ok(finished.criticalVulnerabilities?.every((v) => v.severity === 'CRITICAL'));
    assert.deepEqual(await readdir(workDir), [], 'clone and report must be deleted');
  });

  it('works through GraphQL: startScan, then query the result', async () => {
    const gql = async <T>(query: string): Promise<T> => {
      const res = await fetch(`${BASE}/graphql`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ query }),
      });
      const body = (await res.json()) as { data?: T; errors?: { message: string }[] };
      assert.equal(body.errors, undefined, JSON.stringify(body.errors));
      return body.data as T;
    };
    const { startScan } = await gql<{ startScan: { id: string; status: string } }>(
      `mutation { startScan(repoUrl: "${REPO}") { id status } }`,
    );
    assert.equal(startScan.status, 'Queued');

    const deadline = Date.now() + 120_000;
    for (;;) {
      const { scan } = await gql<{ scan: { status: string; criticalCount: number; criticalVulnerabilities: { id: string }[] | null } }>(
        `{ scan(id: "${startScan.id}") { status criticalCount criticalVulnerabilities { id } } }`,
      );
      assert.notEqual(scan.status, 'Failed');
      if (scan.status === 'Finished') {
        assert.equal(scan.criticalCount, 12);
        assert.equal(scan.criticalVulnerabilities?.length, 12);
        break;
      }
      assert.equal(scan.criticalVulnerabilities, null);
      assert.ok(Date.now() < deadline, 'timed out');
      await new Promise((r) => setTimeout(r, 1000));
    }
  });

  it('ends in Failed with a message when the repo cannot be cloned', async () => {
    const { scanId } = (await (await post({ repoUrl: 'https://github.com/Shnyrkevich/no-such-repo-xyz' })).json()) as { scanId: string };
    const s = await waitFor(scanId, (x) => x.status === 'Failed' || x.status === 'Finished');
    assert.equal(s.status, 'Failed');
    assert.ok(s.error);
    assert.equal(s.criticalVulnerabilities, undefined);
    assert.deepEqual(await readdir(workDir), []);
  });

  it('rejects invalid input with 400 and unknown ids with 404', async () => {
    assert.equal((await post({ repoUrl: 'file:///etc' })).status, 400);
    assert.equal((await post({})).status, 400);
    assert.equal((await fetch(`${BASE}/api/scan/does-not-exist`)).status, 404);
  });
});
