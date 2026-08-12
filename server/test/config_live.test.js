// A setting you change has to reach the code that uses it.
// ---------------------------------------------------------------------------
// `PATCH /api/config` used to build a NEW settings object and swap it into the
// store. But the launcher, the routes and the warmer all captured
// `config.settings` at boot, so they kept reading the old one: changing
// `editorCommand`, `autoRestartMax` or `readyRegex` from the API did nothing at
// all until the next restart.
//
// And it looked like it worked — the file on disk really did change. Found
// while testing something else: pointing the editor at a command that does not
// exist produced no error, because the route was still using `code`.
// ---------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// MUST come before importing anything that reads CONFIG_PATH: `saveConfig`
// resolves it once, at module load. The first version of this file did not do
// this, and `PATCH /api/config` cheerfully overwrote the real config.json of
// the machine running the tests — projectsRoot, port pins and all. A test that
// can damage the thing it is testing is not a test.
const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-cfgtest-'));
process.env.MISSION_CONTROL_CONFIG = path.join(SANDBOX, 'config.json');

const Fastify = (await import('fastify')).default;
const { Catalog } = await import('../src/catalog.js');
const configRoutes = (await import('../src/routes/config.js')).default;
const { parseJsonBodyAllowEmpty } = await import('../src/parsers.js');
const { DEFAULT_SETTINGS, CONFIG_PATH } = await import('../src/config.js');

test('the harness cannot touch the real config file', () => {
  // The guard for the guard: if this ever points outside the sandbox, every
  // other test in this file is writing to somebody's actual configuration.
  assert.ok(
    CONFIG_PATH.startsWith(SANDBOX),
    `tests must write to a sandbox, not to ${CONFIG_PATH}`
  );
});

/** A store whose settings object is handed out the way index.js hands it out. */
async function buildApp() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-cfg-'));
  const settings = { ...DEFAULT_SETTINGS, projectsRoot: dir, editorCommand: 'code' };
  const store = { config: { $schemaVersion: 1, settings, projects: {} } };
  const catalog = new Catalog(settings);
  catalog.setProjects([]);

  const app = Fastify();
  app.addContentTypeParser('application/json', { parseAs: 'string' }, parseJsonBodyAllowEmpty);
  await app.register(configRoutes, { catalog, store, rediscover: () => ({ added: [], removed: [], changed: [] }) });

  // `captured` is what every consumer holds: the object as it was at boot.
  return { app, store, captured: settings, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

test('a settings change reaches code that captured the object at boot', async () => {
  const { app, store, captured, cleanup } = await buildApp();
  try {
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/config',
      payload: { editorCommand: 'subl' },
    });
    assert.equal(res.statusCode, 200);
    assert.equal(res.json().settings.editorCommand, 'subl');

    // The point of the whole test: the reference everyone else is holding.
    assert.equal(captured.editorCommand, 'subl', 'holders of the boot object must see the new value');
    assert.equal(store.config.settings, captured, 'the settings object must keep its identity');
  } finally {
    cleanup();
  }
});

test('untouched settings survive the patch', async () => {
  const { app, captured, cleanup } = await buildApp();
  try {
    const before = captured.dashboardPort;
    await app.inject({ method: 'PATCH', url: '/api/config', payload: { metricsTtlSec: 5 } });
    assert.equal(captured.metricsTtlSec, 5);
    assert.equal(captured.dashboardPort, before, 'a patch must not wipe what it did not mention');
  } finally {
    cleanup();
  }
});

test('an invalid setting is refused and changes nothing', async () => {
  const { app, captured, cleanup } = await buildApp();
  try {
    const before = captured.scanDepth;
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/config',
      payload: { scanDepth: 99 }, // outside the supported range
    });
    assert.equal(res.statusCode, 422);
    assert.equal(captured.scanDepth, before, 'a rejected patch must not be half-applied');
  } finally {
    cleanup();
  }
});
