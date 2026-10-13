import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { QueueUnavailableError } from '../../src/queue/scan.queue.js';
import { MemoryScanStore } from '../support/memory-scan.store.js';
import { ScanService } from '../../src/services/scan.service.js';

describe('scan service', () => {
  it('returns a Queued scan without waiting for processing', async () => {
    const store = new MemoryScanStore();
    const added: string[] = [];
    const service = new ScanService(store, { add: async (d) => void added.push(d.scanId) });
    const scan = await service.enqueue('https://github.com/o/r');
    assert.equal(scan.status, 'Queued');
    assert.deepEqual(added, [scan.id]);
  });

  it('marks the scan Failed and surfaces the error when Redis is unavailable', async () => {
    const store = new MemoryScanStore();
    const service = new ScanService(store, { add: async () => { throw new QueueUnavailableError(); } });
    await assert.rejects(service.enqueue('https://github.com/o/r'), QueueUnavailableError);
    const [scan] = [...store.scans.values()];
    assert.equal(scan?.status, 'Failed');
  });

  it('only returns criticals once Finished', async () => {
    const store = new MemoryScanStore();
    const service = new ScanService(store, { add: async () => {} });
    const scan = await service.enqueue('https://github.com/o/r');
    assert.equal((await service.get(scan.id, 0, 10))?.criticalVulnerabilities, undefined);
    assert.equal(await service.get('missing', 0, 10), null);
  });
});
