// index.js
// ---------------------------------------------------------------------------
// Entry point: builds the Fastify app, binds 127.0.0.1:7777, mounts the WS
// hub on the shared HTTP server, serves the built frontend (web/dist) when
// present, wires REST routes, and installs shutdown hooks that tree-kill every
// child. See SPEC §1, §2, §3, §9.
// ---------------------------------------------------------------------------

import path from 'node:path';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';

import {
  loadConfig,
  saveConfig,
  validateConfig,
  DEFAULT_SETTINGS,
  REPO_ROOT,
} from './config.js';
import { discover, seedConfig } from './discovery.js';
import { Catalog } from './catalog.js';
import { WsHub, isLoopback } from './ws.js';
import { Launcher } from './launcher.js';
import { startWatcher } from './watcher.js';
import { startWarmer } from './warmer.js';
import { parseJsonBodyAllowEmpty } from './parsers.js';

import projectsRoutes from './routes/projects.js';
import lifecycleRoutes from './routes/lifecycle.js';
import gitRoutes from './routes/git.js';
import metricsRoutes from './routes/metrics.js';
import logsRoutes from './routes/logs.js';
import configRoutes from './routes/config.js';
import systemRoutes from './routes/system.js';

const VERSION = '1.0.0';
const startedAtMs = Date.now();

// ---------------------------------------------------------------------------
// 1. Load (or seed) config.json.
// ---------------------------------------------------------------------------
let config = loadConfig();
if (!config) {
  // First run: seed from a fresh scan with default settings (SPEC §8.4).
  config = seedConfig({ ...DEFAULT_SETTINGS });
  saveConfig(config);
  console.log('[mission-control] seeded config.json from discovered catalog');
} else {
  // Ensure settings defaults are present.
  config.settings = { ...DEFAULT_SETTINGS, ...(config.settings || {}) };
  const v = validateConfig(config);
  if (!v.ok) {
    console.warn('[mission-control] config.json validation warnings:', v.errors.join('; '));
  }
}

const settings = config.settings;

// Mutable store so route handlers can mutate the live config reference.
const store = { config };

// ---------------------------------------------------------------------------
// 2. Build the catalog + run discovery.
// ---------------------------------------------------------------------------
const catalog = new Catalog(settings);

/**
 * Re-run hybrid discovery and reconcile the catalog. Returns the diff
 * { added, removed, changed } from setProjects so callers can report/broadcast.
 * Running processes are preserved across rescans (catalog keeps runtime state
 * for surviving ids, and keeps a still-alive child even if its folder vanished).
 * @returns {{ added: string[], removed: string[], changed: string[] }}
 */
function rediscover() {
  const { projects, warnings } = discover(store.config);
  const diff = catalog.setProjects(projects, warnings);
  if (warnings.length) {
    for (const w of warnings) console.warn('[discovery]', w);
  }
  return diff;
}
rediscover();

// ---------------------------------------------------------------------------
// 3. Build Fastify app (bound to 127.0.0.1 only).
// ---------------------------------------------------------------------------
const app = Fastify({
  logger: { level: process.env.LOG_LEVEL || 'warn' },
});

// Lifecycle/system POSTs (stop, refresh, rescan, ...) carry no body but the
// frontend always sends `Content-Type: application/json`. Tolerate an empty
// JSON body (→ {}) so it doesn't 400 with FST_ERR_CTP_EMPTY_JSON_BODY.
app.addContentTypeParser('application/json', { parseAs: 'string' }, parseJsonBodyAllowEmpty);

// Defense in depth: reject any non-loopback remote address (SPEC §2.1, §9).
app.addHook('onRequest', async (req, reply) => {
  const addr = req.socket.remoteAddress || '';
  if (!isLoopback(addr)) {
    reply.code(403).send({ error: { code: 'FORBIDDEN', message: 'Loopback access only.' } });
  }
});

// ---------------------------------------------------------------------------
// 4. WS hub on the shared HTTP server (inherits loopback bind).
//    Created after `ready()` so app.server exists; see bottom.
// ---------------------------------------------------------------------------
let ws;
let fsWatcher;
let warmer;

// ---------------------------------------------------------------------------
// 5. Launcher (needs ws — created lazily via a forwarding shim so route
//    registration can happen now; ws is attached before listen()).
// ---------------------------------------------------------------------------
const wsProxy = {
  broadcastLog: (...a) => ws?.broadcastLog(...a),
  broadcastStatus: (...a) => ws?.broadcastStatus(...a),
  broadcastWarning: (...a) => ws?.broadcastWarning(...a),
  broadcastCatalog: (...a) => ws?.broadcastCatalog(...a),
  broadcastInstallLog: (...a) => ws?.broadcastInstallLog(...a),
  broadcastInstall: (...a) => ws?.broadcastInstall(...a),
};
const launcher = new Launcher({ catalog, ws: wsProxy, settings });

// ---------------------------------------------------------------------------
// 6. Register REST routes.
// ---------------------------------------------------------------------------
await app.register(projectsRoutes, { catalog });
await app.register(lifecycleRoutes, { catalog, launcher });
await app.register(gitRoutes, { catalog });
await app.register(metricsRoutes, { catalog, settings });
await app.register(logsRoutes, { catalog });
await app.register(configRoutes, { catalog, store, rediscover });
await app.register(systemRoutes, { catalog, settings, startedAtMs, rediscover, version: VERSION, ws: wsProxy });

// Fastify plugins receive (app, opts) — our route modules read ctx from opts.
// @fastify expects the second arg as options; we pass ctx objects above and
// the modules destructure them. (Fastify merges them into the opts param.)

// ---------------------------------------------------------------------------
// 7. Static serving of the built frontend (web/dist) when present.
//    In dev, Vite serves the frontend on :5180 and proxies here, so dist may
//    be absent — that's fine.
// ---------------------------------------------------------------------------
const distDir = path.join(REPO_ROOT, 'web', 'dist');
if (fs.existsSync(distDir)) {
  await app.register(fastifyStatic, { root: distDir, prefix: '/' });
  // SPA fallback: serve index.html for non-API, non-WS GETs.
  app.setNotFoundHandler((req, reply) => {
    if (req.raw.method === 'GET' && !req.url.startsWith('/api') && !req.url.startsWith('/ws')) {
      return reply.sendFile('index.html');
    }
    reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Not found.' } });
  });
  console.log('[mission-control] serving frontend from web/dist');
} else {
  console.log('[mission-control] web/dist not built — run `npm run build` for single-port mode (dev uses Vite :5180)');
}

// ---------------------------------------------------------------------------
// 8. Shutdown hooks: tree-kill every tracked child (SPEC §7).
// ---------------------------------------------------------------------------
let shuttingDown = false;
async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`\n[mission-control] ${signal} — killing child process trees…`);
  try {
    fsWatcher?.close();
  } catch {
    /* ignore */
  }
  try {
    warmer?.close();
  } catch {
    /* ignore */
  }
  try {
    await launcher.killAll();
  } catch (e) {
    console.error('killAll error', e);
  }
  try {
    ws?.close();
  } catch {
    /* ignore */
  }
  try {
    await app.close();
  } catch {
    /* ignore */
  }
  process.exit(0);
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
// Last-ditch synchronous-ish kill on hard exit (best effort).
process.on('exit', () => {
  for (const pid of catalog.allTrackedPids()) {
    try {
      if (process.platform === 'win32') {
        // Synchronous best-effort kill (exit handlers can't await).
        execFileSync('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
      }
    } catch {
      /* ignore */
    }
  }
});

// ---------------------------------------------------------------------------
// 9. Bind + start WS.
// ---------------------------------------------------------------------------
const HOST = '127.0.0.1';
// An explicit MISSION_CONTROL_PORT always wins over the stored config so a
// clash on :7777 can be worked around without editing a git-ignored file.
const PORT = Number(process.env.MISSION_CONTROL_PORT) || settings.dashboardPort || 7777;

try {
  await app.listen({ host: HOST, port: PORT });
  // Now app.server exists — attach the WS hub to the shared server.
  ws = new WsHub(app.server, catalog);
  console.log(`[mission-control] listening on http://${HOST}:${PORT}  (ws://${HOST}:${PORT}/ws)`);

  // Live auto-detection: watch the projects root and broadcast catalog changes
  // (SPEC item 3). Running processes are preserved across the triggered rescan.
  fsWatcher = startWatcher({
    root: settings.projectsRoot,
    onChange: () => rediscover(),
    onResult: (diff) => ws?.broadcastCatalog(diff, catalog.toProjects()),
  });

  // Background metrics warmer: keeps ci/registry badges stable from first paint
  // (SPEC P0). After each pass, broadcast a catalog refresh so freshly-warmed
  // CI badges appear live without a manual refresh.
  warmer = startWarmer({
    catalog,
    settings,
    onPass: () => ws?.broadcastCatalog({ added: [], removed: [], changed: [] }, catalog.toProjects()),
  });
} catch (err) {
  console.error('[mission-control] failed to bind:', err.message);
  process.exit(1);
}
