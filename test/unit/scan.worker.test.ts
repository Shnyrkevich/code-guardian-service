import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { MemoryScanStore } from '../support/memory-scan.store.js';
import { handleJobFailure } from '../../src/workers/scan.worker.js';

async function setup(): Promise<MemoryScanStore> {
  const store = new MemoryScanStore();
  await store.create({ id: 's', repoUrl: 'u', status: 'Scanning', criticalCount: 0, truncated: false, createdAt: '', updatedAt: '' });
  return store;
}

describe('job failure handling', () => {
  it('does not mark Failed while retries remain', async () => {
    const store = await setup();
    await handleJobFailure({ store, maxAttempts: 2 }, { scanId: 's', attemptsMade: 1, unrecoverable: false }, new Error('x'));
    assert.equal(store.scans.get('s')?.status, 'Scanning');
  });

  it('marks Failed with the message once attempts are exhausted', async () => {
    const store = await setup();
    await handleJobFailure({ store, maxAttempts: 2 }, { scanId: 's', attemptsMade: 2, unrecoverable: false }, new Error('trivy died'));
    assert.equal(store.scans.get('s')?.status, 'Failed');
    assert.equal(store.scans.get('s')?.error, 'trivy died');
  });

  it('marks Failed immediately for unrecoverable errors', async () => {
    const store = await setup();
    await handleJobFailure({ store, maxAttempts: 5 }, { scanId: 's', attemptsMade: 1, unrecoverable: true }, new Error('corrupt'));
    assert.equal(store.scans.get('s')?.status, 'Failed');
  });
});
