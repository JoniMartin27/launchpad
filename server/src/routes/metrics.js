// routes/metrics.js
// GET /api/projects/:id/metrics  (SPEC §2.2)

import { getMetrics } from '../metrics.js';

/**
 * @param {import('fastify').FastifyInstance} app
 * @param {object} ctx  { catalog, settings }
 */
export default async function metricsRoutes(app, ctx) {
  const { catalog, settings } = ctx;

  app.get('/api/projects/:id/metrics', async (req, reply) => {
    const b = catalog.getBase(req.params.id) || catalog.getLaunchable(req.params.id);
    if (!b) {
      reply.code(404);
      return { error: { code: 'NOT_FOUND', message: `Unknown project "${req.params.id}".` } };
    }
    const fresh = req.query?.fresh === 'true';
    // Metrics never 5xx; getMetrics degrades inside the body.
    const data = await getMetrics(b, {
      ttlSec: settings.metricsTtlSec || 60,
      fresh,
      isOwnedByUs: async (port) => catalog.portOwnedByUs(port),
    });
    return data;
  });
}
