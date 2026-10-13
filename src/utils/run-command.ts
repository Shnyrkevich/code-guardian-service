import { spawn, type ChildProcess } from 'node:child_process';

export class CommandError extends Error {
  constructor(
    message: string,
    readonly exitCode: number | null,
    readonly stderrTail: string,
  ) {
    super(message);
    this.name = 'CommandError';
  }
}

export interface RunOptions {
  timeoutMs: number;
  env?: NodeJS.ProcessEnv;
}

const STDERR_TAIL_BYTES = 4096;

/** git spawns helper processes that hold our stderr pipe; killing only the parent leaves them downloading. */
function killGroup(child: ChildProcess): void {
  try {
    if (child.pid !== undefined) process.kill(-child.pid, 'SIGKILL');
  } catch {
    child.kill('SIGKILL');
  }
}

/**
 * Runs a command without a shell (args are an array) and never buffers stdout:
 * Trivy writes to a file, so memory stays flat. Only a small stderr tail is kept for diagnostics.
 */
export function runCommand(command: string, args: string[], options: RunOptions): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ['ignore', 'ignore', 'pipe'],
      // own process group, so a timeout can kill git's helpers / docker's children too
      detached: true,
      env: { ...process.env, ...options.env },
    });
    let tail = '';
    let timedOut = false;

    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => {
      tail = (tail + chunk).slice(-STDERR_TAIL_BYTES);
    });

    const timer = setTimeout(() => {
      timedOut = true;
      killGroup(child);
    }, options.timeoutMs);

    child.on('error', (err) => {
      clearTimeout(timer);
      reject(new CommandError(`${command} failed to start: ${err.message}`, null, tail));
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (timedOut) reject(new CommandError(`${command} timed out after ${options.timeoutMs}ms`, code, tail));
      else if (code === 0) resolve();
      else reject(new CommandError(`${command} exited with code ${code}`, code, tail));
    });
  });
}
