import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startWatcher } from '../src/watcher.js';

function mkTmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'mc-watch-'));
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test('watcher fires (debounced) when a top-level folder appears', async () => {
  const root = mkTmp();
  let calls = 0;
  let lastDiff = null;
  const w = startWatcher({
    root,
    debounceMs: 100,
    onChange: () => {
      calls++;
      return { added: ['new-proj'], removed: [], changed: [] };
    },
    onResult: (diff) => {
      lastDiff = diff;
    },
  });
  try {
    fs.mkdirSync(path.join(root, 'new-proj'));
    await sleep(400);
    assert.ok(calls >= 1, 'onChange should have been called');
    assert.deepEqual(lastDiff, { added: ['new-proj'], removed: [], changed: [] });
  } finally {
    w.close();
  }
});

test('watcher debounces a burst of changes into few onChange calls', async () => {
  const root = mkTmp();
  let calls = 0;
  const w = startWatcher({
    root,
    debounceMs: 150,
    onChange: () => {
      calls++;
      return { added: [], removed: [], changed: [] };
    },
    onResult: () => {},
  });
  try {
    for (let i = 0; i < 5; i++) {
      fs.mkdirSync(path.join(root, `p${i}`));
      // eslint-disable-next-line no-await-in-loop
      await sleep(20);
    }
    await sleep(400);
    // 5 rapid mkdirs within the debounce window → far fewer than 5 calls.
    assert.ok(calls <= 2, `expected debounced (<=2) calls, got ${calls}`);
  } finally {
    w.close();
  }
});

test('watcher.close stops further callbacks', async () => {
  const root = mkTmp();
  let calls = 0;
  const w = startWatcher({
    root,
    debounceMs: 50,
    onChange: () => {
      calls++;
      return { added: [], removed: [], changed: [] };
    },
    onResult: () => {},
  });
  w.close();
  fs.mkdirSync(path.join(root, 'late'));
  await sleep(200);
  assert.equal(calls, 0);
});
