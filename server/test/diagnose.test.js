import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { classifyFailure, installState } from '../src/diagnose.js';

function mkTmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'mc-diag-'));
}

test('installState: Node project with no node_modules → needs-install (npm)', () => {
  const dir = mkTmp();
  fs.writeFileSync(path.join(dir, 'package.json'), '{}');
  const r = installState({ id: 'x', path: dir, type: 'vite-react', typeGroup: 'Node' });
  assert.equal(r.needsInstall, true);
  assert.equal(r.installer, 'npm');
});

test('installState: Node project with populated node_modules/.bin → ok', () => {
  const dir = mkTmp();
  fs.writeFileSync(path.join(dir, 'package.json'), '{}');
  fs.mkdirSync(path.join(dir, 'node_modules', '.bin'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'node_modules', '.bin', 'vite'), '');
  const r = installState({ id: 'x', path: dir, type: 'vite-react', typeGroup: 'Node' });
  assert.equal(r.needsInstall, false);
});

test('installState: node_modules present but .bin empty → needs-install (partial)', () => {
  const dir = mkTmp();
  fs.writeFileSync(path.join(dir, 'package.json'), '{}');
  fs.mkdirSync(path.join(dir, 'node_modules', '.bin'), { recursive: true });
  const r = installState({ id: 'x', path: dir, type: 'monorepo', typeGroup: 'Node' });
  assert.equal(r.needsInstall, true);
  assert.equal(r.installer, 'npm');
});

test('installState: Python project without venv → needs-install (uv)', () => {
  const dir = mkTmp();
  const r = installState({ id: 'x', path: dir, type: 'fastapi-python', typeGroup: 'Python' });
  assert.equal(r.needsInstall, true);
  assert.equal(r.installer, 'uv');
});

test('installState: Python project with .venv → ok', () => {
  const dir = mkTmp();
  fs.mkdirSync(path.join(dir, '.venv'));
  const r = installState({ id: 'x', path: dir, type: 'fastapi-python', typeGroup: 'Python' });
  assert.equal(r.needsInstall, false);
});

test('classifyFailure: missing node_modules wins → needs-install', () => {
  const dir = mkTmp();
  fs.writeFileSync(path.join(dir, 'package.json'), '{}');
  const r = classifyFailure({
    project: { id: 'x', path: dir, type: 'vite-react', typeGroup: 'Node' },
    exitCode: 1,
    logTail: 'some output',
  });
  assert.equal(r.status, 'needs-install');
});

test('classifyFailure: uvicorn not recognized → needs-env', () => {
  const dir = mkTmp();
  // venv present so installState does not short-circuit to needs-install.
  fs.mkdirSync(path.join(dir, '.venv'));
  const r = classifyFailure({
    project: { id: 'inferbench-backend', path: dir, type: 'fastapi-python', typeGroup: 'Python' },
    exitCode: 1,
    logTail: '"uvicorn" no se reconoce como un comando interno o externo',
  });
  assert.equal(r.status, 'needs-env');
});

test('classifyFailure: bare next not recognized (deps installed) → needs-install', () => {
  const dir = mkTmp();
  fs.writeFileSync(path.join(dir, 'package.json'), '{}');
  fs.mkdirSync(path.join(dir, 'node_modules', '.bin'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'node_modules', '.bin', 'next'), '');
  const r = classifyFailure({
    project: { id: 'pregon', path: dir, type: 'next', typeGroup: 'Node' },
    exitCode: 1,
    logTail: '"next" no se reconoce como un comando interno o externo',
  });
  assert.equal(r.status, 'needs-install');
});

test('classifyFailure: EADDRINUSE → needs-env', () => {
  const dir = mkTmp();
  fs.writeFileSync(path.join(dir, 'package.json'), '{}');
  fs.mkdirSync(path.join(dir, 'node_modules', '.bin'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'node_modules', '.bin', 'x'), '');
  const r = classifyFailure({
    project: { id: 'quick-capture', path: dir, type: 'node-telegram-bot', typeGroup: 'Node' },
    exitCode: 1,
    logTail: 'web error: listen EADDRINUSE 0.0.0.0:7070',
  });
  assert.equal(r.status, 'needs-env');
});

test('classifyFailure: unclassified non-zero → error', () => {
  const dir = mkTmp();
  fs.writeFileSync(path.join(dir, 'package.json'), '{}');
  fs.mkdirSync(path.join(dir, 'node_modules', '.bin'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'node_modules', '.bin', 'x'), '');
  const r = classifyFailure({
    project: { id: 'x', path: dir, type: 'vite-react', typeGroup: 'Node' },
    exitCode: 7,
    logTail: 'kaboom unexpected internal panic',
  });
  assert.equal(r.status, 'error');
  assert.match(r.reason, /code 7/);
});
