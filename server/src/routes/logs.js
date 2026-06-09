// routes/logs.js
// GET /api/projects/:id/logs  (SPEC §2.2 — REST snapshot fallback)

/**
 * @param {import('fastify').FastifyInstance} app
 * @param {object} ctx  { catalog }
 */
export default async function logsRoutes(app, ctx) {
  const { catalog } = ctx;

  app.get('/api/projects/:id/logs', async (req, reply) => {
    const id = req.params.id;
    if (!catalog.getLaunchable(id)) {
      reply.code(404);
      return { error: { code: 'NOT_FOUND', message: `Unknown project "${id}".` } };
    }
    const ring = catalog.getRing(id);
    const tail = req.query?.tail ? Number(req.query.tail) : undefined;
    return {
      id,
      lines: ring ? ring.snapshot(tail) : [],
      running: catalog.isRunning(id),
      droppedBytes: ring ? ring.droppedBytes : 0,
    };
  });
}
