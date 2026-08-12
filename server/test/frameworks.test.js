import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ruleForType, parseCommand, buildSpawnArgs, FRAMEWORKS, DEFAULT_RULE } from '../src/frameworks.js';

test('parseCommand splits cmd and args with quotes', () => {
  assert.deepEqual(parseCommand('npm run dev'), { cmd: 'npm', args: ['run', 'dev'] });
  assert.deepEqual(parseCommand('uvicorn main:app --reload'), { cmd: 'uvicorn', args: ['main:app', '--reload'] });
  assert.deepEqual(parseCommand('node -e "console.log(1)"'), { cmd: 'node', args: ['-e', 'console.log(1)'] });
});

test('vite injects --port after a double dash + sets env', () => {
  const rule = ruleForType('vite-react');
  const { cmd, args, usedFlag } = buildSpawnArgs({ command: 'npm run dev', port: 4003, rule });
  assert.equal(cmd, 'npm');
  assert.deepEqual(args, ['run', 'dev', '--', '--port', '4003']);
  assert.equal(usedFlag, '--port');
});

test('next injects -p after double dash', () => {
  const rule = ruleForType('next');
  const { args } = buildSpawnArgs({ command: 'npm run dev', port: 4004, rule });
  assert.deepEqual(args, ['run', 'dev', '--', '-p', '4004']);
});

test('uvicorn injects --port without double dash (direct invocation)', () => {
  const rule = ruleForType('fastapi-python');
  const { cmd, args } = buildSpawnArgs({ command: 'uvicorn main:app --reload', port: 4011, rule });
  assert.equal(cmd, 'uvicorn');
  assert.deepEqual(args, ['main:app', '--reload', '--port', '4011']);
});

test('portless project gets no flag injection', () => {
  const rule = ruleForType('node-telegram-bot');
  const { args, usedFlag } = buildSpawnArgs({ command: 'npm run dev', port: 4007, rule, portless: true });
  assert.deepEqual(args, ['run', 'dev']);
  assert.equal(usedFlag, null);
});

test('per-project portFlag override wins over framework default', () => {
  const rule = ruleForType('vite-react');
  const { args } = buildSpawnArgs({ command: 'npm run dev', port: 4005, rule, portFlag: '--listen' });
  assert.ok(args.includes('--listen'));
  assert.ok(args.includes('4005'));
});

test('does not double-inject if flag already present', () => {
  const rule = ruleForType('next');
  const { args } = buildSpawnArgs({ command: 'npm run dev -- -p 9999', port: 4004, rule });
  assert.equal(args.filter((a) => a === '-p').length, 1);
});

test('unknown type falls back to DEFAULT_RULE (env-only)', () => {
  assert.equal(ruleForType('totally-unknown'), DEFAULT_RULE);
  const { usedFlag } = buildSpawnArgs({ command: 'npm run dev', port: 4000, rule: DEFAULT_RULE });
  assert.equal(usedFlag, null);
});

test('framework table has expected core entries', () => {
  for (const k of ['vite-react', 'next', 'fastapi-python', 'monorepo', 'html5-static']) {
    assert.ok(FRAMEWORKS[k], `missing framework ${k}`);
  }
});

test('lookspan launches the CLI (API + dashboard), not the bare Vite dev server', () => {
  // config.json used to run `npm --workspace @lookspan/dashboard run dev`, which
  // starts only the front-end: the UI came up with no API behind it, so every
  // panel sat empty and the project looked broken. The CLI serves both on one
  // port, which is the model this launcher assumes.
  const { projects } = JSON.parse(
    readFileSync(new URL('../../config.json', import.meta.url), 'utf8'),
  );
  const lookspan = projects.lookspan;
  assert.ok(lookspan, 'lookspan missing from config.json');
  assert.match(lookspan.command, /packages\/cli\/dist\/index\.js/);

  // `node` is not a package-manager wrapper, so no `--` separator may appear —
  // Node's parseArgs would treat everything after it as positional and the
  // port would be silently ignored.
  const rule = ruleForType('vite-react');
  const { cmd, args } = buildSpawnArgs({
    command: lookspan.command,
    port: lookspan.port,
    rule,
    portFlag: lookspan.portFlag,
  });
  assert.equal(cmd, 'node');
  assert.ok(!args.includes('--'), 'a `--` separator would break the port flag');
  assert.deepEqual(args.slice(-2), ['--port', String(lookspan.port)]);
});
