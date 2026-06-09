// diagnose.js
// ---------------------------------------------------------------------------
// Friendly failure classification (SPEC item 2). When a child exits non-zero
// before reaching `running`, or when we want to surface why a project can't
// start, we classify the blocker into one of a few human-meaningful buckets so
// the UI can show a helpful reason instead of a bare "error":
//
//   needs-install : dependencies missing (node_modules / venv absent, or a
//                   binary that should live in node_modules/.bin is "not
//                   recognized" / "command not found").
//   needs-env     : tooling/PATH/env blocker (uvicorn/python not on PATH,
//                   missing env var like a token, EADDRINUSE on a hardcoded
//                   internal port, ETELEGRAM auth, etc.).
//   needs-build   : a build/compile step must run first (e.g. "run `npm run
//                   build`", missing dist/.next output).
//   error         : unclassified non-zero exit.
//
// Pure functions, no side effects — easy to unit test.
// ---------------------------------------------------------------------------

import fs from 'node:fs';
import path from 'node:path';

/**
 * Inspect a project's folder to see whether its dependencies appear installed.
 * For Node projects: node_modules must exist AND (if the resolved command is a
 * bare wrapper-installed binary) node_modules/.bin should be populated. For
 * Python (fastapi) projects: a venv (.venv / venv) is the install marker.
 *
 * @param {object} project  merged project model (has path, cwd, type, typeGroup)
 * @returns {{ needsInstall: boolean, installer: 'npm'|'uv'|null, reason: string|null }}
 */
export function installState(project) {
  const dir = project.cwd || project.path;
  if (!dir) return { needsInstall: false, installer: null, reason: null };

  const isPython =
    project.typeGroup === 'Python' ||
    project.type === 'fastapi-python' ||
    project.type?.includes('python');

  if (isPython) {
    const hasVenv =
      dirExists(path.join(dir, '.venv')) || dirExists(path.join(dir, 'venv'));
    if (!hasVenv) {
      return {
        needsInstall: true,
        installer: 'uv',
        reason: 'Python venv missing — run `uv sync` (or create backend/.venv).',
      };
    }
    return { needsInstall: false, installer: 'uv', reason: null };
  }

  // Node-ish project: only meaningful if it actually has a package.json.
  if (!fileExists(path.join(dir, 'package.json'))) {
    return { needsInstall: false, installer: null, reason: null };
  }
  const nm = path.join(dir, 'node_modules');
  if (!dirExists(nm)) {
    return {
      needsInstall: true,
      installer: 'npm',
      reason: 'node_modules missing — run `npm install`.',
    };
  }
  // node_modules exists but .bin is empty ⇒ an incomplete/partial install
  // (the agent-os case: 668 pkgs present but .bin/concurrently absent).
  const bin = path.join(nm, '.bin');
  if (dirExists(bin) && isEmptyDir(bin)) {
    return {
      needsInstall: true,
      installer: 'npm',
      reason: 'node_modules/.bin is empty — incomplete install; run `npm install`.',
    };
  }
  return { needsInstall: false, installer: 'npm', reason: null };
}

/**
 * Classify a failed start from its exit code + recent (ANSI-stripped) log tail
 * and the project's on-disk install state.
 *
 * @param {object} args
 * @param {object} args.project   merged project model
 * @param {number|null} args.exitCode
 * @param {string} [args.logTail] recent clean stdout/stderr text
 * @returns {{ status: 'needs-install'|'needs-env'|'needs-build'|'error',
 *             reason: string }}
 */
export function classifyFailure({ project, exitCode, logTail = '' }) {
  const tail = String(logTail || '').toLowerCase();

  // "X no se reconoce…" (es) / "X is not recognized…" / "command not found".
  const notRecognized =
    /no se reconoce|is not recognized|command not found|not found/.test(tail);

  // 1. Missing dependencies (on-disk check is the strongest signal).
  const inst = installState(project);
  if (inst.needsInstall) {
    return { status: 'needs-install', reason: inst.reason };
  }

  // 2. A "not recognized" binary that lives in node_modules/.bin but the wrapper
  //    wasn't used → still an install/PATH problem. If node_modules exists,
  //    treat as needs-install (partial install); otherwise needs-env.
  if (notRecognized) {
    // Python tooling not on PATH (uvicorn / python) → needs-env.
    if (/uvicorn|python|uv\b/.test(tail)) {
      return {
        status: 'needs-env',
        reason: 'Python tooling not found on PATH — this project needs its venv (uv run).',
      };
    }
    // Otherwise a JS binary missing → most often an incomplete install.
    return {
      status: 'needs-install',
      reason: 'A dev dependency binary was not found — run `npm install`.',
    };
  }

  // 3. Needs a build step first.
  if (/run `?npm run build`?|did you mean .*build|no production build|\.next.*not found|run "build"/.test(tail)) {
    return {
      status: 'needs-build',
      reason: 'A build step is required first — run `npm run build`.',
    };
  }

  // 4. Env blockers: missing tokens / hardcoded port collisions / auth.
  if (/eaddrinuse/.test(tail)) {
    return {
      status: 'needs-env',
      reason: 'A port is already in use by another process (check for a stale/duplicate instance).',
    };
  }
  if (/etelegram|telegram_bot_token|invalid token|unauthorized|401/.test(tail)) {
    return {
      status: 'needs-env',
      reason: 'Authentication failed — check the required token/env var.',
    };
  }
  if (/missing env|environment variable|\.env/.test(tail)) {
    return {
      status: 'needs-env',
      reason: 'A required environment variable is missing — check the project .env.',
    };
  }

  // 5. Fallback: unclassified non-zero exit.
  return {
    status: 'error',
    reason: exitCode != null ? `exited with code ${exitCode} during start` : 'failed to start',
  };
}

// --- small fs helpers (never throw) ---------------------------------------

function dirExists(p) {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}
function fileExists(p) {
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
}
function isEmptyDir(p) {
  try {
    return fs.readdirSync(p).length === 0;
  } catch {
    return true;
  }
}
