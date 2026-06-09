import { test } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { isPortInUse } from '../src/ports.js';

function listen(host, port) {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.once('error', reject);
    srv.listen(port, host, () => resolve(srv));
  });
}
function close(srv) {
  return new Promise((r) => srv.close(r));
}

test('isPortInUse: false on an unbound port', async () => {
  assert.equal(await isPortInUse(45991), false);
});

test('isPortInUse: true when bound on IPv4 loopback', async () => {
  const srv = await listen('127.0.0.1', 45992);
  try {
    assert.equal(await isPortInUse(45992), true);
  } finally {
    await close(srv);
  }
});

test('isPortInUse: true when bound ONLY on IPv6 loopback (Vite case)', async () => {
  let srv;
  try {
    srv = await listen('::1', 45993);
  } catch {
    // No IPv6 stack on this machine — skip rather than fail.
    return;
  }
  try {
    assert.equal(await isPortInUse(45993), true);
  } finally {
    await close(srv);
  }
});
