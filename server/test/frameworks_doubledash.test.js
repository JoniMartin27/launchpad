import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ruleForType, buildSpawnArgs } from '../src/frameworks.js';

// pregon mc-bug fix: `--` must only be added for package-manager wrappers
// (npm/npx/yarn/pnpm). A bare binary like `next` must get the flag directly.

test('next via npm wrapper still injects -- -p <port>', () => {
  const rule = ruleForType('next');
  const { cmd, args } = buildSpawnArgs({ command: 'npm run dev', port: 4004, rule });
  assert.equal(cmd, 'npm');
  assert.deepEqual(args, ['run', 'dev', '--', '-p', '4004']);
});

test('bare `next dev` injects -p WITHOUT a -- separator', () => {
  const rule = ruleForType('next');
  const { cmd, args } = buildSpawnArgs({ command: 'next dev', port: 4004, rule });
  assert.equal(cmd, 'next');
  assert.deepEqual(args, ['dev', '-p', '4004']);
  assert.ok(!args.includes('--'), 'no bare -- for a direct binary');
});

test('bare vite binary gets --port with no double dash', () => {
  const rule = ruleForType('vite-react');
  const { cmd, args } = buildSpawnArgs({ command: 'vite', port: 4005, rule });
  assert.equal(cmd, 'vite');
  assert.deepEqual(args, ['--port', '4005']);
});

test('pnpm wrapper gets the -- separator', () => {
  const rule = ruleForType('vite-react');
  const { args } = buildSpawnArgs({ command: 'pnpm dev', port: 4005, rule });
  assert.ok(args.includes('--'), 'pnpm is a wrapper → needs --');
  assert.deepEqual(args, ['dev', '--', '--port', '4005']);
});

test('monorepo dashboard-targeted command propagates --port through one npm wrapper', () => {
  // lookspan fix: targeting the dashboard workspace directly means the single
  // npm wrapper forwards `-- --port <P>` to Vite (concurrently no longer
  // swallows it, because we bypass the top-level concurrently script).
  const rule = ruleForType('monorepo');
  const { cmd, args } = buildSpawnArgs({
    command: 'npm --workspace @lookspan/dashboard run dev',
    port: 4003,
    rule,
    portFlag: '--port',
  });
  assert.equal(cmd, 'npm');
  assert.deepEqual(args, ['--workspace', '@lookspan/dashboard', 'run', 'dev', '--', '--port', '4003']);
});

test('fastapi baseCommand now uses uv run uvicorn', () => {
  const rule = ruleForType('fastapi-python');
  assert.equal(rule.baseCommand, 'uv run uvicorn main:app --reload');
  // direct invocation, no -- separator, --port injected at the end
  const { cmd, args } = buildSpawnArgs({ command: rule.baseCommand, port: 4012, rule });
  assert.equal(cmd, 'uv');
  assert.deepEqual(args, ['run', 'uvicorn', 'main:app', '--reload', '--port', '4012']);
});
