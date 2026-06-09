import { test } from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import { parseJsonBodyAllowEmpty } from '../src/parsers.js';

// Regression: the frontend sends `Content-Type: application/json` even on
// bodyless POSTs (stop/refresh/rescan). The default Fastify parser 400s on an
// empty body (FST_ERR_CTP_EMPTY_JSON_BODY), which broke the Stop button.

function buildApp() {
  const app = Fastify();
  app.addContentTypeParser('application/json', { parseAs: 'string' }, parseJsonBodyAllowEmpty);
  app.post('/echo', async (req) => ({ body: req.body }));
  return app;
}

test('empty application/json body parses to {} (not 400)', async () => {
  const app = buildApp();
  const res = await app.inject({
    method: 'POST',
    url: '/echo',
    headers: { 'content-type': 'application/json' },
    payload: '',
  });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.json().body, {});
  await app.close();
});

test('valid JSON body still parses normally', async () => {
  const app = buildApp();
  const res = await app.inject({
    method: 'POST',
    url: '/echo',
    headers: { 'content-type': 'application/json' },
    payload: JSON.stringify({ port: 4009 }),
  });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.json().body, { port: 4009 });
  await app.close();
});

test('malformed JSON body is rejected with 400', async () => {
  const app = buildApp();
  const res = await app.inject({
    method: 'POST',
    url: '/echo',
    headers: { 'content-type': 'application/json' },
    payload: '{ not json',
  });
  assert.equal(res.statusCode, 400);
  await app.close();
});
