// routes/projects.js
// GET /api/projects, GET /api/projects/:id  (SPEC §2.2)

/**
 * @param {import('fastify').FastifyInstance} app
 * @param {object} ctx  { catalog }
 */
export default async function projectsRoutes(app, ctx) {
  const { catalog } = ctx;

  app.get('/api/projects', async (req) => {
    const includeHidden = req.query?.includeHidden === 'true';
    const projects = catalog.toProjects({ includeHidden });
    return { projects, generatedAt: new Date().toISOString() };
  });

  app.get('/api/projects/:id', async (req, reply) => {
    const p = catalog.toProject(req.params.id);
    if (!p) {
      reply.code(404);
      return { error: { code: 'NOT_FOUND', message: `Unknown project "${req.params.id}".` } };
    }
    return p;
  });
}
