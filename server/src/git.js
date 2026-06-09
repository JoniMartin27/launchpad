// git.js
// ---------------------------------------------------------------------------
// Live git status via the git CLI (execFile — never shells a user string).
// Returns the §2.2 GET /api/projects/:id/git shape. Degrades gracefully:
//   - not a repo            → { isRepo: false }
//   - git binary missing    → throw { code: 'TOOL_MISSING' }
// ---------------------------------------------------------------------------

import { execFile } from 'node:child_process';

/** Promise wrapper around execFile for `git`. Resolves trimmed stdout. */
function git(args, cwd) {
  return new Promise((resolve, reject) => {
    execFile('git', args, { cwd, windowsHide: true, timeout: 8000 }, (err, stdout, stderr) => {
      if (err) {
        // ENOENT ⇒ git not installed.
        if (err.code === 'ENOENT') {
          const e = new Error('git binary not found');
          e.code = 'TOOL_MISSING';
          return reject(e);
        }
        // Non-zero exit (e.g. not a repo): attach stderr, let caller decide.
        err.stderr = String(stderr || '');
        return reject(err);
      }
      resolve(String(stdout).trim());
    });
  });
}

/**
 * Full git status for a project directory.
 * @param {string} cwd  project root
 * @returns {Promise<object>}  §2.2 git shape
 */
export async function gitStatus(cwd) {
  // Is it a repo?
  try {
    const inside = await git(['rev-parse', '--is-inside-work-tree'], cwd);
    if (inside !== 'true') return { isRepo: false };
  } catch (err) {
    if (err.code === 'TOOL_MISSING') throw err;
    return { isRepo: false };
  }

  const result = { isRepo: true };

  // Branch (HEAD).
  result.branch = await git(['rev-parse', '--abbrev-ref', 'HEAD'], cwd).catch(() => null);

  // Porcelain v2 for staged/unstaged/untracked counts.
  let staged = 0;
  let unstaged = 0;
  let untracked = 0;
  try {
    const porc = await git(['status', '--porcelain=v1'], cwd);
    for (const line of porc.split('\n').filter(Boolean)) {
      const x = line[0]; // index/staged
      const y = line[1]; // worktree/unstaged
      if (x === '?' && y === '?') {
        untracked++;
        continue;
      }
      if (x !== ' ' && x !== '?') staged++;
      if (y !== ' ' && y !== '?') unstaged++;
    }
  } catch {
    /* leave zeros */
  }
  result.staged = staged;
  result.unstaged = unstaged;
  result.untracked = untracked;
  result.dirty = staged + unstaged + untracked > 0;

  // Ahead / behind vs upstream.
  result.ahead = 0;
  result.behind = 0;
  try {
    const ab = await git(['rev-list', '--left-right', '--count', 'HEAD...@{upstream}'], cwd);
    const [a, b] = ab.split(/\s+/).map((n) => Number(n) || 0);
    result.ahead = a;
    result.behind = b;
  } catch {
    /* no upstream tracking — leave zeros */
  }

  // Last commit.
  try {
    const log = await git(['log', '-1', '--pretty=format:%h%x1f%s%x1f%cr'], cwd);
    const [hash, subject, relative] = log.split('\x1f');
    result.lastCommit = { hash, subject, relative };
  } catch {
    result.lastCommit = null;
  }

  // Remote URL.
  result.remoteUrl = await git(['config', '--get', 'remote.origin.url'], cwd).catch(() => null);

  return result;
}

/**
 * Cheap subset for the card (branch/dirty/ahead/behind). Never throws.
 * @param {string} cwd
 * @returns {Promise<{branch:string|null,dirty:boolean,ahead:number,behind:number}|null>}
 */
export async function gitSummary(cwd) {
  try {
    const s = await gitStatus(cwd);
    if (!s.isRepo) return null;
    return { branch: s.branch, dirty: s.dirty, ahead: s.ahead, behind: s.behind };
  } catch {
    return null;
  }
}
