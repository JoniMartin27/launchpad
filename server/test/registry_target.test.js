// Which registry does a project publish to?
// ---------------------------------------------------------------------------
// This used to be a lookup table of the author's own projects (`lookspan` → npm,
// `inferbench` → PyPI) plus a guess: every Python project was assumed to be
// published on PyPI under its folder name. In a package other people now
// install, that means a version badge for somebody else's package — or for one
// that does not exist. The answer must come from the project's own manifest.
// ---------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { registryTarget } from '../src/metrics.js';

/** Make a project dir with the given files and return a project-shaped object. */
function project(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-reg-'));
  for (const [name, contents] of Object.entries(files)) {
    fs.writeFileSync(path.join(dir, name), contents);
  }
  return { id: path.basename(dir), path: dir, _cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

test('an npm package is read from its own package.json name, scope included', () => {
  const p = project({ 'package.json': JSON.stringify({ name: '@fervon/launchpad', version: '1.1.0' }) });
  try {
    assert.deepEqual(registryTarget(p), { kind: 'npm', name: '@fervon/launchpad' });
  } finally {
    p._cleanup();
  }
});

test('a private package is never looked up', () => {
  const p = project({ 'package.json': JSON.stringify({ name: 'secret-app', private: true }) });
  try {
    assert.deepEqual(registryTarget(p), { kind: 'none', name: null });
  } finally {
    p._cleanup();
  }
});

test('a PyPI name comes from pyproject.toml, not from the folder name', () => {
  const p = project({ 'pyproject.toml': '[project]\nname = "my-real-package"\nversion = "0.2.0"\n' });
  try {
    // The folder is a random temp name; guessing from it would query nonsense.
    assert.deepEqual(registryTarget(p), { kind: 'pypi', name: 'my-real-package' });
  } finally {
    p._cleanup();
  }
});

test('a legacy setup.py name is honoured too', () => {
  const p = project({ 'setup.py': 'from setuptools import setup\nsetup(name="legacy-pkg", version="1.0")\n' });
  try {
    assert.deepEqual(registryTarget(p), { kind: 'pypi', name: 'legacy-pkg' });
  } finally {
    p._cleanup();
  }
});

test('a Python project that declares no name gets no badge, rather than a wrong one', () => {
  const p = project({ 'requirements.txt': 'fastapi\n', 'main.py': 'from fastapi import FastAPI\n' });
  try {
    // The old code returned { pypi, <folder name> } here and queried PyPI for a
    // package the user never published.
    assert.deepEqual(registryTarget(p), { kind: 'none', name: null });
  } finally {
    p._cleanup();
  }
});

test('a project with no manifest at all is not attributed to any registry', () => {
  const p = project({ 'index.html': '<!doctype html>' });
  try {
    assert.deepEqual(registryTarget(p), { kind: 'none', name: null });
  } finally {
    p._cleanup();
  }
});

test('no hardcoded project names survive in the resolver', () => {
  // A folder called `lookspan` or `inferbench` must be treated like any other:
  // the manifest decides, not the name.
  const p = project({ 'index.html': '<!doctype html>' });
  try {
    assert.deepEqual(registryTarget({ ...p, id: 'lookspan' }), { kind: 'none', name: null });
    assert.deepEqual(registryTarget({ ...p, id: 'inferbench' }), { kind: 'none', name: null });
  } finally {
    p._cleanup();
  }
});

test('a config override wins over the manifest (private workspace root case)', () => {
  // lookspan's root is `private: true` with workspaces; the published package is
  // a member. The manifest genuinely says "not published" — an override is the
  // only honest way to point the badge at the real package.
  const p = project({ 'package.json': JSON.stringify({ name: 'lookspan', private: true }) });
  try {
    assert.deepEqual(registryTarget(p), { kind: 'none', name: null }, 'without an override, private wins');
    assert.deepEqual(
      registryTarget({ ...p, registry: { kind: 'npm', name: 'lookspan' } }),
      { kind: 'npm', name: 'lookspan' }
    );
    // And an override can also silence a badge the manifest would produce.
    const pub = project({ 'package.json': JSON.stringify({ name: 'noisy' }) });
    try {
      assert.deepEqual(registryTarget({ ...pub, registry: { kind: 'none' } }), { kind: 'none', name: null });
    } finally {
      pub._cleanup();
    }
    // Junk overrides are ignored, not trusted.
    assert.deepEqual(registryTarget({ ...p, registry: { kind: 'npm' } }), { kind: 'none', name: null });
    assert.deepEqual(registryTarget({ ...p, registry: { kind: 'cpan', name: 'x' } }), { kind: 'none', name: null });
  } finally {
    p._cleanup();
  }
});
