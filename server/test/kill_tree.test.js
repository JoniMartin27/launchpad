// Process-tree kill: the grandchild must die too.
// ---------------------------------------------------------------------------
// With `shell: true` the direct child is a shell (`/bin/sh` or `cmd.exe`) and
// the dev server is its GRANDCHILD. Killing only the child's pid leaves that
// grandchild alive, still holding the port — the whole point of the dashboard
// is that stopping a card frees its port.
//
// This test runs on both platforms and exercises the real code path for each:
// `taskkill /T /F` on Windows, and SIGTERM-then-SIGKILL to the process GROUP on
// POSIX (which only works because the launcher spawns children `detached`).
// ---------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { killTree } from '../src/launcher.js';

const IS_WINDOWS = process.platform === 'win32';

/** Does this pid still exist? (Signal 0 = existence check, no delivery.) */
function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err?.code === 'EPERM'; // exists, but not ours
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Poll `fn` until it returns true, or the timeout elapses. */
async function waitUntil(fn, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (fn()) return true;
    // eslint-disable-next-line no-await-in-loop
    await sleep(100);
  }
  return fn();
}

test('killTree kills the grandchild behind the shell, not just the shell', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-kill-'));
  const script = path.join(dir, 'longlived.js');
  const pidFile = path.join(dir, 'pid');
  // A stand-in dev server: announce our pid, then stay alive.
  fs.writeFileSync(
    script,
    `require('fs').writeFileSync(process.argv[2], String(process.pid));\nsetInterval(() => {}, 1000);\n`
  );

  // `shell: true` puts a shell between us and node. On POSIX the leading `:;`
  // stops dash from exec-optimising the single command away, guaranteeing a
  // real grandchild — exactly the shape a `npm run dev` produces.
  const command = IS_WINDOWS
    ? `node "${script}" "${pidFile}"`
    : `: ; node "${script}" "${pidFile}"`;

  const child = spawn(command, {
    shell: true,
    windowsHide: true,
    detached: !IS_WINDOWS, // mirrors launcher.start()
    stdio: 'ignore',
  });

  try {
    const appeared = await waitUntil(() => fs.existsSync(pidFile), 15000);
    assert.ok(appeared, 'the grandchild never started');
    const grandchild = Number(fs.readFileSync(pidFile, 'utf8').trim());
    assert.ok(Number.isInteger(grandchild) && grandchild > 0, 'bad grandchild pid');
    assert.notEqual(grandchild, child.pid, 'expected a real grandchild behind the shell');
    assert.ok(alive(grandchild), 'the grandchild should be running before the kill');

    await killTree(child.pid, { graceMs: 1500 });

    const died = await waitUntil(() => !alive(grandchild), 10000);
    assert.ok(died, `grandchild ${grandchild} survived killTree — it would still hold its port`);
  } finally {
    try {
      process.kill(child.pid, 'SIGKILL');
    } catch {
      /* already gone */
    }
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('killTree resolves harmlessly for a pid that is already gone', async () => {
  await killTree(0); // falsy pid → no-op
  // A pid that has certainly exited: spawn something instant and wait for it.
  const child = spawn(process.execPath, ['-e', 'process.exit(0)'], { stdio: 'ignore' });
  await new Promise((r) => child.on('exit', r));
  await killTree(child.pid, { graceMs: 200 }); // must not throw
});
