// install_ws.test.js
// ---------------------------------------------------------------------------
// Regression: launcher.install must emit the WS contract the dashboard listens
// for — `install.log` for streamed output and `install` lifecycle events
// (started / done / failed). Before the fix the installer streamed on the
// generic `log` channel and toggled an `installing` field on a `status`
// broadcast that the frontend ignored, so the install-output panel stayed empty
// and the card was stuck on "Installing…" after a successful install.
// ---------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Catalog } from '../src/catalog.js';
import { Launcher } from '../src/launcher.js';

const SETTINGS = {
  ringBytes: 4096,
  metricsTtlSec: 60,
  dashboardPort: 7777,
  portRange: { start: 4000, end: 4099 },
  readyRegex: 'ready',
};

// WS stub recording every broadcast as [type, ...args].
function wsStub() {
  const events = [];
  return {
    events,
    broadcastLog: (...a) => events.push(['log', ...a]),
    broadcastStatus: (s) => events.push(['status', s]),
    broadcastWarning: (...a) => events.push(['warning', ...a]),
    broadcastCatalog: (...a) => events.push(['catalog', ...a]),
    broadcastInstallLog: (...a) => events.push(['install.log', ...a]),
    broadcastInstall: (...a) => events.push(['install', ...a]),
  };
}

test('launcher.install emits install + install.log WS events (not generic log/status)', async () => {
  // A throwaway Node project with no dependencies: `npm install` here is fast
  // and offline (it just resolves an empty tree).
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-install-'));
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'mc-install-fixture', version: '0.0.0', private: true }));

  const project = {
    id: 'fixture', name: 'fixture', path: dir, cwd: dir,
    type: 'node-server', typeGroup: 'Node', framework: 'Node',
    runnable: true, command: 'npm run dev', subprojects: [], env: {}, assignedPort: null,
  };

  const catalog = new Catalog(SETTINGS);
  catalog.setProjects([project]);
  const ws = wsStub();
  const launcher = new Launcher({ catalog, ws, settings: SETTINGS });

  const res = await launcher.install(project);
  assert.equal(res.status, 200, 'install should succeed for an empty package');

  const types = ws.events.map((e) => e[0]);

  // Lifecycle: a started then a done, on the dedicated `install` channel.
  const lifecycle = ws.events.filter((e) => e[0] === 'install');
  assert.ok(lifecycle.some((e) => e[1] === 'fixture' && e[2] === 'started'), 'should broadcast install started');
  assert.ok(lifecycle.some((e) => e[1] === 'fixture' && e[2] === 'done'), 'should broadcast install done');

  // Output streamed on install.log, NOT the generic runtime log channel.
  assert.ok(types.includes('install.log'), 'should stream install output on install.log');
  assert.ok(!types.includes('log'), 'install output must not leak onto the runtime log channel');

  // The installing flag must be cleared in the catalog at the end.
  assert.equal(catalog.getRuntime('fixture')?.installing, false);

  fs.rmSync(dir, { recursive: true, force: true });
});
