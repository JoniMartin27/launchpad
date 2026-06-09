// routes/git.js
// GET /api/projects/:id/git  (SPEC §2.2)

import { gitStatus } from '../git.js';

/**
 * @param {import('fastify').FastifyInstance} app
 * @param {object} ctx  { catalog }
 */
export default async function gitRoutes(app, ctx) {
  const { catalog } = ctx;

  app.get('/api/projects/:id/git', async (req, reply) => {
    const b = catalog.getBase(req.params.id) || catalog.getLaunchable(req.params.id);
    if (!b) {
      reply.code(404);
      return { error: { code: 'NOT_FOUND', message: `Unknown project "${req.params.id}".` } };
    }
    try {
      const status = await gitStatus(b.cwd || b.path);
      return { id: req.params.id, ...status };
    } catch (err) {
      if (err.code === 'TOOL_MISSING') {
        reply.code(503);
        return { error: { code: 'TOOL_MISSING', message: 'git binary not found on PATH.' } };
      }
      // Unexpected error → treat as not-a-repo rather than 5xx.
      return { id: req.params.id, isRepo: false };
    }
  });
}
