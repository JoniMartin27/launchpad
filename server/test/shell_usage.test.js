// Where a shell is allowed to appear, and nowhere else.
// ---------------------------------------------------------------------------
// `shell: true` makes Node concatenate arguments into a shell string WITHOUT
// escaping them (DEP0190). That is fine for a dev command the user configured —
// those legitimately contain `&&` and pipes — and a disaster for anything
// derived from the filesystem: a project folder called `demo & whoami` ran
// `whoami` when opened, until #24.
//
// This test is the guard rail that keeps the distinction. Adding a shell to a
// new code path fails it, which forces whoever does it to say why in this list.
// A comment in SECURITY.md alone would not have stopped the original bug.
// ---------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'src');

// file → how many `shell: true` it may contain, and why.
const ALLOWED = {
  // 1. the dev command (from the project's package.json or the user's config)
  // 2. the dependency installer (npm/pnpm/yarn/bun, chosen by us)
  // Both are commands a user could have typed; neither is a filesystem value.
  'launcher.js': 2,
};

/** Every .js file under server/src, recursively. */
function sources(dir = SRC, out = []) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) sources(p, out);
    else if (ent.name.endsWith('.js')) out.push(p);
  }
  return out;
}

test('a shell is only spawned where the command came from the user', () => {
  const offenders = [];
  for (const file of sources()) {
    const name = path.basename(file);
    const text = fs.readFileSync(file, 'utf8');
    // Count real uses, not the word inside a comment or a doc block.
    const hits = text
      .split('\n')
      .filter((line) => !line.trimStart().startsWith('//') && !line.trimStart().startsWith('*'))
      .filter((line) => /shell:\s*true/.test(line)).length;
    if (!hits) continue;
    const budget = ALLOWED[name] ?? 0;
    if (hits !== budget) {
      offenders.push(`${name}: ${hits} use(s) of \`shell: true\`, allowed ${budget}`);
    }
  }

  assert.deepEqual(
    offenders,
    [],
    'A new `shell: true` appeared (or a documented one vanished). If the command comes ' +
      'from the user config or a project manifest, add it to ALLOWED here and to ' +
      'SECURITY.md. If it interpolates a path or any other filesystem value, it must ' +
      'not use a shell at all — that is the bug #24 fixed.'
  );
});

test('the opener never uses a shell, whatever else changes', () => {
  const text = fs.readFileSync(path.join(SRC, 'opener.js'), 'utf8');
  // Ignore comments: the file's own header quotes the vulnerable line it
  // replaced, which is documentation, not a use.
  const code = text
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('//') && !line.trimStart().startsWith('*'))
    .join('\n');
  assert.ok(!/shell:\s*true/.test(code), 'opener.js must never spawn through a shell');
  // And it must keep saying so out loud, so callers cannot pass it by accident.
  assert.ok(/shell: false/.test(code), 'opener.js should state shell:false explicitly');
});
