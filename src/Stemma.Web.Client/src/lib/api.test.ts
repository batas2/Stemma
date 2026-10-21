// A new model made inside a folder that is already in a Git repository is not committed — the
// repository is someone's, and its owner commits — and the window says so, rather than leaving the
// files to be found later as untracked.

import { describe, expect, it } from 'vitest';
import { createdMessage } from './api';

describe('what a new model is said to be', () => {
  it('says where it was made', () => {
    expect(createdMessage('Payments', { rootPath: '/home/a/Payments', projects: [], committed: true })).toBe('Created Payments in /home/a/Payments');
  });

  it('says when its files were left uncommitted in a repository that was already there', () => {
    const text = createdMessage('Payments', { rootPath: '/repo/model', projects: [], committed: false, repositoryRoot: '/repo' });
    expect(text).toContain('inside the Git repository at /repo');
    expect(text).toContain('not committed');
  });
});
