// Running from an installed package is a different world from a git checkout.
// ---------------------------------------------------------------------------
// `npx @fervon/launchpad` unpacks into a node_modules cache directory. Two
// defaults that are right for a checkout become nonsense there:
//   - "scan the parent of my own folder" would scan `node_modules`;
//   - "write config.json next to my code" would write into a throwaway cache.
// So an installed package scans the CWD and keeps `.launchpad.json` in it.
// ---------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { isInstalledPackage, defaultProjectsRoot, defaultConfigPath, REPO_ROOT } from '../src/config.js';

const CHECKOUT = path.resolve('/home/dev/code/launchpad');
const INSTALLED = path.resolve('/home/dev/code/node_modules/@fervon/launchpad');

/** Run `fn` with the given env vars cleared, then restore them. */
function withoutEnv(names, fn) {
  const saved = {};
  for (const n of names) {
    saved[n] = process.env[n];
    delete process.env[n];
  }
  try {
    return fn();
  } finally {
    for (const n of names) {
      if (saved[n] === undefined) delete process.env[n];
      else process.env[n] = saved[n];
    }
  }
}

const ENVS = ['MISSION_CONTROL_PROJECTS_ROOT', 'MISSION_CONTROL_CONFIG'];

test('isInstalledPackage recognises a node_modules install', () => {
  assert.equal(isInstalledPackage(INSTALLED), true);
  assert.equal(isInstalledPackage(CHECKOUT), false);
  // Must match a whole path SEGMENT, not a substring: a project legitimately
  // called "my-node_modules-tool" is still a checkout.
  assert.equal(isInstalledPackage(path.resolve('/home/dev/my-node_modules-tool')), false);
  // The repo we are running these tests from is a checkout, by definition.
  assert.equal(isInstalledPackage(REPO_ROOT), false);
});

test('an installed package scans the CWD; a checkout scans its parent folder', () => {
  withoutEnv(ENVS, () => {
    assert.equal(defaultProjectsRoot(INSTALLED), path.resolve(process.cwd()));
    assert.equal(defaultProjectsRoot(CHECKOUT), path.resolve('/home/dev/code'));
  });
});

test('an installed package keeps its config in the projects folder, not in the cache', () => {
  withoutEnv(ENVS, () => {
    assert.equal(
      defaultConfigPath(INSTALLED),
      path.join(path.resolve(process.cwd()), '.launchpad.json'),
      'config must survive the throwaway npx directory'
    );
    assert.equal(defaultConfigPath(CHECKOUT), path.join(CHECKOUT, 'config.json'));
  });
});

test('the env vars win over both defaults', () => {
  withoutEnv(ENVS, () => {
    process.env.MISSION_CONTROL_PROJECTS_ROOT = path.resolve('/somewhere/else');
    process.env.MISSION_CONTROL_CONFIG = path.resolve('/tmp/mc.json');
    assert.equal(defaultProjectsRoot(INSTALLED), path.resolve('/somewhere/else'));
    assert.equal(defaultProjectsRoot(CHECKOUT), path.resolve('/somewhere/else'));
    assert.equal(defaultConfigPath(INSTALLED), path.resolve('/tmp/mc.json'));
    assert.equal(defaultConfigPath(CHECKOUT), path.resolve('/tmp/mc.json'));
  });
});
