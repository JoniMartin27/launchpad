// A port probe taken before a status change says nothing about the state after.
// ---------------------------------------------------------------------------
// The metrics cache has a 60s TTL. After a stop, the cached probe was taken
// while the server was still up, so the card kept reporting "port in use" for
// the rest of the TTL even though the port had been freed.
// ---------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { Catalog, probeIsFresh } from '../src/catalog.js';
import { getMetrics, clearMetricsCache } from '../src/metrics.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Listen on an ephemeral port and resolve { port, close }. */
function listen() {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.listen(0, '127.0.0.1', () => {
      resolve({
        port: srv.address().port,
        close: () => new Promise((r) => srv.close(r)),
      });
    });
  });
}

test('probeIsFresh only trusts probes taken after the last status change', () => {
  const t = 1_000_000;
  const probe = (ms) => ({ fetchedAt: new Date(ms).toISOString(), port: { inUse: true } });

  assert.equal(probeIsFresh(probe(t + 1), { statusChangedAt: t }), true, 'probe after the change');
  assert.equal(probeIsFresh(probe(t - 1), { statusChangedAt: t }), false, 'probe before the change');
  assert.equal(probeIsFresh(probe(t), {}), true, 'no transition recorded → nothing to invalidate');
  assert.equal(probeIsFresh(null, { statusChangedAt: t }), false, 'no metrics at all');
  assert.equal(probeIsFresh({ fetchedAt: 'nonsense', port: {} }, { statusChangedAt: t }), false);
});

test('a card stops claiming its port is in use as soon as it is stopped', async () => {
  clearMetricsCache();
  const srv = await listen();
  const catalog = new Catalog({ portRange: { start: 4000, end: 4099 }, ringBytes: 4096 });
  const base = {
    id: 'demo',
    name: 'demo',
    path: process.cwd(),
    type: 'node-server',
    typeGroup: 'Node',
    framework: 'Node',
    command: 'npm run dev',
    runnable: true,
    assignedPort: srv.port,
    subprojects: [],
  };
  catalog.setProjects([base], []);

  try {
    // 1. While it serves, warm the metrics cache: the probe sees a bound port.
    const warm = await getMetrics(base, { ttlSec: 60 });
    assert.equal(warm.port.inUse, true, 'the probe should see the listening socket');

    catalog.setStatus('demo', { status: 'running', assignedPort: srv.port });
    assert.equal(catalog.toProject('demo').portInUse, true);

    // 2. Stop: the port is released, but the cached probe is still 60s from
    //    expiring and still says "in use".
    await srv.close();
    await sleep(5); // ensure the transition timestamp lands after the probe
    catalog.setStatus('demo', { status: 'stopped' });

    const after = catalog.toProject('demo');
    assert.equal(after.status, 'stopped');
    assert.equal(after.portInUse, false, 'a pre-stop probe must not keep the port marked as busy');
    assert.equal(after.portOwnedByUs, false);
  } finally {
    await srv.close().catch(() => {});
    clearMetricsCache();
  }
});
