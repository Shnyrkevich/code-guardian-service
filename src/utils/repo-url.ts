const GITHUB_REPO = /^https:\/\/github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?\/?$/;

/** Returns the canonical clone URL, or null when the input is not a plain https GitHub repo URL. */
export function normalizeGithubUrl(input: unknown): string | null {
  if (typeof input !== 'string' || input.length > 200) return null;
  const match = GITHUB_REPO.exec(input.trim());
  if (!match) return null;
  const [, owner, repo] = match;
  if (owner === undefined || repo === undefined || repo === '.' || repo === '..') return null;
  return `https://github.com/${owner}/${repo}`;
}
