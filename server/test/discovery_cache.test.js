// The detection cache must be fast AND never stale.
// ---------------------------------------------------------------------------
// Classifying a project reads and parses several files, and the watcher re-runs
// a full scan synchronously 750 ms after any change. Measured before the cache:
// 300 projects took 780 ms per scan (worst case 2.2 s) with the event loop
// blocked throughout.
//
// A cache that serves a stale command is worse than a slow scan — it would
// launch the wrong thing. These tests pin every way a project can change.
// ---------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { scanFilesystem, clearDetectCache, detectCacheSize } from '../src/discovery.js';

function makeRoot(prefix = 'mc-cache-') {
  clearDetectCache();
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

const scan = (root) => scanFilesystem(root, { selfPath: null });
const only = (root) => {
  const found = scan(root);
  assert.equal(found.length, 1, 'expected exactly one project');
  return found[0];
};

// A fixed timestamp both writes are pinned to. Restoring a captured mtime is
// not enough: utimesSync rounds, so the restored value differs by a fraction of
// a millisecond and the signature (correctly) sees a change.
const FROZEN = new Date('2026-01-01T00:00:00Z');

/** Write a file and pin its mtime, so the change is invisible to stat. */
function writeInvisibly(file, contents) {
  fs.writeFileSync(file, contents);
  fs.utimesSync(file, FROZEN, FROZEN);
}

test('an unchanged project is served from cache (proved by an invisible edit)', () => {
  const root = makeRoot();
  const dir = path.join(root, 'app');
  fs.mkdirSync(dir);
  const pkg = path.join(dir, 'package.json');
  // Two payloads of identical length, both pinned to the same mtime, so nothing
  // the signature looks at differs between them.
  writeInvisibly(pkg, JSON.stringify({ name: 'app', scripts: { dev: 'vite --aa' } }));
  try {
    assert.equal(only(root).discoveredCommand, 'npm run dev');

    // Rewrite it with NO dev/start script, byte-for-byte the same length (`dev`
    // and `run` are both three characters) and the same pinned mtime.
    writeInvisibly(pkg, JSON.stringify({ name: 'app', scripts: { run: 'vite --aa' } }));

    // Nothing observable changed, so the cached classification stands. This is
    // the point of the cache; it is also exactly the risk, hence the tests below.
    assert.equal(only(root).discoveredCommand, 'npm run dev', 'the cache was not used');

    // …and a real (visible) touch invalidates it.
    fs.utimesSync(pkg, new Date(), new Date(Date.now() + 1000));
    assert.equal(only(root).discoveredCommand, null, 'a touched manifest must be re-read');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('editing a manifest invalidates the entry', () => {
  const root = makeRoot();
  const dir = path.join(root, 'app');
  fs.mkdirSync(dir);
  const pkg = path.join(dir, 'package.json');
  fs.writeFileSync(pkg, JSON.stringify({ name: 'app', scripts: { dev: 'vite' }, devDependencies: { vite: '^5' } }));
  try {
    assert.equal(only(root).type, 'vite-react');
    fs.writeFileSync(pkg, JSON.stringify({ name: 'app', scripts: { dev: 'node s.js' }, dependencies: { express: '^4' } }));
    const after = only(root);
    assert.equal(after.type, 'express-node', 'a rewritten manifest must be re-classified');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('adding a lockfile switches the package manager', () => {
  const root = makeRoot();
  const dir = path.join(root, 'app');
  fs.mkdirSync(dir);
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'app', scripts: { dev: 'vite' } }));
  try {
    assert.equal(only(root).packageManager, 'npm');
    fs.writeFileSync(path.join(dir, 'pnpm-lock.yaml'), '');
    const after = only(root);
    assert.equal(after.packageManager, 'pnpm', 'a new lockfile must not be missed');
    assert.equal(after.discoveredCommand, 'pnpm dev');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('deleting a manifest re-classifies the project', () => {
  const root = makeRoot();
  const dir = path.join(root, 'app');
  fs.mkdirSync(dir);
  fs.writeFileSync(
    path.join(dir, 'package.json'),
    JSON.stringify({ name: 'app', scripts: { dev: 'vite' }, devDependencies: { vite: '^5' } })
  );
  fs.writeFileSync(path.join(dir, 'index.html'), '<!doctype html>');
  try {
    assert.equal(only(root).type, 'vite-react');
    fs.rmSync(path.join(dir, 'package.json'));
    assert.equal(only(root).type, 'html5-static', 'a deleted manifest must not be remembered');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('a Python project re-classifies when its dependencies change', () => {
  const root = makeRoot();
  const dir = path.join(root, 'svc');
  fs.mkdirSync(dir);
  const req = path.join(dir, 'requirements.txt');
  fs.writeFileSync(req, 'requests\n');
  try {
    assert.equal(only(root).type, 'python');
    fs.writeFileSync(req, 'fastapi\nuvicorn\n');
    assert.equal(only(root).type, 'fastapi-python', 'a Python manifest edit must be seen');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('a removed project is dropped from the cache instead of accumulating', () => {
  const root = makeRoot();
  for (const name of ['a', 'b', 'c']) {
    const d = path.join(root, name);
    fs.mkdirSync(d);
    fs.writeFileSync(path.join(d, 'index.html'), '<!doctype html>');
  }
  try {
    assert.equal(scan(root).length, 3);
    assert.equal(detectCacheSize(), 3);
    fs.rmSync(path.join(root, 'c'), { recursive: true, force: true });
    assert.equal(scan(root).length, 2);
    assert.equal(detectCacheSize(), 2, 'the cache must shrink with the workspace');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('two projects with the SAME signature never share a cache entry', () => {
  // The nasty case for any cache: two projects whose fingerprints collide.
  // Neither of these carries a file the signature stats, and both folders are
  // pinned to the same mtime — so their signatures are byte-identical. Only the
  // path keeps them apart. Key on anything else and one project is reported as
  // the other.
  const root = makeRoot();
  const a = path.join(root, 'a-static');
  const b = path.join(root, 'b-repo');
  fs.mkdirSync(a);
  fs.mkdirSync(b);
  fs.writeFileSync(path.join(a, 'index.html'), '<!doctype html>'); // → html5-static
  fs.mkdirSync(path.join(b, '.git')); // a bare repo root → 'other', not runnable
  fs.utimesSync(a, FROZEN, FROZEN);
  fs.utimesSync(b, FROZEN, FROZEN);
  try {
    for (const pass of ['first', 'second']) {
      const byId = Object.fromEntries(scan(root).map((p) => [p.id, p]));
      assert.equal(byId['a-static'].type, 'html5-static', `${pass} pass: static site`);
      assert.equal(byId['a-static'].runnable, true, `${pass} pass: static site is runnable`);
      assert.equal(byId['b-repo'].type, 'other', `${pass} pass: bare repo must not inherit a's type`);
      assert.equal(byId['b-repo'].runnable, false, `${pass} pass: bare repo is not runnable`);
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
