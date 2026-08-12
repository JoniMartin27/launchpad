// Batch start/stop: partial success is the normal case, and must be visible.
// ---------------------------------------------------------------------------
// Bringing up a stack was one click and one wait per project. The batch
// endpoints act on an id list or a named profile — but the interesting part is
// the contract, not the loop: one project that cannot start must never abort
// the rest, and the caller must be able to tell a full success from a partial
// one WITHOUT reading every item.
// ---------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Fastify from 'fastify';
import { Catalog } from '../src/catalog.js';
import { Launcher } from '../src/launcher.js';
import lifecycleRoutes, { resolveBatchIds } from '../src/routes/lifecycle.js';
import { parseJsonBodyAllowEmpty } from '../src/parsers.js';

const SETTINGS = { portRange: { start: 4000, end: 4099 }, ringBytes: 4096, readyRegex: 'ready' };

// A long-lived stand-in process. It has to be a FILE: the launcher spawns with
// `shell: true`, and an inline `node -e "setTimeout(()=>{},60000)"` loses its
// quotes on the way through, so /bin/sh chokes on the parentheses and the child
// dies instantly — on Linux only. (Windows' cmd.exe swallowed it, so the first
// version of these tests passed locally and failed in CI.)
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-batch-'));
const SLEEPER = path.join(TMP, 'sleeper.js');
fs.writeFileSync(SLEEPER, 'setInterval(() => {}, 1000);\n');
const SLEEP_CMD = `node "${SLEEPER}"`;

function base(id, over = {}) {
  return {
    id,
    name: id,
    path: process.cwd(),
    type: 'node-cli',
    typeGroup: 'Node',
    framework: 'Node CLI',
    command: SLEEP_CMD,
    runnable: true,
    assignedPort: null,
    subprojects: [],
    ...over,
  };
}

function wsStub() {
  return {
    broadcastLog() {}, broadcastStatus() {}, broadcastWarning() {},
    broadcastCatalog() {}, broadcastInstallLog() {}, broadcastInstall() {},
  };
}

async function buildApp({ projects, profiles } = {}) {
  const catalog = new Catalog(SETTINGS);
  catalog.setProjects(projects || [base('a'), base('b')]);
  const launcher = new Launcher({ catalog, ws: wsStub(), settings: SETTINGS });
  const app = Fastify();
  app.addContentTypeParser('application/json', { parseAs: 'string' }, parseJsonBodyAllowEmpty);
  const store = { config: { settings: SETTINGS, projects: {}, ...(profiles ? { profiles } : {}) } };
  await app.register(lifecycleRoutes, { catalog, launcher, store });
  return { app, catalog, launcher };
}

/** Kill anything the batch actually spawned, so tests leave no strays. */
async function cleanup(launcher) {
  await launcher.killAll().catch(() => {});
}

test('resolveBatchIds accepts an id list or a profile, and refuses nonsense', () => {
  const config = { profiles: { stack: ['api', 'web'] } };
  assert.deepEqual(resolveBatchIds({ ids: ['a', 'b'] }, config), { ids: ['a', 'b'] });
  assert.deepEqual(resolveBatchIds({ profile: 'stack' }, config), { ids: ['api', 'web'] });

  assert.equal(resolveBatchIds({ profile: 'nope' }, config).error.code, 'UNKNOWN_PROFILE');
  assert.deepEqual(resolveBatchIds({ profile: 'nope' }, config).error.details.known, ['stack']);
  assert.equal(resolveBatchIds({ ids: [] }, config).error.code, 'EMPTY_BATCH');
  assert.equal(resolveBatchIds({}, config).error.code, 'BAD_REQUEST');
  // A profile in a config that defines none is still an unknown profile,
  // never a crash.
  assert.equal(resolveBatchIds({ profile: 'x' }, {}).error.code, 'UNKNOWN_PROFILE');
});

test('a batch start reports one outcome per project', async () => {
  const { app, launcher } = await buildApp();
  try {
    const res = await app.inject({ method: 'POST', url: '/api/batch/start', payload: { ids: ['a', 'b'] } });
    assert.equal(res.statusCode, 200);
    const out = res.json();
    assert.equal(out.ok, true);
    assert.equal(out.requested, 2);
    assert.equal(out.succeeded, 2);
    assert.deepEqual(out.results.map((r) => r.outcome), ['started', 'started']);
  } finally {
    await cleanup(launcher);
  }
});

test('one bad project does not abort the rest, and the response says so', async () => {
  const { app, launcher } = await buildApp({
    projects: [base('good'), base('not-runnable', { runnable: false }), base('good2')],
  });
  try {
    const res = await app.inject({
      method: 'POST',
      url: '/api/batch/start',
      payload: { ids: ['good', 'ghost', 'not-runnable', 'good2'] },
    });
    // 207, not 200: some of it did not happen. A plain 200 over a partial batch
    // is a lie the caller cannot detect without inspecting every item.
    assert.equal(res.statusCode, 207);
    const out = res.json();
    assert.equal(out.ok, false);
    assert.equal(out.requested, 4);
    assert.equal(out.failed, 1, 'only the unknown id counts as a failure');
    const byId = Object.fromEntries(out.results.map((r) => [r.id, r]));
    assert.equal(byId.good.outcome, 'started');
    assert.equal(byId.good2.outcome, 'started', 'the project AFTER the bad one must still start');
    assert.equal(byId.ghost.outcome, 'not-found');
    assert.equal(byId['not-runnable'].outcome, 'not-runnable');
    assert.ok(byId['not-runnable'].reason, 'a skipped project must say why');
  } finally {
    await cleanup(launcher);
  }
});

test('starting what is already running is skipped, not failed', async () => {
  const { app, launcher } = await buildApp({ projects: [base('a')] });
  try {
    await app.inject({ method: 'POST', url: '/api/batch/start', payload: { ids: ['a'] } });
    const res = await app.inject({ method: 'POST', url: '/api/batch/start', payload: { ids: ['a'] } });
    assert.equal(res.statusCode, 200, 'an already-running project is not an error');
    const out = res.json();
    assert.equal(out.failed, 0);
    assert.equal(out.results[0].outcome, 'already-running');
  } finally {
    await cleanup(launcher);
  }
});

test('stopping what is not running is skipped, not failed', async () => {
  const { app, launcher } = await buildApp({ projects: [base('a')] });
  try {
    const res = await app.inject({ method: 'POST', url: '/api/batch/stop', payload: { ids: ['a'] } });
    assert.equal(res.statusCode, 200);
    assert.equal(res.json().results[0].outcome, 'not-running');
  } finally {
    await cleanup(launcher);
  }
});

test('a profile launches its members; an unknown profile is a 404', async () => {
  const { app, launcher } = await buildApp({
    projects: [base('api'), base('web'), base('unrelated')],
    profiles: { stack: ['api', 'web'] },
  });
  try {
    const res = await app.inject({ method: 'POST', url: '/api/batch/start', payload: { profile: 'stack' } });
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.json().results.map((r) => r.id), ['api', 'web'], 'only the profile members');

    const bad = await app.inject({ method: 'POST', url: '/api/batch/start', payload: { profile: 'ghost' } });
    assert.equal(bad.statusCode, 404);
    assert.equal(bad.json().error.code, 'UNKNOWN_PROFILE');
  } finally {
    await cleanup(launcher);
  }
});

test('GET /api/profiles lists what the batch endpoints will accept', async () => {
  const { app, launcher } = await buildApp({ profiles: { stack: ['api', 'web'], solo: ['api'] } });
  try {
    const res = await app.inject({ method: 'GET', url: '/api/profiles' });
    assert.deepEqual(res.json().profiles, [
      { name: 'stack', ids: ['api', 'web'] },
      { name: 'solo', ids: ['api'] },
    ]);
  } finally {
    await cleanup(launcher);
  }
});

test('a malformed batch request is rejected before anything is launched', async () => {
  const { app, launcher, catalog } = await buildApp();
  try {
    for (const payload of [{}, { ids: [] }, { ids: 'a' }]) {
      // eslint-disable-next-line no-await-in-loop
      const res = await app.inject({ method: 'POST', url: '/api/batch/start', payload });
      assert.equal(res.statusCode, 400, JSON.stringify(payload));
    }
    assert.equal(catalog.runningPorts().size, 0);
    assert.equal(catalog.allTrackedPids().length, 0, 'nothing may be spawned by a rejected request');
  } finally {
    await cleanup(launcher);
  }
});
