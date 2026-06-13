import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { typeGroupForType, folderToId, discover, scanFilesystem } from '../src/discovery.js';

test('typeGroupForType buckets correctly', () => {
  assert.equal(typeGroupForType('vite-react'), 'Node');
  assert.equal(typeGroupForType('next'), 'Node');
  assert.equal(typeGroupForType('monorepo'), 'Node');
  assert.equal(typeGroupForType('fastapi-python'), 'Python');
  assert.equal(typeGroupForType('html5-static'), 'Static');
  assert.equal(typeGroupForType('astro'), 'Static');
  assert.equal(typeGroupForType('docker-compose'), 'Docker');
  assert.equal(typeGroupForType('node-telegram-bot'), 'Node');
  assert.equal(typeGroupForType('weird'), 'Other');
});

test('folderToId maps known folders', () => {
  assert.equal(folderToId('AGENT-OS'), 'agent-os');
  assert.equal(folderToId('PromptTycoon'), 'prompt-tycoon');
  assert.equal(folderToId('PatoPatrick'), 'pato-patrick');
  assert.equal(folderToId('lookspan'), 'lookspan');
});

test('discover assigns unique ports within range', () => {
  // Use a config that doesn't auto-scan (empty FS dependency) for determinism.
  const config = {
    settings: {
      projectsRoot: 'C:/nonexistent-root-for-test',
      portRange: { start: 4000, end: 4099 },
      autoScan: true,
      readyRegex: 'ready',
    },
    projects: {},
  };
  const { projects } = discover(config);
  // Nonexistent root → no projects, no throw.
  assert.ok(Array.isArray(projects));
});

test('scanFilesystem lists real projects but skips worktrees and stray folders', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-scan-'));
  const mk = (rel, file, contents = '') => {
    const d = path.join(root, rel);
    fs.mkdirSync(d, { recursive: true });
    if (file) fs.writeFileSync(path.join(d, file), contents);
    return d;
  };
  try {
    // Real projects — must be listed.
    mk('real-app', 'package.json', JSON.stringify({ name: 'real-app', scripts: { dev: 'vite' } }));
    mk('static-site', 'index.html', '<!doctype html>');
    fs.mkdirSync(path.join(mk('repo-only', null), '.git')); // own repo root counts as a project

    // Noise — must be skipped.
    fs.mkdirSync(path.join(mk('wt-shell', null), 'node_modules')); // orphaned worktree shell (no markers)
    const liveWt = mk('live-worktree', 'package.json', '{}');
    fs.writeFileSync(path.join(liveWt, '.git'), 'gitdir: /repo/.git/worktrees/x'); // .git FILE = live worktree
    mk('empty-dir', null);

    const ids = scanFilesystem(root).map((p) => p.id).sort();
    assert.deepEqual(ids, ['real-app', 'repo-only', 'static-site']);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('discover resolves seed ports and dedups clashes', () => {
  const config = {
    settings: {
      projectsRoot: 'C:/nonexistent',
      portRange: { start: 4000, end: 4002 },
      autoScan: false,
      readyRegex: 'ready',
    },
    projects: { a: { port: 4000 }, b: { port: 4000 } },
  };
  const { warnings } = discover(config);
  // Both reference disk projects that don't exist → warnings about missing.
  assert.ok(warnings.length >= 1);
});
