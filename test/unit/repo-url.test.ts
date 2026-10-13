import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { normalizeGithubUrl } from '../../src/utils/repo-url.js';

describe('normalizeGithubUrl', () => {
  it('accepts and canonicalises GitHub repo URLs', () => {
    assert.equal(normalizeGithubUrl('https://github.com/Shnyrkevich/NodeGoat'), 'https://github.com/Shnyrkevich/NodeGoat');
    assert.equal(normalizeGithubUrl('https://github.com/o/r.git/'), 'https://github.com/o/r');
  });

  it('rejects anything that is not a plain https GitHub repo URL', () => {
    for (const bad of [
      'file:///etc', 'http://github.com/o/r', 'https://evil.com/o/r', 'https://github.com/o',
      'https://github.com/o/r/tree/main', '--upload-pack=x', 'https://github.com/o/r;rm -rf /',
      'https://user@github.com/o/r', 'https://github.com/../..', '', 42, null, undefined,
    ]) {
      assert.equal(normalizeGithubUrl(bad), null, String(bad));
    }
  });
});
