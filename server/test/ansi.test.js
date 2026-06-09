import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stripAnsi, makeAnsiStripper } from '../src/ansi.js';

const ESC = '';

test('stripAnsi removes SGR color codes', () => {
  const dirty = `${ESC}[44m${ESC}[1mLocal: http://localhost:4003${ESC}[0m`;
  assert.equal(stripAnsi(dirty), 'Local: http://localhost:4003');
});

test('stripAnsi leaves plain text untouched', () => {
  assert.equal(stripAnsi('listening on port 4003\n'), 'listening on port 4003\n');
});

test('stripAnsi handles VITE-style colored ready line', () => {
  const dirty = `${ESC}[32mVITE v5${ESC}[39m ready in 612 ms`;
  assert.equal(stripAnsi(dirty), 'VITE v5 ready in 612 ms');
});

test('makeAnsiStripper does not eat trailing digits (no false partial)', () => {
  const strip = makeAnsiStripper();
  assert.equal(strip('serving on 4003\n'), 'serving on 4003\n');
});

test('makeAnsiStripper joins an escape split across two chunks', () => {
  const strip = makeAnsiStripper();
  // ESC + "[" arrives, then "32m" completes the sequence in the next chunk.
  const a = strip(`ready ${ESC}[`);
  const b = strip('32mGREEN done');
  assert.equal(a, 'ready ');
  assert.equal(b, 'GREEN done');
});

test('makeAnsiStripper keeps streams independent across calls', () => {
  const strip = makeAnsiStripper();
  // A complete sequence in one chunk is stripped immediately.
  assert.equal(strip(`x${ESC}[0my`), 'xy');
});

test('stripAnsi is idempotent', () => {
  const dirty = `${ESC}[31merror${ESC}[0m`;
  assert.equal(stripAnsi(stripAnsi(dirty)), 'error');
});
