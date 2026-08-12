// The pre-launch port guard has to see IPv6 too.
// ---------------------------------------------------------------------------
// `isPortFreeStrict` checked 127.0.0.1 and 0.0.0.0 — both IPv4. A server bound
// to `::` (which is what `npx serve` does, and Vite by default on Windows) was
// invisible to it, so the dashboard happily launched a project onto an occupied
// port and then reported it as `running`. Found by hand while testing
// something else: occupying 4009 with another static server did not stop the
// launch.
//
// The readiness probe had already been fixed for exactly this. The guard had
// not.
// ---------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { isPortFreeStrict, isPortFree } from '../src/ports.js';

/** Listen on `host` and resolve { port, close }. */
function listen(host) {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.once('error', reject);
    srv.listen(0, host, () => {
      resolve({ port: srv.address().port, close: () => new Promise((r) => srv.close(r)) });
    });
  });
}

test('a free port is reported free', async () => {
  // Take a port and immediately give it back, so we know it is unused.
  const srv = await listen('127.0.0.1');
  const { port } = srv;
  await srv.close();
  assert.equal(await isPortFreeStrict(port), true);
});

test('an IPv4 listener blocks the port', async () => {
  const srv = await listen('127.0.0.1');
  try {
    assert.equal(await isPortFreeStrict(srv.port), false);
  } finally {
    await srv.close();
  }
});

test('an IPv6 listener blocks the port too (the bug)', async () => {
  let srv;
  try {
    srv = await listen('::'); // dual-stack wildcard: what `serve` binds
  } catch {
    return; // no IPv6 on this machine: nothing to prove
  }
  try {
    assert.equal(
      await isPortFreeStrict(srv.port),
      false,
      'a server on :: must not be mistaken for a free port'
    );
  } finally {
    await srv.close();
  }
});

test('an IPv6-loopback listener blocks the port', async () => {
  let srv;
  try {
    srv = await listen('::1');
  } catch {
    return; // no IPv6 loopback here
  }
  try {
    assert.equal(await isPortFreeStrict(srv.port), false);
  } finally {
    await srv.close();
  }
});

test('the guard still answers for a port nobody could ever bind', async () => {
  // Port 0 means "any" to bind(), so it must never be treated as a free target.
  // The point is that the guard resolves a boolean instead of throwing.
  const answer = await isPortFreeStrict(1);
  assert.equal(typeof answer, 'boolean');
  assert.equal(typeof (await isPortFree(1, '127.0.0.1')), 'boolean');
});
