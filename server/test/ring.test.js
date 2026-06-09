import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RingBuffer } from '../src/ring.js';

test('ring retains chunks under cap', () => {
  const r = new RingBuffer(100);
  r.push('hello\n');
  r.push('world\n');
  assert.deepEqual(r.snapshot(), ['hello\n', 'world\n']);
  assert.equal(r.droppedBytes, 0);
});

test('ring evicts oldest over cap', () => {
  const r = new RingBuffer(10);
  r.push('aaaaa'); // 5
  r.push('bbbbb'); // 10 total
  r.push('ccccc'); // evicts aaaaa
  assert.deepEqual(r.snapshot(), ['bbbbb', 'ccccc']);
  assert.equal(r.droppedBytes, 5);
});

test('ring truncates an oversize single chunk to its tail', () => {
  const r = new RingBuffer(4);
  r.push('abcdefgh');
  assert.deepEqual(r.snapshot(), ['efgh']);
  assert.equal(r.droppedBytes, 4);
});

test('lastLine returns last non-empty line', () => {
  const r = new RingBuffer(1000);
  r.push('first\nsecond\n');
  r.push('third\n\n');
  assert.equal(r.lastLine(), 'third');
});

test('snapshot tail limits entries', () => {
  const r = new RingBuffer(1000);
  r.push('a');
  r.push('b');
  r.push('c');
  assert.deepEqual(r.snapshot(2), ['b', 'c']);
});
