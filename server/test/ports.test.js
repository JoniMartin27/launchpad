import { test } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { isPortFree, allocatePort } from '../src/ports.js';

test('isPortFree true on an unbound port, false when bound', async () => {
  // Find a free port first.
  const free = await isPortFree(45999, '127.0.0.1');
  assert.equal(typeof free, 'boolean');

  await new Promise((resolve) => {
    const srv = net.createServer();
    srv.listen(45999, '127.0.0.1', async () => {
      const taken = await isPortFree(45999, '127.0.0.1');
      assert.equal(taken, false);
      srv.close(() => resolve());
    });
  });
});

test('allocatePort skips taken set', async () => {
  const taken = new Set([45000, 45001]);
  const p = await allocatePort({ start: 45000, end: 45010, taken });
  assert.ok(p >= 45002 && p <= 45010);
  assert.ok(!taken.has(p));
});
