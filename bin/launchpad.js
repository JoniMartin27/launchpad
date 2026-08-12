#!/usr/bin/env node
// Mission Control CLI entry point (`npx @fervon/launchpad`).
// ---------------------------------------------------------------------------
// Parses a handful of flags into the env vars the server already understands,
// then hands over to it. The server binds 127.0.0.1 and boots on import.
// ---------------------------------------------------------------------------

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PKG = JSON.parse(fs.readFileSync(path.join(HERE, '..', 'package.json'), 'utf8'));

const USAGE = `
  launchpad — one screen for every dev project in a folder

  Usage
    $ npx @fervon/launchpad [options]

  Run it from the folder that holds your projects. It scans that folder,
  works out how to start each project from its own files, and runs them on
  collision-free ports. Local only: it binds 127.0.0.1 and nothing else.

  Options
    -p, --port <n>    Port for the dashboard itself       (default: 7777)
    -r, --root <dir>  Folder to scan for projects         (default: cwd)
    -c, --config <f>  Config file to use          (default: <root>/.launchpad.json)
    -v, --version     Print the version and exit
    -h, --help        Show this help

  Environment
    MISSION_CONTROL_PORT, MISSION_CONTROL_PROJECTS_ROOT, MISSION_CONTROL_CONFIG
    (flags win over env vars)

  Docs  https://github.com/JoniMartin27/launchpad
`;

/** Read the value that follows a flag, or exit with a clear message. */
function valueFor(argv, i, flag) {
  const v = argv[i + 1];
  if (v === undefined || v.startsWith('-')) {
    console.error(`launchpad: ${flag} needs a value`);
    process.exit(2);
  }
  return v;
}

const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) {
  const arg = argv[i];
  switch (arg) {
    case '-h':
    case '--help':
      console.log(USAGE);
      process.exit(0);
      break;
    case '-v':
    case '--version':
      console.log(PKG.version);
      process.exit(0);
      break;
    case '-p':
    case '--port': {
      const port = Number(valueFor(argv, i++, arg));
      if (!Number.isInteger(port) || port < 1 || port > 65535) {
        console.error(`launchpad: ${arg} must be a port number between 1 and 65535`);
        process.exit(2);
      }
      process.env.MISSION_CONTROL_PORT = String(port);
      break;
    }
    case '-r':
    case '--root':
      process.env.MISSION_CONTROL_PROJECTS_ROOT = path.resolve(valueFor(argv, i++, arg));
      break;
    case '-c':
    case '--config':
      process.env.MISSION_CONTROL_CONFIG = path.resolve(valueFor(argv, i++, arg));
      break;
    default:
      console.error(`launchpad: unknown option "${arg}"\n${USAGE}`);
      process.exit(2);
  }
}

const root = process.env.MISSION_CONTROL_PROJECTS_ROOT || process.cwd();
if (!fs.existsSync(root)) {
  console.error(`launchpad: projects folder not found: ${root}`);
  process.exit(1);
}
console.log(`[launchpad] v${PKG.version} — scanning ${root}`);

// The server boots on import (top-level await inside).
await import('../server/src/index.js');
