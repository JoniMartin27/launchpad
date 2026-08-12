// Bringing a crashed dev server back — and knowing when not to.
// ---------------------------------------------------------------------------
// The easy half is relaunching. The half that matters is refusing: a project
// that crashes on boot would be relaunched forever, burning CPU and filling the
// log with the same stack trace, and a dashboard that silently does that is
// worse than one that leaves a red card.
// ---------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  decideRestart,
  shouldForgiveAttempts,
  DEFAULT_MAX_ATTEMPTS,
  DEFAULT_HEALTHY_MS,
} from '../src/autorestart.js';

/** A crash of a project that had been up, with auto-restart switched on. */
const crash = (over = {}) => ({
  enabled: true,
  exitCode: 1,
  previousStatus: 'running',
  attempts: 0,
  ...over,
});

test('a crash of a running project is restarted, with a growing wait', () => {
  const first = decideRestart(crash());
  assert.equal(first.restart, true);
  assert.equal(first.delayMs, 1000);
  assert.match(first.reason, /crashed with code 1/);

  // 1s, 2s, 4s: a project that is going to fail anyway fails slowly.
  assert.equal(decideRestart(crash({ attempts: 1 })).delayMs, 2000);
  assert.equal(decideRestart(crash({ attempts: 2 })).delayMs, 4000);
});

test('it gives up after the configured number of attempts', () => {
  const done = decideRestart(crash({ attempts: DEFAULT_MAX_ATTEMPTS }));
  assert.equal(done.restart, false);
  assert.match(done.reason, /kept crashing/);

  // And the limit is configurable.
  assert.equal(decideRestart(crash({ attempts: 1, maxAttempts: 1 })).restart, false);
  assert.equal(decideRestart(crash({ attempts: 1, maxAttempts: 5 })).restart, true);
});

test('it never restarts what you stopped yourself', () => {
  const stopped = decideRestart(crash({ previousStatus: 'stopping', exitCode: 1 }));
  assert.equal(stopped.restart, false);
  assert.match(stopped.reason, /you stopped it/);
});

test('a project that never came up is not relaunched', () => {
  // That is a needs-install / needs-env problem. Relaunching loops over the
  // same missing dependency and buries the diagnosis the UI just made.
  const never = decideRestart(crash({ previousStatus: 'starting' }));
  assert.equal(never.restart, false);
  assert.match(never.reason, /never finished starting/);
});

test('a clean exit is not a crash', () => {
  // Portless CLIs and one-shot tasks finish all the time; restarting them would
  // turn "done" into an infinite loop.
  assert.equal(decideRestart(crash({ exitCode: 0 })).restart, false);
  assert.equal(decideRestart(crash({ exitCode: null })).restart, false);
  assert.match(decideRestart(crash({ exitCode: 0 })).reason, /exited cleanly/);
});

test('nothing happens unless the project asked for it', () => {
  const off = decideRestart(crash({ enabled: false }));
  assert.equal(off.restart, false);
  assert.match(off.reason, /off for this project/);
  // Even a textbook crash stays down when the flag is not set.
  assert.equal(decideRestart(crash({ enabled: false, exitCode: 137 })).restart, false);
});

test('the crash budget is forgiven once the project has stayed up a while', () => {
  const now = 1_000_000_000;
  // Up for a minute: two crashes a day apart are not a crash loop.
  assert.equal(shouldForgiveAttempts(now - DEFAULT_HEALTHY_MS, now), true);
  assert.equal(shouldForgiveAttempts(now - DEFAULT_HEALTHY_MS - 1, now), true);
  // Died almost immediately: that IS the loop we are guarding against.
  assert.equal(shouldForgiveAttempts(now - 5_000, now), false);
  assert.equal(shouldForgiveAttempts(null, now), false);
  // The window is configurable.
  assert.equal(shouldForgiveAttempts(now - 5_000, now, 1_000), true);
});
