import { runCommand } from '../utils/run-command.js';

export type CloneRepo = (repoUrl: string, destination: string) => Promise<void>;

export function createGitClone(timeoutMs: number): CloneRepo {
  return (repoUrl, destination) =>
    runCommand('git', ['clone', '--depth', '1', '--quiet', '--', repoUrl, destination], {
      timeoutMs,
      // never block waiting for credentials on private or missing repos
      env: { GIT_TERMINAL_PROMPT: '0' },
    });
}
