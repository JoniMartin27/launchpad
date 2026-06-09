// routes/lifecycle.js
// POST /api/projects/:id/start | /stop | /restart  (SPEC §2.2)

/**
 * @param {import('fastify').FastifyInstance} app
 * @param {object} ctx  { catalog, launcher }
 */
export default async function lifecycleRoutes(app, ctx) {
  const { catalog, launcher } = ctx;

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
