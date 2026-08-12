import { test } from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import { Catalog } from '../src/catalog.js';
import { Launcher } from '../src/launcher.js';
import lifecycleRoutes from '../src/routes/lifecycle.js';
import systemRoutes from '../src/routes/system.js';
import projectsRoutes from '../src/routes/projects.js';

const SETTINGS = { ringBytes: 4096, metricsTtlSec: 60, dashboardPort: 7777, portRange: { start: 4000, end: 4099 }, projectsRoot: 'C:/fake', readyRegex: 'ready' };

function base(id, extra = {}) {
  return {
    id, name: id, path: `C:/fake/${id}`, type: 'vite-react', typeGroup: 'Node',
    framework: 'Vite', repoUrl: null, runnable: true, command: 'npm run dev',
    hidden: false, assignedPort: 4000, defaultPort: 5173, subprojects: [], cwd: `C:/fake/${id}`, env: {},
    ...extra,
  };
}

// A WS stub that records broadcasts.
function wsStub() {
  const events = [];
  return {
    events,
    broadcastLog: (...a) => events.push(['log', ...a]),
    broadcastStatus: (s) => events.push(['status', s]),
    broadcastWarning: (...a) => events.push(['warning', ...a]),
    broadcastCatalog: (diff, projects) => events.push(['catalog', diff, projects]),
  };
}

async function buildApp() {
  const catalog = new Catalog(SETTINGS);
  catalog.setProjects([base('a')]);
  const ws = wsStub();
  const launcher = new Launcher({ catalog, ws, settings: SETTINGS });
  const app = Fastify();
  let rescanDiff = { added: [], removed: [], changed: [] };
  await app.register(projectsRoutes, { catalog });
  await app.register(lifecycleRoutes, { catalog, launcher });
  await app.register(systemRoutes, {
    catalog, settings: SETTINGS, startedAtMs: Date.now(),
    rediscover: () => rescanDiff, version: '1.0.0', ws,
  });
  return { app, catalog, ws };
}

test('GET /api/projects includes friendly fields', async () => {
  const { app } = await buildApp();
  const res = await app.inject({ method: 'GET', url: '/api/projects' });
  assert.equal(res.statusCode, 200);
  const body = res.json();
  const p = body.projects.find((x) => x.id === 'a');
  assert.ok(p);
  for (const k of ['needsInstall', 'installer', 'failureClass', 'failureReason', 'installing']) {
    assert.ok(k in p, `missing ${k}`);
  }
  await app.close();
});

test('POST /api/projects/:id/install refuses while running (409)', async () => {
  const { app, catalog } = await buildApp();
  catalog.setRuntime('a', { status: 'running', pid: 999, assignedPort: 4000 });
  const res = await app.inject({ method: 'POST', url: '/api/projects/a/install' });
  assert.equal(res.statusCode, 409);
  assert.equal(res.json().error.code, 'ALREADY_RUNNING');
  await app.close();
});

test('POST /api/projects/:id/install 404 for unknown id', async () => {
  const { app } = await buildApp();
  const res = await app.inject({ method: 'POST', url: '/api/projects/nope/install' });
  assert.equal(res.statusCode, 404);
  await app.close();
});

test('POST /api/rescan returns diff shape and broadcasts catalog', async () => {
  const { app, ws } = await buildApp();
  const res = await app.inject({ method: 'POST', url: '/api/rescan' });
  assert.equal(res.statusCode, 200);
  const body = res.json();
  assert.ok(body.ok);
  assert.ok(Array.isArray(body.added));
  assert.ok(Array.isArray(body.removed));
  assert.ok(Array.isArray(body.changed));
  assert.ok(Array.isArray(body.projects));
  assert.ok(ws.events.some((e) => e[0] === 'catalog'), 'should broadcast catalog');
  await app.close();
});

test('POST /api/refresh broadcasts catalog and returns projects', async () => {
  const { app, ws } = await buildApp();
  const res = await app.inject({ method: 'POST', url: '/api/refresh' });
  assert.equal(res.statusCode, 200);
  assert.ok(res.json().ok);
  assert.ok(ws.events.some((e) => e[0] === 'catalog'));
  await app.close();
});

test('discovery warnings reach the API instead of dying in the server console', async () => {
  const { app, catalog } = await buildApp();
  // No warnings → an empty array, never a missing field the UI has to guess at.
  let res = await app.inject({ method: 'GET', url: '/api/projects' });
  assert.deepEqual(res.json().warnings, []);

  // The catalog collects warnings during discovery (widened scan, port clash,
  // a config entry pointing at a folder that is gone). They must travel.
  catalog.setProjects([base('a')], ['no projects at depth 1 — found 3 at depth 2']);
  res = await app.inject({ method: 'GET', url: '/api/projects' });
  assert.deepEqual(res.json().warnings, ['no projects at depth 1 — found 3 at depth 2']);

  // …and through the refresh/rescan responses too, so the banner updates.
  for (const url of ['/api/refresh', '/api/rescan']) {
    const r = await app.inject({ method: 'POST', url });
    assert.deepEqual(r.json().warnings, ['no projects at depth 1 — found 3 at depth 2'], url);
  }
});
