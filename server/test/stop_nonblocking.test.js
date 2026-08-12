// Stopping must answer at once and finish the kill in the background.
// ---------------------------------------------------------------------------
// On POSIX the kill is polite first: SIGTERM, then up to a two-second grace
// window before SIGKILL. `stop()` used to await all of that, so the HTTP
// response waited — and a batch stop of five projects waited five times over —
// even though the browser learns the real outcome from the `stopped` WebSocket
// event that the child's own exit handler pushes.
//
// The child here IGNORES SIGTERM on purpose, so the full grace window elapses
// and the difference between awaiting and not awaiting is unmistakable.
// (On Windows `taskkill /T /F` is immediate, so the timing assertion is
// trivially true there; the Linux jobs in CI are what make it bite.)
// ---------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Catalog } from '../src/catalog.js';
import { Launcher, killTree } from '../src/launcher.js';

const SETTINGS = { portRange: { start: 4000, end: 4099 }, ringBytes: 4096, readyRegex: 'ready' };

// A real file invoked in quotes: an inline `node -e "…"` loses its quotes on the
// way through `shell: true` and /bin/sh chokes on the parentheses.
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-stop-'));
const STUBBORN = path.join(TMP, 'stubborn.js');
fs.writeFileSync(
  STUBBORN,
  // Swallow SIGTERM so only SIGKILL (after the grace window) can end this.
  "process.on('SIGTERM', () => {});\nsetInterval(() => {}, 1000);\n"
);

function wsStub() {
  const events = [];
  return {
    events,
    broadcastLog() {}, broadcastWarning() {}, broadcastCatalog() {},
    broadcastInstallLog() {}, broadcastInstall() {},
    broadcastStatus(msg) { events.push(msg); },
  };
}

function project(id) {
  return {
    id,
    name: id,
    path: process.cwd(),
    type: 'node-cli', // portless: no port probing in the way
    typeGroup: 'Node',
    framework: 'Node CLI',
    command: `node "${STUBBORN}"`,
    runnable: true,
    assignedPort: null,
    subprojects: [],
  };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitUntil(fn, timeoutMs = 8000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (fn()) return true;
    // eslint-disable-next-line no-await-in-loop
    await sleep(50);
  }
  return fn();
}

function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err?.code === 'EPERM';
  }
}

test('stop does not wait for the kill, on any platform', async () => {
  // Timing alone is not enough: on Windows `taskkill /T /F` returns at once, so
  // "did stop() await the kill?" is invisible there — a version that awaited
  // passed this test on Windows and only failed on Linux. Injecting a killer
  // that deliberately takes its time makes the question answerable everywhere.
  const SLOW_MS = 1500;
  let killed = 0;
  // A stand-in that only takes its time and records the call — it must NOT
  // actually signal anything. Killing the shell here would orphan the stubborn
  // grandchild beyond the reach of `taskkill /T`, and the orphan holds the test
  // runner's stdio open forever. The real tree is reaped in `finally`.
  const slowKill = () =>
    new Promise((resolve) => {
      setTimeout(() => {
        killed++;
        resolve();
      }, SLOW_MS);
    });

  const catalog = new Catalog(SETTINGS);
  catalog.setProjects([project('slow')]);
  const launcher = new Launcher({ catalog, ws: wsStub(), settings: SETTINGS, kill: slowKill });
  const started = await launcher.start(catalog.getLaunchable('slow'));

  try {
    const t0 = Date.now();
    const res = await launcher.stop('slow');
    const elapsed = Date.now() - t0;

    assert.equal(res.status, 202);
    assert.ok(elapsed < SLOW_MS / 3, `stop returned in ${elapsed}ms; it must not await a ${SLOW_MS}ms kill`);
    assert.equal(killed, 0, 'and the kill is genuinely still in flight when it returns');

    // The kill does complete, in the background.
    assert.ok(await waitUntil(() => killed === 1, SLOW_MS * 3), 'the kill must still happen');
  } finally {
    // The injected killer only signals the pid it is given; on Windows that is
    // the shell, and the stubborn grandchild would survive, hold the test
    // runner's stdio open and hang the suite. Reap the real tree here.
    await killTree(started.body.pid, { graceMs: 200 }).catch(() => {});
  }
});

test('stop answers 202 immediately and reaps the process afterwards', async () => {
  const catalog = new Catalog(SETTINGS);
  catalog.setProjects([project('a')]);
  const ws = wsStub();
  const launcher = new Launcher({ catalog, ws, settings: SETTINGS });

  const started = await launcher.start(catalog.getLaunchable('a'));
  assert.equal(started.status, 202);
  const pid = started.body.pid;
  assert.ok(await waitUntil(() => alive(pid)), 'the child should be up');

  try {
    const t0 = Date.now();
    const res = await launcher.stop('a');
    const elapsed = Date.now() - t0;

    assert.equal(res.status, 202, 'accepted, in progress — not "done"');
    assert.equal(res.body.status, 'stopping');
    assert.ok(elapsed < 500, `stop must not wait for the kill (took ${elapsed}ms)`);

    // The UI is told immediately that it is stopping…
    assert.ok(ws.events.some((e) => e.projectId === 'a' && e.status === 'stopping'));

    // …and the process really does die, in the background.
    assert.ok(await waitUntil(() => !alive(pid)), 'the child must still be reaped');
    assert.ok(
      await waitUntil(() => ws.events.some((e) => e.projectId === 'a' && e.status === 'stopped')),
      'and the final `stopped` must reach the UI over the socket'
    );
  } finally {
    await killTree(started.body.pid, { graceMs: 200 }).catch(() => {});
  }
});

test('stop({ wait: true }) still blocks until the process is gone', async () => {
  const catalog = new Catalog(SETTINGS);
  catalog.setProjects([project('b')]);
  const launcher = new Launcher({ catalog, ws: wsStub(), settings: SETTINGS });

  const started = await launcher.start(catalog.getLaunchable('b'));
  const pid = started.body.pid;
  assert.ok(await waitUntil(() => alive(pid)));

  try {
    const res = await launcher.stop('b', { wait: true });
    assert.equal(res.status, 200, 'the blocking form reports completion, not acceptance');
    assert.equal(alive(pid), false, 'when it resolves, the process is already gone');
  } finally {
    await killTree(started.body.pid, { graceMs: 200 }).catch(() => {});
  }
});

test('stopping something that is not running is still a 409', async () => {
  const catalog = new Catalog(SETTINGS);
  catalog.setProjects([project('c')]);
  const launcher = new Launcher({ catalog, ws: wsStub(), settings: SETTINGS });
  const res = await launcher.stop('c');
  assert.equal(res.status, 409);
  assert.equal(res.body.error.code, 'NOT_RUNNING');
});
