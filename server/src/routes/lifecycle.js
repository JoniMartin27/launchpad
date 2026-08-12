// routes/lifecycle.js
// POST /api/projects/:id/start | /stop | /restart      (SPEC §2.2)
// POST /api/batch/start | /api/batch/stop              (batch + profiles)

/**
 * Resolve the id list for a batch request: an explicit `ids` array, or the
 * members of a named profile from the config.
 *
 * @param {object} body            request body
 * @param {object} config          live config (may define `profiles`)
 * @returns {{ ids: string[] } | { error: object }}
 */
export function resolveBatchIds(body, config) {
  const profiles = config?.profiles || {};
  if (body?.profile !== undefined) {
    const name = String(body.profile);
    const ids = profiles[name];
    if (!Array.isArray(ids)) {
      return {
        error: {
          code: 'UNKNOWN_PROFILE',
          message: `No profile named "${name}".`,
          details: { known: Object.keys(profiles) },
        },
      };
    }
    return { ids: ids.map(String) };
  }
  if (Array.isArray(body?.ids)) {
    if (!body.ids.length) {
      return { error: { code: 'EMPTY_BATCH', message: 'Give at least one project id.' } };
    }
    return { ids: body.ids.map(String) };
  }
  return { error: { code: 'BAD_REQUEST', message: 'Provide { ids: [...] } or { profile: "name" }.' } };
}

/**
 * @param {import('fastify').FastifyInstance} app
 * @param {object} ctx  { catalog, launcher, store }
 */
export default async function lifecycleRoutes(app, ctx) {
  const { catalog, launcher, store } = ctx;

  // Resolve a launchable (top-level project OR subproject) by id.
  function resolve(id, reply) {
    const ent = catalog.getLaunchable(id);
    if (!ent) {
      reply.code(404);
      return null;
    }
    return ent;
  }

  app.post('/api/projects/:id/start', async (req, reply) => {
    const ent = resolve(req.params.id, reply);
    if (!ent) return { error: { code: 'NOT_FOUND', message: `Unknown project "${req.params.id}".` } };
    const body = req.body || {};
    const { status, body: out } = await launcher.start(ent, {
      port: body.port,
      command: body.command,
      extraEnv: body.extraEnv,
    });
    reply.code(status);
    return out;
  });

  app.post('/api/projects/:id/stop', async (req, reply) => {
    const ent = resolve(req.params.id, reply);
    if (!ent) return { error: { code: 'NOT_FOUND', message: `Unknown project "${req.params.id}".` } };
    const { status, body: out } = await launcher.stop(req.params.id);
    reply.code(status);
    return out;
  });

  app.post('/api/projects/:id/restart', async (req, reply) => {
    const ent = resolve(req.params.id, reply);
    if (!ent) return { error: { code: 'NOT_FOUND', message: `Unknown project "${req.params.id}".` } };
    const body = req.body || {};
    const { status, body: out } = await launcher.restart(ent, {
      port: body.port,
      command: body.command,
      extraEnv: body.extraEnv,
    });
    reply.code(status);
    return out;
  });

  // --- batch -------------------------------------------------------------
  // Bringing up a stack was N clicks and N waits. These take `{ ids: [...] }`
  // or `{ profile: "name" }` and act on each in turn.
  //
  // The contract is deliberately per-item: one project that cannot start must
  // never abort the rest, and the response says exactly what happened to each
  // ("started", "already-running", "not-runnable", "failed" with its reason).
  // A batch that half-worked reporting plain success would be the worst of
  // both worlds.
  async function runBatch(action, req, reply) {
    const resolved = resolveBatchIds(req.body || {}, store?.config);
    if (resolved.error) {
      reply.code(resolved.error.code === 'UNKNOWN_PROFILE' ? 404 : 400);
      return { error: resolved.error };
    }

    const results = [];
    for (const id of resolved.ids) {
      const ent = catalog.getLaunchable(id);
      if (!ent) {
        results.push({ id, outcome: 'not-found', reason: `Unknown project "${id}".` });
        continue;
      }
      // eslint-disable-next-line no-await-in-loop
      const { status, body: out } = action === 'start' ? await launcher.start(ent) : await launcher.stop(id);
      if (status >= 200 && status < 300) {
        results.push({ id, outcome: action === 'start' ? 'started' : 'stopping', port: out.assignedPort ?? null });
      } else if (out?.error?.code === 'ALREADY_RUNNING') {
        results.push({ id, outcome: 'already-running', reason: out.error.message });
      } else if (out?.error?.code === 'NOT_RUNNING') {
        results.push({ id, outcome: 'not-running', reason: out.error.message });
      } else if (out?.error?.code === 'NOT_RUNNABLE') {
        results.push({ id, outcome: 'not-runnable', reason: out.error.message });
      } else {
        results.push({ id, outcome: 'failed', reason: out?.error?.message || `HTTP ${status}` });
      }
    }

    const failed = results.filter((r) => r.outcome === 'failed' || r.outcome === 'not-found').length;
    // 207: some succeeded, some did not. Saying "200 OK" over a partial batch
    // would be a lie the caller cannot detect without reading every item.
    reply.code(failed === 0 ? 200 : 207);
    return {
      ok: failed === 0,
      action,
      requested: resolved.ids.length,
      succeeded: results.length - failed,
      failed,
      results,
    };
  }

  app.post('/api/batch/start', (req, reply) => runBatch('start', req, reply));
  app.post('/api/batch/stop', (req, reply) => runBatch('stop', req, reply));

  /** The named profiles available to the batch endpoints. */
  app.get('/api/profiles', async () => {
    const profiles = store?.config?.profiles || {};
    return {
      profiles: Object.entries(profiles).map(([name, ids]) => ({ name, ids: Array.isArray(ids) ? ids : [] })),
    };
  });

  // Install dependencies (npm install / uv sync). Output streams over WS on the
  // project's normal log channel; the response resolves when the installer
  // exits. (SPEC item 2.)
  app.post('/api/projects/:id/install', async (req, reply) => {
    const ent = resolve(req.params.id, reply);
    if (!ent) return { error: { code: 'NOT_FOUND', message: `Unknown project "${req.params.id}".` } };
    const { status, body: out } = await launcher.install(ent);
    reply.code(status);
    return out;
  });
}
