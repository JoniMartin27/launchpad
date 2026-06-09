// parsers.js
// ---------------------------------------------------------------------------
// Fastify content-type parser for `application/json`.
//
// The frontend always sends `Content-Type: application/json`, but several
// lifecycle/system POSTs (stop, refresh, rescan, ...) carry NO body. Fastify's
// default JSON parser rejects an empty body with FST_ERR_CTP_EMPTY_JSON_BODY
// (HTTP 400), which silently broke the Stop button in the UI. We treat an empty
// JSON body as `{}` while still rejecting malformed JSON with a 400.
// ---------------------------------------------------------------------------

/**
 * Parse a JSON request body, tolerating an empty body (→ {}).
 * Signature matches Fastify's addContentTypeParser callback (parseAs: 'string').
 * @param {import('fastify').FastifyRequest} _req
 * @param {string} body  raw body as a string
 * @param {(err: Error|null, value?: unknown) => void} done
 */
export function parseJsonBodyAllowEmpty(_req, body, done) {
  if (!body || (typeof body === 'string' && body.trim() === '')) {
    return done(null, {});
  }
  try {
    done(null, JSON.parse(body));
  } catch (err) {
    err.statusCode = 400;
    done(err, undefined);
  }
}
