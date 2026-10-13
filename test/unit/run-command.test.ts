import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { CommandError, runCommand } from '../../src/utils/run-command.js';

describe('runCommand', () => {
  it('resolves when the command succeeds', async () => {
    await runCommand('sh', ['-c', 'exit 0'], { timeoutMs: 5000 });
  });

  it('rejects with the exit code and a stderr tail on failure', async () => {
    await assert.rejects(runCommand('sh', ['-c', 'echo oops >&2; exit 3'], { timeoutMs: 5000 }), (err: unknown) => {
      assert.ok(err instanceof CommandError);
      assert.equal(err.exitCode, 3);
      assert.match(err.stderrTail, /oops/);
      return true;
    });
  });

  it('times out promptly even when a child process keeps the stderr pipe open (like git remote helpers)', async () => {
    const started = Date.now();
    await assert.rejects(
      runCommand('sh', ['-c', 'sleep 30 & sleep 30'], { timeoutMs: 300 }),
      /timed out after 300ms/,
    );
    assert.ok(Date.now() - started < 5000, 'must not wait for the orphaned helper to exit');
  });

  it('fails cleanly when the command does not exist', async () => {
    await assert.rejects(runCommand('definitely-not-a-command', [], { timeoutMs: 1000 }), CommandError);
  });
});
