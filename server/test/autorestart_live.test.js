// The policy, wired to a process that really dies.
// ---------------------------------------------------------------------------
// The pure decision function is tested next door. This checks the wiring: that
// a real crash reaches it, that the relaunch actually happens, that a stop
// never triggers one, and that a project which crashes on boot is eventually
// left alone instead of being relaunched forever.
// ---------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Catalog } from '../src/catalog.js';
import { Launcher, killTree } from '../src/launcher.js';

// Real files invoked in quotes: an inline `node -e "…"` loses its quotes going
// through `shell: true`, and /bin/sh then chokes on the parentheses.
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-restart-'));
const CRASHER = path.join(TMP, 'crasher.js');
const SURVIVOR = path.join(TMP, 'survivor.js');
// Stays up long enough to be seen running, then dies non-zero.
fs.writeFileSync(CRASHER, "setTimeout(() => process.exit(7), 400);\n");
fs.writeFileSync(SURVIVOR, 'setInterval(() => {}, 1000);\n');

// Fast policy so the test does not sit through real backoff.
const SETTINGS = {
  portRange: { start: 4000, end: 4099 },
  ringBytes: 4096,
  readyRegex: 'ready',
  autoRestartMax: 2,
  autoRestartDelayMs: 60,
  autoRestartHealthyMs: 60_000,
  // Reach 'running' fast: the point of these tests is what happens AFTER a
  // project has come up. With the default 2.5s grace every crash would arrive
  // while still 'starting', which the policy correctly refuses to restart —
  // so the tests would be exercising the wrong branch.
  portlessGraceMs: 120,
};

function wsStub() {
  const warnings = [];
  const statuses = [];
  return {
    warnings,
    statuses,
    broadcastLog() {}, broadcastCatalog() {}, broadcastInstallLog() {}, broadcastInstall() {},
    broadcastWarning(id, code, message) { warnings.push({ id, code, message }); },
    broadcastStatus(msg) { statuses.push(msg); },
  };
}

function project(id, script, over = {}) {
  return {
    id,
    name: id,
    path: process.cwd(),
    type: 'node-cli', // portless: no port probing between us and the point
    typeGroup: 'Node',
    framework: 'Node CLI',
    command: `node "${script}"`,
    runnable: true,
    assignedPort: null,
    subprojects: [],
    ...over,
  };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitUntil(fn, timeoutMs = 8000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (fn()) return true;
    // eslint-disable-next-line no-await-in-loop
    await sleep(40);
  }
  return fn();
}

/** How many times this project was (re)launched, per the status stream. */
const startsOf = (ws, id) => ws.statuses.filter((s) => s.projectId === id && s.status === 'starting').length;

test('a crash is relaunched when the project opted in', async () => {
  const catalog = new Catalog(SETTINGS);
  catalog.setProjects([project('crasher', CRASHER, { autoRestart: true })]);
  const ws = wsStub();
  const launcher = new Launcher({ catalog, ws, settings: SETTINGS });

  try {
    await launcher.start(catalog.getLaunchable('crasher'));
    // First crash → one restart announced and performed.
    assert.ok(
      await waitUntil(() => ws.warnings.some((w) => w.code === 'AUTO_RESTARTING')),
      'the user must be told it is restarting'
    );
    assert.ok(await waitUntil(() => startsOf(ws, 'crasher') >= 2), 'it should have been launched again');
  } finally {
    await launcher.killAll().catch(() => {});
  }
});

test('a project that keeps crashing is eventually left alone, loudly', async () => {
  const catalog = new Catalog(SETTINGS);
  catalog.setProjects([project('loop', CRASHER, { autoRestart: true })]);
  const ws = wsStub();
  const launcher = new Launcher({ catalog, ws, settings: SETTINGS });

  try {
    await launcher.start(catalog.getLaunchable('loop'));
    assert.ok(
      await waitUntil(() => ws.warnings.some((w) => w.code === 'AUTO_RESTART_GAVE_UP'), 12_000),
      'it must give up and say so'
    );
    // maxAttempts = 2, so: the original launch plus two retries. Never endless.
    const launches = startsOf(ws, 'loop');
    assert.ok(launches <= 3, `expected at most 3 launches with maxAttempts=2, saw ${launches}`);

    // And it really has stopped trying.
    const before = startsOf(ws, 'loop');
    await sleep(500);
    assert.equal(startsOf(ws, 'loop'), before, 'no further relaunches after giving up');
  } finally {
    await launcher.killAll().catch(() => {});
  }
});

test('opting out means a crash stays crashed', async () => {
  const catalog = new Catalog(SETTINGS);
  catalog.setProjects([project('plain', CRASHER)]); // no autoRestart
  const ws = wsStub();
  const launcher = new Launcher({ catalog, ws, settings: SETTINGS });

  try {
    await launcher.start(catalog.getLaunchable('plain'));
    assert.ok(await waitUntil(() => ws.statuses.some((s) => s.projectId === 'plain' && s.status === 'stopped')));
    await sleep(400);
    assert.equal(startsOf(ws, 'plain'), 1, 'it must not be relaunched');
    assert.equal(ws.warnings.filter((w) => w.code === 'AUTO_RESTARTING').length, 0);
  } finally {
    await launcher.killAll().catch(() => {});
  }
});

test('stopping a project never triggers a restart', async () => {
  const catalog = new Catalog(SETTINGS);
  catalog.setProjects([project('survivor', SURVIVOR, { autoRestart: true })]);
  const ws = wsStub();
  const launcher = new Launcher({ catalog, ws, settings: SETTINGS });
  const started = await launcher.start(catalog.getLaunchable('survivor'));

  try {
    await waitUntil(() => catalog.getRuntime('survivor')?.status === 'running');
    await launcher.stop('survivor', { wait: true });
    await sleep(500);
    assert.equal(startsOf(ws, 'survivor'), 1, 'a deliberate stop must stay stopped');
    assert.equal(ws.warnings.filter((w) => w.code === 'AUTO_RESTARTING').length, 0);
  } finally {
    await killTree(started.body.pid, { graceMs: 200 }).catch(() => {});
  }
});
