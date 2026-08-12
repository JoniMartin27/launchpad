// Nested workspaces: `code/work/*` + `code/personal/*`.
// ---------------------------------------------------------------------------
// Only the immediate children of the root used to be scanned, so this extremely
// common layout produced an EMPTY dashboard with no explanation — the worst
// possible first impression, and entirely silent. Depth is now configurable,
// and a scan that finds nothing widens the search and says so.
// ---------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { scanFilesystem, scanWithFallback, discover } from '../src/discovery.js';
import { MAX_SCAN_DEPTH, DEFAULT_SETTINGS } from '../src/config.js';

/** Build a throwaway tree: { 'rel/file': contents }. */
function makeTree(prefix, files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  for (const [rel, contents] of Object.entries(files)) {
    const full = path.join(root, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, contents);
  }
  return root;
}

const pkg = (name) => JSON.stringify({ name, scripts: { dev: 'vite' }, devDependencies: { vite: '^5' } });

/** A `code/` root whose projects all live one level down. */
function nestedTree() {
  return makeTree('mc-depth-', {
    'work/api/package.json': pkg('api'),
    'work/dashboard/package.json': pkg('dashboard'),
    'personal/api/package.json': pkg('api'), // same folder name, different parent
    'personal/blog/index.html': '<!doctype html>',
  });
}

test('depth 1 finds nothing in a nested workspace (the bug)', () => {
  const root = nestedTree();
  try {
    assert.deepEqual(scanFilesystem(root, { selfPath: null, depth: 1 }), []);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('depth 2 finds them all, and nested ids do not collide', () => {
  const root = nestedTree();
  try {
    const found = scanFilesystem(root, { selfPath: null, depth: 2 });
    assert.deepEqual(
      found.map((p) => p.id).sort(),
      ['personal-api', 'personal-blog', 'work-api', 'work-dashboard'],
      'two folders both called "api" must not share an id'
    );
    // The display name keeps the trail so they can be told apart on screen.
    const names = found.map((p) => p.name).sort();
    assert.deepEqual(names, ['personal/api', 'personal/blog', 'work/api', 'work/dashboard']);
    // Detection still works normally at depth.
    assert.equal(found.find((p) => p.id === 'personal-blog').type, 'html5-static');
    assert.equal(found.find((p) => p.id === 'work-api').type, 'vite-react');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('a flat workspace keeps its plain ids at any depth (existing configs stay valid)', () => {
  const root = makeTree('mc-flat-', {
    'alpha/package.json': pkg('alpha'),
    'beta/package.json': pkg('beta'),
  });
  try {
    for (const depth of [1, 2, 3]) {
      assert.deepEqual(
        scanFilesystem(root, { selfPath: null, depth }).map((p) => p.id).sort(),
        ['alpha', 'beta'],
        `depth ${depth} must not rename top-level projects`
      );
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('a project folder is never descended into (a monorepo stays one card)', () => {
  const root = makeTree('mc-nodesc-', {
    // A real project that happens to contain project-shaped subfolders.
    'mono/package.json': JSON.stringify({ name: 'mono', workspaces: ['packages/*'], scripts: { dev: 'x' } }),
    'mono/packages/a/package.json': pkg('a'),
    'mono/packages/b/package.json': pkg('b'),
  });
  try {
    const found = scanFilesystem(root, { selfPath: null, depth: MAX_SCAN_DEPTH });
    assert.deepEqual(found.map((p) => p.id), ['mono']);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('an empty result widens the search instead of failing silently', () => {
  const root = nestedTree();
  try {
    const res = scanWithFallback(root, { selfPath: null, depth: 1 });
    assert.equal(res.projects.length, 4, 'must not give up at the configured depth');
    assert.equal(res.depthUsed, 2);
    assert.equal(res.warnings.length, 1, 'and it must SAY it widened the search');
    assert.match(res.warnings[0], /scanDepth/, 'the warning must name the setting that fixes it');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('the fallback stays quiet when the configured depth already worked', () => {
  const root = makeTree('mc-quiet-', { 'alpha/package.json': pkg('alpha') });
  try {
    const res = scanWithFallback(root, { selfPath: null, depth: 1 });
    assert.equal(res.projects.length, 1);
    assert.equal(res.depthUsed, 1);
    assert.deepEqual(res.warnings, []);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('a genuinely empty root reports nothing and no bogus warning', () => {
  const root = makeTree('mc-empty-', { 'not-a-project/notes.txt': 'hola' });
  try {
    const res = scanWithFallback(root, { selfPath: null, depth: 1 });
    assert.deepEqual(res.projects, []);
    assert.deepEqual(res.warnings, []);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('discover() surfaces the widened-search warning and assigns ports to nested projects', () => {
  const root = nestedTree();
  try {
    const { projects, warnings } = discover({
      settings: { ...DEFAULT_SETTINGS, projectsRoot: root, autoScan: true, scanDepth: 1 },
      projects: {},
    });
    assert.equal(projects.length, 4);
    assert.ok(
      warnings.some((w) => /scanDepth/.test(w)),
      'the API must carry the explanation, not just the console'
    );
    const ports = projects.map((p) => p.assignedPort);
    assert.equal(new Set(ports).size, 4, 'nested projects still get unique ports');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('scanDepth is clamped to the supported range', () => {
  const root = nestedTree();
  try {
    // 0 or nonsense → 1 (no accidental deep walk); huge → the ceiling.
    assert.deepEqual(scanFilesystem(root, { selfPath: null, depth: 0 }), []);
    assert.equal(scanFilesystem(root, { selfPath: null, depth: 99 }).length, 4);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('the widened depth must be persisted, or one loose project hides all the nested ones', () => {
  const root = nestedTree();
  try {
    // A single project at the top level makes depth 1 non-empty…
    fs.mkdirSync(path.join(root, 'loose'));
    fs.writeFileSync(path.join(root, 'loose', 'index.html'), '<!doctype html>');

    // …so the fallback no longer fires, and on its own it would show ONLY that
    // one, silently dropping the four nested projects from the grid.
    const naive = scanWithFallback(root, { selfPath: null, depth: 1 });
    assert.deepEqual(naive.projects.map((p) => p.id), ['loose']);

    // With the depth that discovery previously settled on, everything coexists.
    // This is why `rediscover` writes depthUsed back into settings instead of
    // recomputing the fallback on every scan.
    const settled = scanWithFallback(root, { selfPath: null, depth: 2 });
    assert.deepEqual(
      settled.projects.map((p) => p.id).sort(),
      ['loose', 'personal-api', 'personal-blog', 'work-api', 'work-dashboard']
    );
    assert.deepEqual(settled.warnings, [], 'no warning once the depth is settled');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
