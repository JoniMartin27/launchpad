import { test } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { getMetrics, clearMetricsCache } from '../src/metrics.js';

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

// A project with no registry/repo so getMetrics only exercises the port probe.
const baseProject = {
  id: 'mc-test-ipv6',
  typeGroup: 'Node',
  repoUrl: null,
  assignedPort: 45994,
};

test('metrics port.inUse: false on an unbound port', async () => {
  clearMetricsCache();
  const m = await getMetrics(baseProject, { ttlSec: 0, fresh: true });
  assert.equal(m.port.inUse, false);
});

test('metrics port.inUse: true when bound on IPv4 loopback', async () => {
  clearMetricsCache();
  const srv = await listen('127.0.0.1', 45994);
  try {
    const m = await getMetrics(baseProject, { ttlSec: 0, fresh: true });
    assert.equal(m.port.inUse, true);
  } finally {
    await close(srv);
  }
});

// The regression this fixes: Vite binds ::1 by default while 127.0.0.1 is free.
// An IPv4-only probe would report inUse=false even though the project serves.
test('metrics port.inUse: true when bound ONLY on IPv6 loopback (Vite case)', async () => {
  clearMetricsCache();
  let srv;
  try {
    srv = await listen('::1', 45994);
  } catch {
    // No IPv6 stack on this machine — skip rather than fail.
    return;
  }
  try {
    const m = await getMetrics(baseProject, { ttlSec: 0, fresh: true });
    assert.equal(m.port.inUse, true);
  } finally {
    await close(srv);
  }
});
