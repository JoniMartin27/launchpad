// routes/system.js
// GET /api/health, POST /api/open, POST /api/refresh  (SPEC §2.2)

import { execFile } from 'node:child_process';
import { clearMetricsCache } from '../metrics.js';
import { resolveOpenCommand, resolveOpenFallback, toolNameFor } from '../opener.js';

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

  // Open a project in the editor, the file manager, or a terminal. The path
  // comes from the catalog, never from the request — and it is passed as its
  // own argv entry with `shell: false`, so a folder named `demo & whoami`
  // cannot run anything (see opener.js).
  app.post('/api/open', async (req, reply) => {
    const id = req.body?.id;
    const target = req.body?.target || 'editor';
    const b = catalog.getBase(id) || catalog.getLaunchable(id);
    if (!b) {
      reply.code(404);
      return { error: { code: 'NOT_FOUND', message: `Unknown project "${id}".` } };
    }

    const plan = resolveOpenCommand({
      target,
      dir: b.cwd || b.path,
      editorCommand: settings?.editorCommand,
    });
    if (plan.error) {
      reply.code(400);
      return { error: plan.error };
    }

    // Only a failure to LAUNCH the tool counts. A non-zero exit does not mean
    // it did not work: `explorer.exe` returns 1 even when it opened the window,
    // and an editor may exit non-zero for reasons of its own once it is up.
    const run = (p) =>
      new Promise((resolve) => {
        execFile(p.cmd, p.args, { windowsHide: true, shell: false }, (err) => {
          if (!err) return resolve(null);
          const missing = err.code === 'ENOENT' || err.code === 'EACCES';
          if (missing) return resolve(err);
          return resolve(p.ignoreExit ? null : err);
        });
      });

    let err = await run(plan);
    if (err) {
      // Windows Terminal is not installed everywhere; fall back to a plain
      // console rather than telling the user "no terminal".
      const alt = resolveOpenFallback({ target, dir: b.cwd || b.path });
      if (alt) err = await run(alt);
    }
    if (err) {
      reply.code(503);
      const tool = toolNameFor(plan);
      return {
        error: { code: 'TOOL_MISSING', message: `Could not run \`${tool}\` — is it installed and on your PATH?` },
      };
    }
    return { ok: true, target };
  });
}
