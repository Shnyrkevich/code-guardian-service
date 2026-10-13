import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createSemaphore } from '../../src/utils/semaphore.js';

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

describe('semaphore', () => {
  it('never runs more than `limit` tasks at the same time', async () => {
    const gate = createSemaphore(2);
    let running = 0;
    let peak = 0;
    const task = async (): Promise<void> => {
      running++;
      peak = Math.max(peak, running);
      await sleep(20);
      running--;
    };
    await Promise.all(Array.from({ length: 6 }, () => gate.run(task)));
    assert.equal(peak, 2);
  });

  it('runs waiting tasks in the order they arrived', async () => {
    const gate = createSemaphore(1);
    const order: number[] = [];
    await Promise.all([1, 2, 3, 4].map((n) => gate.run(async () => { await sleep(5); order.push(n); })));
    assert.deepEqual(order, [1, 2, 3, 4]);
  });

  it('frees the slot when a task fails, so the next one still runs', async () => {
    const gate = createSemaphore(1);
    const failing = gate.run(async () => { throw new Error('clone failed'); });
    const next = gate.run(async () => 'ok');
    await assert.rejects(failing, /clone failed/);
    assert.equal(await next, 'ok');
  });

  it('returns the value of the task', async () => {
    assert.equal(await createSemaphore(3).run(async () => 42), 42);
  });

  it('rejects an invalid limit', () => {
    assert.throws(() => createSemaphore(0));
    assert.throws(() => createSemaphore(1.5));
  });
});
