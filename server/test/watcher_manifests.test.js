// Editing a manifest must be noticed, without drowning in build noise.
// ---------------------------------------------------------------------------
// The structural watcher sees folders appear and disappear at the root, but not
// a `package.json` being edited INSIDE a project. Measured live in a previous
// iteration: adding a dev script to an existing project stayed invisible until
// somebody pressed Rescan.
//
// The fix is one shallow watcher per project, filtered to the manifests that
// can actually change a classification. The filter is the whole point: watching
// project folders unfiltered would fire on every build artifact and editor
// temp file, and each event costs a full rescan.
// ---------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startWatcher } from '../src/watcher.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Wait until `fn()` is true, or give up. */
async function waitFor(fn, timeoutMs = 4000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (fn()) return true;
    // eslint-disable-next-line no-await-in-loop
    await sleep(50);
  }
  return fn();
}

function makeWorkspace(projects) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-watch-mf-'));
  const dirs = [];
  for (const name of projects) {
    const d = path.join(root, name);
    fs.mkdirSync(d, { recursive: true });
    fs.writeFileSync(path.join(d, 'package.json'), JSON.stringify({ name }));
    dirs.push(d);
  }
  return { root, dirs };
}

test('editing a manifest inside a project triggers a rescan', async () => {
  const { root, dirs } = makeWorkspace(['app']);
  let fired = 0;
  const w = startWatcher({ root, debounceMs: 80, onChange: () => { fired++; return {}; } });
  try {
    assert.equal(w.setProjectDirs(dirs), 1, 'the project folder should be watched');
    await sleep(120);
    fired = 0;

    fs.writeFileSync(path.join(dirs[0], 'package.json'), JSON.stringify({ name: 'app', scripts: { dev: 'vite' } }));
    assert.ok(await waitFor(() => fired > 0), 'a manifest edit must reach discovery on its own');
  } finally {
    w.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('a new lockfile counts; build output and logs do not', async () => {
  const { root, dirs } = makeWorkspace(['app']);
  let fired = 0;
  const w = startWatcher({ root, debounceMs: 80, onChange: () => { fired++; return {}; } });
  try {
    w.setProjectDirs(dirs);
    await sleep(120);

    // Noise a real project produces constantly. None of it changes detection,
    // and each rescan it triggered would be pure waste.
    fired = 0;
    for (const noise of ['bundle.js', 'debug.log', '.DS_Store', 'README.md', 'index.d.ts']) {
      fs.writeFileSync(path.join(dirs[0], noise), 'x');
    }
    await sleep(400);
    assert.equal(fired, 0, `build noise must not trigger rescans (fired ${fired}×)`);

    // A lockfile appearing DOES change what we would launch (npm → pnpm).
    fs.writeFileSync(path.join(dirs[0], 'pnpm-lock.yaml'), '');
    assert.ok(await waitFor(() => fired > 0), 'a new lockfile must trigger a rescan');
  } finally {
    w.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('setProjectDirs reconciles: new projects watched, gone ones released', async () => {
  const { root, dirs } = makeWorkspace(['a', 'b', 'c']);
  const w = startWatcher({ root, debounceMs: 80, onChange: () => ({}) });
  try {
    assert.equal(w.setProjectDirs(dirs), 3);
    assert.equal(w.setProjectDirs(dirs.slice(0, 2)), 2, 'a removed project must release its watcher');
    assert.equal(w.projectWatcherCount(), 2);
    // Idempotent: re-arming the same set does not pile up watchers.
    assert.equal(w.setProjectDirs(dirs.slice(0, 2)), 2);
  } finally {
    w.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('the watcher count is capped, and the cap is reported rather than silent', async () => {
  const { root, dirs } = makeWorkspace(['a', 'b', 'c', 'd', 'e']);
  const warnings = [];
  const w = startWatcher({
    root,
    debounceMs: 80,
    maxProjectWatchers: 2,
    onChange: () => ({}),
    onWarning: (m) => warnings.push(m),
  });
  try {
    assert.equal(w.setProjectDirs(dirs), 2, 'must not exceed the cap');
    assert.equal(warnings.length, 1, 'hitting the cap must be said out loud');
    assert.match(warnings[0], /2 of 5/);
    assert.match(warnings[0], /Rescan/, 'and must say what still works');
  } finally {
    w.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('close() releases every handle, structural and per-project', async () => {
  const { root, dirs } = makeWorkspace(['a', 'b']);
  let fired = 0;
  const w = startWatcher({ root, debounceMs: 80, onChange: () => { fired++; return {}; } });
  w.setProjectDirs(dirs);
  await sleep(120);
  w.close();
  assert.equal(w.projectWatcherCount(), 0);

  fired = 0;
  fs.writeFileSync(path.join(dirs[0], 'package.json'), JSON.stringify({ name: 'a', scripts: { dev: 'x' } }));
  fs.mkdirSync(path.join(root, 'newcomer'));
  await sleep(400);
  assert.equal(fired, 0, 'a closed watcher must be silent');
  fs.rmSync(root, { recursive: true, force: true });
});
