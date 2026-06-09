import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Catalog } from '../src/catalog.js';

const SETTINGS = { ringBytes: 4096, metricsTtlSec: 60 };

function base(id, extra = {}) {
  return {
    id,
    name: id,
    path: `C:/fake/${id}`,
    type: 'vite-react',
    typeGroup: 'Node',
    framework: 'Vite',
    repoUrl: null,
    runnable: true,
    command: 'npm run dev',
    hidden: false,
    assignedPort: 4000,
    defaultPort: 5173,
    subprojects: [],
    ...extra,
  };
}

test('setProjects reports added / removed / changed', () => {
  const cat = new Catalog(SETTINGS);
  let diff = cat.setProjects([base('a'), base('b')]);
  assert.deepEqual(diff.added.sort(), ['a', 'b']);
  assert.deepEqual(diff.removed, []);

  // remove b, add c, change a (different command).
  diff = cat.setProjects([base('a', { command: 'npm start' }), base('c')]);
  assert.deepEqual(diff.added, ['c']);
  assert.deepEqual(diff.removed, ['b']);
  assert.deepEqual(diff.changed, ['a']);
});

test('setProjects prunes runtime/rings/lastLog for vanished (dead) ids', () => {
  const cat = new Catalog(SETTINGS);
  cat.setProjects([base('a')]);
  cat.setRuntime('a', { status: 'stopped', pid: null, assignedPort: 4000 });
  cat.ensureRing('a').push('hello\n');
  cat.setLastLog('a', 'hello');
  cat.setRecentTail('a', 'hello');

  // 'a' disappears and is not alive → its maps are pruned.
  cat.setProjects([base('z')]);
  assert.equal(cat.getRuntime('a'), null);
  assert.equal(cat.getRing('a'), null);
  assert.equal(cat.lastLog.get('a'), undefined);
  assert.equal(cat.getRecentTail('a'), '');
});

test('setProjects KEEPS runtime for a vanished id whose process is alive', () => {
  const cat = new Catalog(SETTINGS);
  cat.setProjects([base('a')]);
  cat.setRuntime('a', { status: 'running', pid: 1234, assignedPort: 4000 });

  const diff = cat.setProjects([base('z')]);
  assert.ok(diff.removed.includes('a'));
  // Still tracked because the child is alive.
  assert.equal(cat.getRuntime('a')?.status, 'running');
  assert.ok(cat.warnings.some((w) => w.includes('still')));
});

test('toProject exposes needsInstall/installer/failureClass fields', () => {
  const cat = new Catalog(SETTINGS);
  // path does not exist on disk → installState sees no package.json → not needs-install
  cat.setProjects([base('a')]);
  const p = cat.toProject('a');
  assert.ok('needsInstall' in p);
  assert.ok('installer' in p);
  assert.ok('failureClass' in p);
  assert.ok('failureReason' in p);
  assert.ok('installing' in p);
});

test('failureClass reflects an error runtime reason', () => {
  const cat = new Catalog(SETTINGS);
  cat.setProjects([base('a')]);
  cat.setRuntime('a', { status: 'error', reason: 'needs the venv', failureClass: 'needs-env', exitCode: 1 });
  const p = cat.toProject('a');
  assert.equal(p.status, 'error');
  assert.equal(p.failureClass, 'needs-env');
  assert.equal(p.failureReason, 'needs the venv');
});
