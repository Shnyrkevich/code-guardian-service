import { mkdir, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * Makes sure `dir` exists and is empty. Removes the contents, not the directory itself,
 * because a bind-mounted directory (Docker) cannot be removed.
 */
export async function emptyDir(dir: string): Promise<void> {
  await mkdir(dir, { recursive: true });
  for (const entry of await readdir(dir)) {
    await rm(join(dir, entry), { recursive: true, force: true });
  }
}
