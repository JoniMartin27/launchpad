// routes/system.js
// GET /api/health, POST /api/open, POST /api/refresh  (SPEC §2.2)

import { execFile } from 'node:child_process';
import { clearMetricsCache } from '../metrics.js';

/**
 * @param {import('fastify').FastifyInstance} app
 * @param {object} ctx  { catalog, settings, startedAtMs, rediscover, version, ws }
 */
export default async function systemRoutes(app, ctx) {
  const { catalog, settings, startedAtMs, rediscover, version, ws } = ctx;

  app.get('/api/health', async () => {
    return {
      ok: true,
      version: version || '1.0.0',
      uptimeSec: Math.round((Date.now() - startedAtMs) / 1000),
      runningCount: catalog.runningCount(),
      boundHost: '127.0.0.1',
      port: settings.dashboardPort || 7777,
    };
  });

  // Force re-discovery + invalidate metrics caches.
  // NOTE: metrics are invalidated AFTER building the response so the returned
  // projects stay consistent (avoids the CI-badge flash where clearing then
  // returning all-null ci wiped warm badges). Fresh metrics re-warm lazily via
  // the per-project /metrics endpoint / background warmer.
  app.post('/api/refresh', async () => {
    const diff = rediscover();
    const projects = catalog.toProjects();
    clearMetricsCache();
    // Tell open dashboards the catalog changed (same shape as the watcher).
    ws?.broadcastCatalog(diff, projects);
    return { ok: true, projects, warnings: catalog.warnings || [] };
  });

  // Re-run hybrid discovery and report what changed (SPEC item 3). Unlike
  // /api/refresh this does NOT clear metrics; it is the explicit "rescan the
  // filesystem now" action and returns the diff. Running processes are
  // preserved (the catalog keeps runtime state for surviving ids).
  app.post('/api/rescan', async () => {
    const diff = rediscover();
    const projects = catalog.toProjects();
    ws?.broadcastCatalog(diff, projects);
    return { ok: true, added: diff.added, removed: diff.removed, changed: diff.changed, projects, warnings: catalog.warnings || [] };
  });

  // Open a project in VS Code. Path is validated against the catalog (§9).
  app.post('/api/open', async (req, reply) => {
    const id = req.body?.id;
    const b = catalog.getBase(id) || catalog.getLaunchable(id);
    if (!b) {
      reply.code(404);
      return { error: { code: 'NOT_FOUND', message: `Unknown project "${id}".` } };
    }
    // execFile with the validated, catalog-derived path only (no user string).
    return await new Promise((resolve) => {
      execFile('code', [b.path], { windowsHide: true, shell: true }, (err) => {
        if (err) {
          reply.code(503);
          resolve({ error: { code: 'TOOL_MISSING', message: '`code` not found on PATH.' } });
          return;
        }
        resolve({ ok: true });
      });
    });
  });
}
