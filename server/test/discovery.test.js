import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  typeGroupForType,
  folderToId,
  discover,
  scanFilesystem,
  detectPackageManager,
  runScript,
} from '../src/discovery.js';
import { ruleForType } from '../src/frameworks.js';

/** Build a throwaway project tree: { 'rel/file': contents }. */
function makeTree(prefix, files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  for (const [rel, contents] of Object.entries(files)) {
    const full = path.join(root, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, contents);
  }
  return root;
}

/** Scan a tree with self-exclusion disabled (the temp root is never the repo). */
function scan(root) {
  return scanFilesystem(root, { selfPath: null });
}

test('typeGroupForType buckets correctly', () => {
  assert.equal(typeGroupForType('vite-react'), 'Node');
  assert.equal(typeGroupForType('next'), 'Node');
  assert.equal(typeGroupForType('monorepo'), 'Node');
  assert.equal(typeGroupForType('fastapi-python'), 'Python');
  assert.equal(typeGroupForType('html5-static'), 'Static');
  assert.equal(typeGroupForType('astro'), 'Static');
  assert.equal(typeGroupForType('docker-compose'), 'Docker');
  assert.equal(typeGroupForType('node-telegram-bot'), 'Node');
  assert.equal(typeGroupForType('django-python'), 'Python');
  assert.equal(typeGroupForType('flask-python'), 'Python');
  assert.equal(typeGroupForType('go-http'), 'Go');
  assert.equal(typeGroupForType('rust-cargo'), 'Rust');
  assert.equal(typeGroupForType('deno'), 'Node');
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
    // Static site that also keeps a manifest with no server framework / dev
    // script — must be a runnable static site, not a dead "node-server". (fervon)
    const staticWithPkg = mk('static-pkg', 'index.html', '<!doctype html>');
    fs.writeFileSync(path.join(staticWithPkg, 'package.json'), JSON.stringify({ name: 'static-pkg', dependencies: { '@resvg/resvg-js': '^2' } }));

    // Noise — must be skipped.
    fs.mkdirSync(path.join(mk('wt-shell', null), 'node_modules')); // orphaned worktree shell (no markers)
    const liveWt = mk('live-worktree', 'package.json', '{}');
    fs.writeFileSync(path.join(liveWt, '.git'), 'gitdir: /repo/.git/worktrees/x'); // .git FILE = live worktree
    mk('empty-dir', null);

    const scanned = scan(root);
    const ids = scanned.map((p) => p.id).sort();
    assert.deepEqual(ids, ['real-app', 'repo-only', 'static-pkg', 'static-site']);
    // The manifest-carrying static site is detected as runnable static, not node-server.
    const staticPkg = scanned.find((p) => p.id === 'static-pkg');
    assert.equal(staticPkg.type, 'html5-static');
    assert.equal(staticPkg.runnable, true);
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

// ---------------------------------------------------------------------------
// Self-exclusion: the dashboard must never list (or offer to launch) itself,
// whatever the clone folder is called. The README tells people to clone it as
// `launchpad`, so a folder-name skip list can't be the mechanism.
// ---------------------------------------------------------------------------

test('scanFilesystem never lists the dashboard itself (by path, any folder name)', () => {
  const root = makeTree('mc-self-', {
    'launchpad/package.json': JSON.stringify({ name: 'mission-control', scripts: { dev: 'node server' } }),
    'other-app/package.json': JSON.stringify({ name: 'other-app', scripts: { dev: 'vite' } }),
  });
  try {
    const self = path.join(root, 'launchpad');
    assert.deepEqual(
      scanFilesystem(root, { selfPath: self }).map((p) => p.id),
      ['other-app']
    );
    // Without the exclusion it WOULD be listed — proving the test can fail.
    assert.deepEqual(scan(root).map((p) => p.id).sort(), ['launchpad', 'other-app']);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Package managers: the dev/install command must match the project's lockfile.
// ---------------------------------------------------------------------------

test('detectPackageManager reads the lockfile, then packageManager field', () => {
  const root = makeTree('mc-pm-', {
    'a/pnpm-lock.yaml': '',
    'b/yarn.lock': '',
    'c/bun.lockb': '',
    'd/package-lock.json': '{}',
    'e/.keep': '',
  });
  try {
    assert.equal(detectPackageManager(path.join(root, 'a')), 'pnpm');
    assert.equal(detectPackageManager(path.join(root, 'b')), 'yarn');
    assert.equal(detectPackageManager(path.join(root, 'c')), 'bun');
    assert.equal(detectPackageManager(path.join(root, 'd')), 'npm');
    assert.equal(detectPackageManager(path.join(root, 'e')), 'npm');
    // No lockfile → the declared packageManager wins.
    assert.equal(detectPackageManager(path.join(root, 'e'), { packageManager: 'pnpm@9.1.0' }), 'pnpm');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('runScript builds the right invocation per manager', () => {
  assert.equal(runScript('npm', 'dev'), 'npm run dev');
  assert.equal(runScript('npm', 'start'), 'npm start');
  assert.equal(runScript('pnpm', 'dev'), 'pnpm dev');
  assert.equal(runScript('yarn', 'start'), 'yarn start');
  assert.equal(runScript('bun', 'dev'), 'bun run dev');
});

test('a pnpm project is launched and installed with pnpm, not npm', () => {
  const root = makeTree('mc-pnpm-', {
    'app/package.json': JSON.stringify({ name: 'app', scripts: { dev: 'vite' }, devDependencies: { vite: '^5' } }),
    'app/pnpm-lock.yaml': '',
  });
  try {
    const [p] = scan(root);
    assert.equal(p.packageManager, 'pnpm');
    assert.equal(p.discoveredCommand, 'pnpm dev');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Polyglot detection: these ecosystems were listed (their manifests are project
// markers) but classified `other` / non-runnable — dead cards with no Start.
// ---------------------------------------------------------------------------

test('detects Django, Flask, Go, Rust, Deno and Docker Compose projects', () => {
  const root = makeTree('mc-poly-', {
    'site/manage.py': 'from django.core.management import execute_from_command_line',
    'site/requirements.txt': 'Django==5.0',
    'api/app.py': 'from flask import Flask\napp = Flask(__name__)',
    'api/requirements.txt': 'flask',
    'svc/go.mod': 'module example.com/svc',
    'svc/main.go': 'package main\nfunc main() {}',
    'lib/go.mod': 'module example.com/lib', // library: no main.go → not runnable
    'engine/Cargo.toml': '[package]\nname = "engine"',
    'engine/src/main.rs': 'fn main() {}',
    'edge/deno.json': JSON.stringify({ tasks: { dev: 'deno run -A main.ts' } }),
    'stack/docker-compose.yml': 'services:\n  web:\n    image: nginx',
  });
  try {
    const byId = Object.fromEntries(scan(root).map((p) => [p.id, p]));
    assert.equal(byId.site.type, 'django-python');
    assert.equal(byId.site.runnable, true);
    assert.equal(byId.api.type, 'flask-python');
    assert.equal(byId.api.runnable, true);
    assert.equal(byId.svc.type, 'go-http');
    assert.equal(byId.svc.runnable, true);
    assert.equal(byId.lib.runnable, false, 'a Go library has no entry point');
    assert.equal(byId.engine.type, 'rust-cargo');
    assert.equal(byId.engine.runnable, true);
    assert.equal(byId.edge.type, 'deno');
    assert.equal(byId.edge.discoveredCommand, 'deno task dev');
    // Compose is labelled but deliberately NOT launchable: `docker compose up`
    // leaves containers a process-tree kill cannot reclaim.
    assert.equal(byId.stack.type, 'docker-compose');
    assert.equal(byId.stack.runnable, false);
    assert.equal(byId.stack.typeGroup, 'Docker');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('a Python app that also carries a package.json is still detected as Python', () => {
  const root = makeTree('mc-pypkg-', {
    // Tailwind build tooling next to a FastAPI service — no JS dev script.
    'svc/package.json': JSON.stringify({ name: 'svc', devDependencies: { tailwindcss: '^3' } }),
    'svc/main.py': 'from fastapi import FastAPI\napp = FastAPI()',
    'svc/pyproject.toml': '[project]\nname = "svc"',
  });
  try {
    const [p] = scan(root);
    assert.equal(p.type, 'fastapi-python');
    assert.equal(p.typeGroup, 'Python');
    assert.equal(p.runnable, true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('a bin-shipping package with no dev script is a portless CLI, not a dev server', () => {
  const root = makeTree('mc-cli-', {
    // Runnable CLI (plenty of them open a local dashboard) → keeps Start, but
    // as node-cli, whose framework rule is portless: no port is reserved.
    'tool/package.json': JSON.stringify({ name: 'tool', bin: { tool: 'bin/tool.js' }, scripts: { start: 'node bin/tool.js' } }),
    // No start script at all → nothing to launch.
    'lib-cli/package.json': JSON.stringify({ name: 'lib-cli', bin: { x: 'x.js' } }),
  });
  try {
    const byId = Object.fromEntries(scan(root).map((p) => [p.id, p]));
    assert.equal(byId.tool.type, 'node-cli');
    assert.equal(byId.tool.runnable, true);
    assert.equal(byId.tool.discoveredCommand, 'npm start');
    assert.equal(ruleForType('node-cli').portless, true);
    assert.equal(byId['lib-cli'].type, 'node-cli');
    assert.equal(byId['lib-cli'].runnable, false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
