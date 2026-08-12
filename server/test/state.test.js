// Adopting what a previous run left behind — and refusing to adopt the wrong
// thing, which is the dangerous half.
// ---------------------------------------------------------------------------
// An orderly shutdown kills the children. A hard kill of the dashboard does
// not: the dev servers survive, and the next boot used to show them as
// "stopped", refuse to start them (`PORT_IN_USE: in use by a foreign process`)
// and offer no way to stop what it did not know it owned.
//
// Adoption fixes that, but it can only ever be as safe as its evidence: pids
// are recycled — aggressively on Windows — so "the pid is alive" is not proof
// that the process is ours. Adopting the wrong one would hand the Stop button a
// stranger's process to kill.
// ---------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadState, saveState, reconcile, stateFileFor, STATE_VERSION } from '../src/state.js';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'mc-state-'));

/** Probes that say yes to everything, unless told otherwise. */
function probes({ alive = () => true, bound = () => true } = {}) {
  return { isAlive: alive, isPortBound: async (p) => bound(p) };
}

const entry = (over = {}) => ({ id: 'app', pid: 1234, port: 4001, command: 'npm run dev', ...over });

test('the state file sits beside the config, whichever config that is', () => {
  assert.equal(stateFileFor('/code/launchpad/config.json'), path.join('/code/launchpad', '.launchpad-state.json'));
  assert.equal(stateFileFor('/code/.launchpad.json'), path.join('/code', '.launchpad-state.json'));
});

test('a round trip preserves what was running', () => {
  const dir = tmp();
  const file = path.join(dir, '.launchpad-state.json');
  try {
    assert.deepEqual(loadState(file).running, [], 'a missing file means nothing was running');
    assert.equal(saveState(file, [entry()]), true);
    assert.deepEqual(loadState(file).running, [entry()]);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('a corrupt, empty or foreign state file never stops the dashboard booting', () => {
  const dir = tmp();
  const file = path.join(dir, '.launchpad-state.json');
  try {
    for (const contents of ['', 'not json at all', '{}', '[]', 'null']) {
      fs.writeFileSync(file, contents);
      assert.deepEqual(loadState(file).running, [], `"${contents}" should degrade to empty`);
    }
    // A file from a future (or past) shape is ignored rather than misread.
    fs.writeFileSync(file, JSON.stringify({ version: STATE_VERSION + 1, running: [entry()] }));
    assert.deepEqual(loadState(file).running, []);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('saving into a place that cannot be written is a degradation, not a crash', () => {
  const missingDir = path.join(tmp(), 'does', 'not', 'exist');
  assert.equal(saveState(path.join(missingDir, 's.json'), [entry()]), false);
});

test('a process is adopted only when it is alive AND still holds its port', async () => {
  const { adopt, drop } = await reconcile([entry()], probes());
  assert.deepEqual(adopt, [entry()]);
  assert.deepEqual(drop, []);

  const dead = await reconcile([entry()], probes({ alive: () => false }));
  assert.deepEqual(dead.adopt, []);
  assert.match(dead.drop[0].reason, /gone/);
});

test('a recycled pid is NOT adopted: alive is not proof of identity', async () => {
  // The classic hazard: the process died, the OS handed its number to something
  // else, and that something else is very much alive. The port is what tells
  // them apart — nothing is listening on ours any more.
  const { adopt, drop } = await reconcile([entry()], probes({ alive: () => true, bound: () => false }));
  assert.deepEqual(adopt, [], 'a live pid that no longer serves the port must be dropped');
  assert.match(drop[0].reason, /no longer served/);
});

test('portless projects are never adopted, on purpose', async () => {
  // A bot or CLI binds nothing, so there is no evidence at all that the pid is
  // still ours. Forgetting it is the honest choice; claiming it is not.
  const { adopt, drop } = await reconcile([entry({ portless: true })], probes());
  assert.deepEqual(adopt, []);
  assert.match(drop[0].reason, /cannot prove/);

  const noPort = await reconcile([entry({ port: null })], probes());
  assert.deepEqual(noPort.adopt, []);
});

test('malformed entries are dropped without taking the good ones with them', async () => {
  const saved = [null, { id: 'x' }, { pid: 5 }, entry({ id: 'good', pid: 7, port: 4002 })];
  const { adopt, drop } = await reconcile(saved, probes());
  assert.deepEqual(adopt.map((e) => e.id), ['good']);
  assert.equal(drop.length, 3);
});

test('each entry is judged on its own port, not the first one', async () => {
  const checked = [];
  const { adopt } = await reconcile(
    [entry({ id: 'a', pid: 1, port: 4001 }), entry({ id: 'b', pid: 2, port: 4002 })],
    probes({
      bound: (p) => {
        checked.push(p);
        return p === 4002; // only b is still serving
      },
    })
  );
  assert.deepEqual(checked, [4001, 4002]);
  assert.deepEqual(adopt.map((e) => e.id), ['b']);
});
