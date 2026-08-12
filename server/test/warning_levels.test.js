// Not every warning is bad news.
// ---------------------------------------------------------------------------
// All of these arrived at the browser identically and were painted red, so
// "bringing it back up in 2s" — the dashboard fixing something for you — read
// exactly like "that port is taken, it did not launch". The server is the only
// place that knows which is which, so it now says so.
// ---------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Catalog } from '../src/catalog.js';
import { Launcher, killTree } from '../src/launcher.js';

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-warnlvl-'));
const CRASHER = path.join(TMP, 'crasher.js');
fs.writeFileSync(CRASHER, 'setTimeout(() => process.exit(3), 300);\n');

const SETTINGS = {
  portRange: { start: 4000, end: 4099 },
  ringBytes: 4096,
  readyRegex: 'ready',
  autoRestartMax: 1,
  autoRestartDelayMs: 40,
  autoRestartHealthyMs: 60_000,
  portlessGraceMs: 100,
};

function wsSpy() {
  const warnings = [];
  return {
    warnings,
    broadcastLog() {}, broadcastCatalog() {}, broadcastInstallLog() {},
    broadcastInstall() {}, broadcastStatus() {},
    broadcastWarning(id, code, message, level) { warnings.push({ id, code, message, level }); },
  };
}

const project = (id, over = {}) => ({
  id, name: id, path: process.cwd(),
  type: 'node-cli', typeGroup: 'Node', framework: 'Node CLI',
  command: `node "${CRASHER}"`,
  runnable: true, assignedPort: null, subprojects: [],
  ...over,
});

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

test('an auto-restart is announced as information, not as a failure', async () => {
  const catalog = new Catalog(SETTINGS);
  catalog.setProjects([project('crasher', { autoRestart: true })]);
  const ws = wsSpy();
  const launcher = new Launcher({ catalog, ws, settings: SETTINGS });

  try {
    await launcher.start(catalog.getLaunchable('crasher'));
    assert.ok(await waitUntil(() => ws.warnings.some((w) => w.code === 'AUTO_RESTARTING')));
    const restarting = ws.warnings.find((w) => w.code === 'AUTO_RESTARTING');
    assert.equal(restarting.level, 'info', 'recovering is good news; red would read as the failure');

    // Giving up IS a problem: it stays loud.
    assert.ok(await waitUntil(() => ws.warnings.some((w) => w.code === 'AUTO_RESTART_GAVE_UP'), 10_000));
    assert.equal(ws.warnings.find((w) => w.code === 'AUTO_RESTART_GAVE_UP').level, 'error');
  } finally {
    await launcher.killAll().catch(() => {});
  }
});

test('a port taken by someone else is an error, and it carries a level at all', async () => {
  // Occupy a port, then ask for it.
  const net = await import('node:net');
  const srv = net.createServer();
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const port = srv.address().port;

  const catalog = new Catalog(SETTINGS);
  catalog.setProjects([
    project('blocked', { type: 'html5-static', assignedPort: port, command: `node "${CRASHER}"` }),
  ]);
  const ws = wsSpy();
  const launcher = new Launcher({ catalog, ws, settings: SETTINGS });

  try {
    const res = await launcher.start(catalog.getLaunchable('blocked'));
    assert.equal(res.status, 409);
    const w = ws.warnings.find((x) => x.code === 'PORT_IN_USE');
    assert.ok(w, 'the refusal must be announced');
    assert.equal(w.level, 'error');
  } finally {
    await new Promise((r) => srv.close(r));
    await launcher.killAll().catch(() => {});
  }
});

test('every warning the launcher emits carries an explicit level', () => {
  // A level that defaults silently is how "restarting" ended up red in the
  // first place. Adding a new warning without deciding its severity should be
  // hard to do by accident.
  const src = fs.readFileSync(new URL('../src/launcher.js', import.meta.url), 'utf8');
  const calls = src.split('broadcastWarning(').slice(1);
  assert.ok(calls.length >= 3, 'expected the launcher to still emit warnings');
  for (const call of calls) {
    const args = call.slice(0, call.indexOf(');'));
    assert.match(
      args,
      /'(info|warn|error)'/,
      `a broadcastWarning call has no explicit level:\n${args.slice(0, 160)}`
    );
  }
});
