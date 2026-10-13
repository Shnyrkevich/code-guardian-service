import { join } from 'node:path';
import { runCommand } from '../utils/run-command.js';

export const REPO_DIR = 'repo';
export const REPORT_FILE = 'report.json';

/** Runs Trivy in Docker over `<workDir>/repo` and returns the host path of the JSON report. */
export type RunTrivy = (scanId: string, workDir: string) => Promise<string>;

export interface TrivyRunnerOptions {
  image: string;
  cacheVolume: string;
  timeoutMs: number;
}

export function createTrivyRunner(options: TrivyRunnerOptions): RunTrivy {
  return async (scanId, workDir) => {
    const container = `trivy-${scanId}`;
    // a re-delivered job may find its previous container still around
    await removeContainer(container);
    try {
      await runCommand(
        'docker',
        [
          'run', '--rm', '--name', container,
          '-v', `${options.cacheVolume}:/root/.cache/`,
          '-v', `${workDir}:/work`,
          options.image,
          'fs', '--scanners', 'vuln', '--format', 'json', '--no-progress',
          '--output', `/work/${REPORT_FILE}`,
          `/work/${REPO_DIR}`,
        ],
        { timeoutMs: options.timeoutMs },
      );
    } finally {
      // killing the docker client on timeout does not stop the container
      await removeContainer(container);
    }
    return join(workDir, REPORT_FILE);
  };
}

async function removeContainer(name: string): Promise<void> {
  try {
    await runCommand('docker', ['rm', '-f', name], { timeoutMs: 30_000 });
  } catch {
    // nothing to remove, or docker unavailable (the main command reports that)
  }
}
