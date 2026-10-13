import assert from 'node:assert/strict';
import { access, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { MemoryScanStore } from '../support/memory-scan.store.js';
import type { CriticalVulnerability, Scan } from '../../src/types/scan.js';
import { createScanProcessor, type ScanProcessorDeps } from '../../src/workers/scan.processor.js';
import { CommandError } from '../../src/utils/run-command.js';

const exists = (p: string): Promise<boolean> =>
  access(p).then(
    () => true,
    () => false,
  );

const crit = (id: string): CriticalVulnerability => ({
  id,
  pkgName: 'p',
  installedVersion: '1',
  severity: 'CRITICAL',
});

describe('scan processor', () => {
  let workRoot: string;
  let store: MemoryScanStore;
  const job = { scanId: 's1', repoUrl: 'https://github.com/o/r' };

  const seedScan = (): Promise<void> => {
    const scan: Scan = {
      id: 's1', repoUrl: job.repoUrl, status: 'Queued', criticalCount: 0, truncated: false, createdAt: '', updatedAt: '',
    };
    return store.create(scan);
  };

  const deps = (over: Partial<ScanProcessorDeps>): ScanProcessorDeps => ({
    store,
    workRoot,
    maxCriticals: 100,
    batchSize: 10,
    cloneRepo: async () => {},
    runTrivy: async (_id, dir) => {
      const report = join(dir, 'report.json');
      await writeFile(report, '{}');
      return report;
    },
    parseReport: async (_p, onBatch) => {
      await onBatch([crit('A')]);
      return { scanned: 1, critical: 1 };
    },
    ...over,
  });

  beforeEach(async () => {
    workRoot = await mkdtemp(join(tmpdir(), 'cg-test-'));
    store = new MemoryScanStore();
    await seedScan();
  });
  afterEach(() => rm(workRoot, { recursive: true, force: true }));

  it('finishes and stores criticals on the happy path', async () => {
    await createScanProcessor(deps({}))(job);
    assert.equal(store.scans.get('s1')?.status, 'Finished');
    assert.deepEqual(store.criticals.get('s1')?.map((c) => c.id), ['A']);
    assert.equal(await exists(join(workRoot, 's1')), false);
  });

  it('keeps the working files when keepWorkFiles is set (debug)', async () => {
    await createScanProcessor(deps({ keepWorkFiles: true }))(job);
    assert.equal(await exists(join(workRoot, 's1', 'report.json')), true);
  });

  it('rejects and still cleans up when Trivy fails', async () => {
    const runTrivy: ScanProcessorDeps['runTrivy'] = async (_id, dir) => {
      await writeFile(join(dir, 'report.json'), 'partial');
      throw new CommandError('docker exited with code 1', 1, 'boom');
    };
    await assert.rejects(createScanProcessor(deps({ runTrivy }))(job), /docker exited with code 1/);
    assert.equal(await exists(join(workRoot, 's1')), false, 'work dir must be removed');
    assert.notEqual(store.scans.get('s1')?.status, 'Finished');
  });

  it('rejects and cleans up when the clone fails', async () => {
    const cloneRepo: ScanProcessorDeps['cloneRepo'] = async () => {
      throw new CommandError('git exited with code 128', 128, '');
    };
    await assert.rejects(createScanProcessor(deps({ cloneRepo }))(job), /code 128/);
    assert.equal(await exists(join(workRoot, 's1')), false);
  });

  it('cleans up when the disk fills up while parsing (ENOSPC)', async () => {
    const parseReport: ScanProcessorDeps['parseReport'] = async () => {
      throw Object.assign(new Error('ENOSPC: no space left on device'), { code: 'ENOSPC' });
    };
    await assert.rejects(createScanProcessor(deps({ parseReport }))(job), /ENOSPC/);
    assert.equal(await exists(join(workRoot, 's1')), false);
  });

  it('retry starts clean: stale criticals and leftover files from a crashed attempt are dropped', async () => {
    await store.appendCriticals('s1', [crit('STALE')]);
    await createScanProcessor(deps({}))(job);
    assert.deepEqual(store.criticals.get('s1')?.map((c) => c.id), ['A']);
  });

  it('caps stored criticals and flags truncation', async () => {
    const parseReport: ScanProcessorDeps['parseReport'] = async (_p, onBatch) => {
      await onBatch([crit('1'), crit('2'), crit('3')]);
      await onBatch([crit('4'), crit('5')]);
      return { scanned: 5, critical: 5 };
    };
    await createScanProcessor(deps({ parseReport, maxCriticals: 4 }))(job);
    assert.equal(store.criticals.get('s1')?.length, 4);
    assert.equal(store.scans.get('s1')?.criticalCount, 5);
    assert.equal(store.scans.get('s1')?.truncated, true);
  });
});
