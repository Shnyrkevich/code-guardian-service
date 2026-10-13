import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { emptyDir } from '../../src/utils/empty-dir.js';

describe('emptyDir', () => {
  it('removes the contents but keeps the directory', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'cg-empty-'));
    await mkdir(join(dir, 'scan1', 'repo'), { recursive: true });
    await writeFile(join(dir, 'scan1', 'report.json'), '{}');
    await emptyDir(dir);
    assert.deepEqual(await readdir(dir), []);
    await rm(dir, { recursive: true });
  });

  it('creates the directory when it does not exist', async () => {
    const base = await mkdtemp(join(tmpdir(), 'cg-empty-'));
    const dir = join(base, 'nested', 'work');
    await emptyDir(dir);
    assert.deepEqual(await readdir(dir), []);
    await rm(base, { recursive: true });
  });
});
