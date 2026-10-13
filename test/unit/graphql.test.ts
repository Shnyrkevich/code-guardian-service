import assert from 'node:assert/strict';
import { graphql } from 'graphql';
import { describe, it } from 'node:test';
import { createRootValue } from '../../src/graphql/resolvers.js';
import { schema } from '../../src/graphql/schema.js';
import { QueueUnavailableError } from '../../src/queue/scan.queue.js';
import { ScanService } from '../../src/services/scan.service.js';
import type { ScanJobQueue } from '../../src/types/scan.js';
import { MemoryScanStore } from '../support/memory-scan.store.js';

const okQueue: ScanJobQueue = { add: async () => {} };

function setup(queue: ScanJobQueue = okQueue): { store: MemoryScanStore; run: (source: string) => ReturnType<typeof graphql> } {
  const store = new MemoryScanStore();
  const rootValue = createRootValue(new ScanService(store, queue));
  return { store, run: (source) => graphql({ schema, source, rootValue }) };
}

// graphql-js returns prototype-less objects, which strict deepEqual refuses to match
const plain = (value: unknown): unknown => JSON.parse(JSON.stringify(value));

const crit = (id: string) => ({ id, pkgName: 'p', installedVersion: '1', severity: 'CRITICAL' as const });

describe('graphql layer', () => {
  it('startScan returns immediately with status Queued', async () => {
    const { run } = setup();
    const res = await run('mutation { startScan(repoUrl: "https://github.com/o/r") { id status repoUrl } }');
    assert.equal(res.errors, undefined);
    const scan = (res.data as { startScan: { id: string; status: string; repoUrl: string } }).startScan;
    assert.equal(scan.status, 'Queued');
    assert.equal(scan.repoUrl, 'https://github.com/o/r');
    assert.ok(scan.id);
  });

  it('startScan rejects an invalid URL with BAD_USER_INPUT', async () => {
    const { run, store } = setup();
    const res = await run('mutation { startScan(repoUrl: "file:///etc") { id } }');
    assert.equal(res.errors?.[0]?.extensions?.['code'], 'BAD_USER_INPUT');
    assert.equal(store.scans.size, 0, 'nothing may be created for invalid input');
  });

  it('startScan reports SERVICE_UNAVAILABLE when the queue is down, without leaking details', async () => {
    const { run } = setup({ add: async () => { throw new QueueUnavailableError({ cause: new Error('ECONNREFUSED 10.0.0.5:6379') }); } });
    const res = await run('mutation { startScan(repoUrl: "https://github.com/o/r") { id } }');
    assert.equal(res.errors?.[0]?.extensions?.['code'], 'SERVICE_UNAVAILABLE');
    assert.doesNotMatch(res.errors?.[0]?.message ?? '', /ECONNREFUSED|10\.0\.0\.5/);
  });

  it('hides unexpected errors behind a generic message', async () => {
    const { run, store } = setup();
    store.get = async () => { throw new Error('secret redis password leaked'); };
    const res = await run('{ scan(id: "x") { id } }');
    assert.equal(res.errors?.[0]?.extensions?.['code'], 'INTERNAL_SERVER_ERROR');
    assert.doesNotMatch(res.errors?.[0]?.message ?? '', /secret/);
  });

  it('scan returns null for an unknown id', async () => {
    const { run } = setup();
    const res = await run('{ scan(id: "nope") { id status } }');
    assert.equal(res.errors, undefined);
    assert.deepEqual(plain(res.data), { scan: null });
  });

  it('criticalVulnerabilities is null until the scan is Finished', async () => {
    const { run, store } = setup();
    const started = await run('mutation { startScan(repoUrl: "https://github.com/o/r") { id } }');
    const id = (started.data as { startScan: { id: string } }).startScan.id;
    await store.appendCriticals(id, [crit('A')]); // a half-written list must not be visible
    const res = await run(`{ scan(id: "${id}") { status criticalVulnerabilities { id } } }`);
    assert.deepEqual(plain(res.data), { scan: { status: 'Queued', criticalVulnerabilities: null } });
  });

  it('returns the criticals, paged, once Finished', async () => {
    const { run, store } = setup();
    const started = await run('mutation { startScan(repoUrl: "https://github.com/o/r") { id } }');
    const id = (started.data as { startScan: { id: string } }).startScan.id;
    await store.appendCriticals(id, [crit('A'), crit('B'), crit('C')]);
    await store.setCriticalSummary(id, 3, false);
    await store.setStatus(id, 'Finished');
    const res = await run(`{ scan(id: "${id}") { status criticalCount truncated
      criticalVulnerabilities(limit: 2, offset: 1) { id severity } } }`);
    assert.equal(res.errors, undefined);
    assert.deepEqual(plain(res.data), {
      scan: {
        status: 'Finished', criticalCount: 3, truncated: false,
        criticalVulnerabilities: [{ id: 'B', severity: 'CRITICAL' }, { id: 'C', severity: 'CRITICAL' }],
      },
    });
  });

  it('does not read the criticals unless the query selects them', async () => {
    const { run, store } = setup();
    const started = await run('mutation { startScan(repoUrl: "https://github.com/o/r") { id } }');
    const id = (started.data as { startScan: { id: string } }).startScan.id;
    await store.setStatus(id, 'Finished');
    let reads = 0;
    store.getCriticals = async () => { reads++; return []; };
    await run(`{ scan(id: "${id}") { id status criticalCount } }`);
    assert.equal(reads, 0);
    await run(`{ scan(id: "${id}") { criticalVulnerabilities { id } } }`);
    assert.equal(reads, 1);
  });
});
