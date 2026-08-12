// Opening a project must never let a folder name run a command.
// ---------------------------------------------------------------------------
// The old `/api/open` ran `execFile('code', [path], { shell: true })`. With
// `shell: true` Node concatenates argv into a shell string WITHOUT escaping —
// it warns about exactly this (DEP0190) — so a project folder called
// `demo & whoami` ran `whoami`. Folder names are attacker-influenceable:
// cloning a repository is enough to pick one.
//
// The fix is structural, not a blocklist: nothing is ever concatenated into a
// shell string, so there is no metacharacter to escape in the first place.
// ---------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveOpenCommand, resolveOpenFallback, OPEN_TARGETS } from '../src/opener.js';

const NASTY = 'C:\\code\\demo & whoami';

test('the path is always its own argv entry, never part of a shell string', () => {
  for (const platform of ['win32', 'darwin', 'linux']) {
    for (const target of OPEN_TARGETS) {
      const plan = resolveOpenCommand({ target, dir: NASTY, platform });
      assert.ok(!plan.error, `${platform}/${target} should resolve`);
      assert.equal(plan.shell, false, `${platform}/${target} must not use a shell`);
      assert.ok(
        plan.args.includes(NASTY),
        `${platform}/${target} must pass the path verbatim as one argument, got ${JSON.stringify(plan.args)}`
      );
      // Nothing may smuggle the path into the command itself, and no argument
      // may be a concatenation that a shell would re-split.
      assert.ok(!plan.cmd.includes(NASTY), `${platform}/${target} put the path in the command`);
      for (const a of plan.args) {
        if (a === NASTY) continue;
        assert.ok(!a.includes(NASTY), `${platform}/${target} concatenated the path into "${a}"`);
      }
    }
  }
});

test('each platform gets the tool that exists there', () => {
  const dir = '/code/demo';
  assert.deepEqual(resolveOpenCommand({ target: 'folder', dir, platform: 'win32' }), {
    // `ignoreExit` because explorer.exe returns 1 even on success — see below.
    cmd: 'explorer', args: [dir], shell: false, ignoreExit: true,
  });
  assert.deepEqual(resolveOpenCommand({ target: 'folder', dir, platform: 'darwin' }), {
    cmd: 'open', args: [dir], shell: false,
  });
  assert.deepEqual(resolveOpenCommand({ target: 'folder', dir, platform: 'linux' }), {
    cmd: 'xdg-open', args: [dir], shell: false,
  });

  assert.deepEqual(resolveOpenCommand({ target: 'terminal', dir, platform: 'darwin' }), {
    cmd: 'open', args: ['-a', 'Terminal', dir], shell: false,
  });
  assert.equal(resolveOpenCommand({ target: 'terminal', dir, platform: 'win32' }).cmd, 'wt');
  assert.equal(resolveOpenCommand({ target: 'terminal', dir, platform: 'linux' }).cmd, 'x-terminal-emulator');
});

test('the editor is configurable, and reached through cmd on Windows', () => {
  const dir = '/code/demo';
  // On POSIX the editor binary is executed directly.
  assert.deepEqual(resolveOpenCommand({ target: 'editor', dir, platform: 'linux', editorCommand: 'subl' }), {
    cmd: 'subl', args: [dir], shell: false,
  });
  // On Windows `code` is a .cmd shim, which spawn cannot run without help —
  // but it goes through cmd's OWN argv, not a concatenated string.
  const win = resolveOpenCommand({ target: 'editor', dir, platform: 'win32', editorCommand: 'code' });
  assert.deepEqual(win, { cmd: 'cmd', args: ['/c', 'code', dir], shell: false });
  // Default when nothing is configured.
  assert.equal(resolveOpenCommand({ target: 'editor', dir, platform: 'linux' }).cmd, 'code');
});

test('an unknown target or a missing path is refused, not guessed', () => {
  const bad = resolveOpenCommand({ target: 'browser', dir: '/code/demo' });
  assert.equal(bad.error.code, 'BAD_TARGET');
  assert.match(bad.error.message, /editor/, 'the error should list what IS allowed');

  assert.equal(resolveOpenCommand({ target: 'folder', dir: '' }).error.code, 'NO_PATH');
  assert.equal(resolveOpenCommand({ target: 'folder', dir: null }).error.code, 'NO_PATH');
});

test('only Windows terminals get a fallback, and it also keeps the path separate', () => {
  const dir = 'C:\\code\\demo & whoami';
  const alt = resolveOpenFallback({ target: 'terminal', dir, platform: 'win32' });
  assert.equal(alt.shell, false);
  assert.ok(alt.args.includes(dir));

  assert.equal(resolveOpenFallback({ target: 'terminal', dir, platform: 'linux' }), null);
  assert.equal(resolveOpenFallback({ target: 'folder', dir, platform: 'win32' }), null);
});

test('explorer is marked as having a meaningless exit code', () => {
  // `explorer.exe` returns 1 even when it opened the window. Without this flag
  // the dashboard reported "explorer is not installed" every single time —
  // which is exactly what happened on the first live run.
  const win = resolveOpenCommand({ target: 'folder', dir: 'C:\\code\\demo', platform: 'win32' });
  assert.equal(win.ignoreExit, true);

  // Nothing else claims that exemption: a real failure must stay visible.
  for (const platform of ['darwin', 'linux']) {
    for (const target of OPEN_TARGETS) {
      assert.notEqual(
        resolveOpenCommand({ target, dir: '/code/demo', platform }).ignoreExit,
        true,
        `${platform}/${target} must not ignore its exit code`
      );
    }
  }
  assert.notEqual(resolveOpenCommand({ target: 'editor', dir: 'C:\\code', platform: 'win32' }).ignoreExit, true);
});
