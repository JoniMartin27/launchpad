// routes/config.js
// GET/PATCH /api/config, PATCH /api/projects/:id/config  (SPEC §2.2)

import { validateConfig, mergeSettings, upsertProjectOverride, saveConfig, CONFIG_PATH } from '../config.js';

/**
 * @param {import('fastify').FastifyInstance} app
 * @param {object} ctx  { catalog, store, rediscover }
 *   store.config       current parsed config (mutable ref holder)
 *   rediscover()       re-run discovery + refresh catalog from store.config
 */
export default async function configRoutes(app, ctx) {
  const { catalog, store, rediscover } = ctx;

  app.get('/api/config', async () => {
    return { config: store.config, path: CONFIG_PATH };
  });

  // PATCH top-level settings.
  app.patch('/api/config', async (req, reply) => {
    const partial = req.body || {};
    const next = mergeSettings(store.config, partial);
    const v = validateConfig(next);
    if (!v.ok) {
      reply.code(422);
      return { error: { code: 'CONFIG_INVALID', message: v.errors.join('; '), details: { errors: v.errors } } };
    }
    // Apply the change IN PLACE. `mergeSettings` builds a fresh object, but the
    // launcher, the routes and the warmer all captured `config.settings` at
    // boot — so replacing it left every one of them reading the old values.
    // The file on disk did change, which is what made this look like it worked:
    // the new setting quietly took effect on the next restart and not before.
    Object.assign(store.config.settings, next.settings);
    saveConfig(store.config);
    rediscover();
    return store.config;
  });

  // PATCH a per-project override block.
  app.patch('/api/projects/:id/config', async (req, reply) => {
    const id = req.params.id;
    const partial = req.body || {};
    // Detect if a running project's port/command changed (requiresRestart).
    const prevOverride = store.config.projects?.[id] || {};
    const next = upsertProjectOverride(store.config, id, partial);
    const v = validateConfig(next);
    if (!v.ok) {
      reply.code(422);
      return { error: { code: 'CONFIG_INVALID', message: v.errors.join('; '), details: { errors: v.errors } } };
    }
    store.config = next;
    saveConfig(next);
    rediscover();

    const running = catalog.isRunning(id);
    const portOrCmdChanged =
      (partial.port !== undefined && partial.port !== prevOverride.port) ||
      (partial.command !== undefined && partial.command !== prevOverride.command);

    const project = catalog.toProject(id);
    if (!project) {
      reply.code(404);
      return { error: { code: 'NOT_FOUND', message: `Unknown project "${id}".` } };
    }
    return { ...project, requiresRestart: running && portOrCmdChanged };
  });
}
