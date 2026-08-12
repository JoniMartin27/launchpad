// discovery.js  (a.k.a. scanner)
// ---------------------------------------------------------------------------
// Hybrid discovery (SPEC §8):
//   1. Scan immediate child dirs of projectsRoot; detect framework/type.
//   2. Deep-merge config.json per-project overrides over the discovered base.
//   3. Resolve assignedPort (override → seed map → first free), unique.
//   4. Emit base Project[] (runtime fields are layered on later by the catalog).
//
// This module produces "base" projects (no live status). catalog.js owns the
// runtime state and merges these with pids/status to produce the §5 model.
// ---------------------------------------------------------------------------

import fs from 'node:fs';
import path from 'node:path';
import { ruleForType } from './frameworks.js';
import { REPO_ROOT, MAX_SCAN_DEPTH } from './config.js';

// Folders that are never projects. Kept deliberately tiny and generic: the real
// gate is `isProjectDir` (markers / own .git) plus the self-exclusion below.
// Nothing here may encode a project or product name — Mission Control excludes
// *itself* by resolved path, so it works whatever the clone folder is called
// (the README tells people to clone it as `launchpad`).
const SKIP_DIRS = new Set(['node_modules', '.git']);

/**
 * Map a folder name to a stable, readable catalog id (hyphen-case). Fully
 * generic — no per-project hardcoding. Splits camelCase / PascalCase and
 * acronym boundaries so `PatoPatrick` → `pato-patrick`, `PromptTycoon` →
 * `prompt-tycoon`, `AGENT-OS` → `agent-os`, `myAPIServer` → `my-api-server`.
 * @param {string} folder
 * @returns {string}
 */
export function folderToId(folder) {
  return String(folder)
    // lower/digit → Upper  (pato|Patrick)
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    // ACRONYM → Word        (API|Server)
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1-$2')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

/**
 * Detect which package manager a Node project uses, from its lockfile (the
 * strongest signal) or the `packageManager` field. Running `npm run dev` in a
 * pnpm/yarn/bun workspace is not just cosmetic — `npm install` there can rewrite
 * or corrupt the dependency tree, and the dev script may not even resolve.
 * @param {string} dir
 * @param {object|null} pkg
 * @returns {'npm'|'pnpm'|'yarn'|'bun'}
 */
export function detectPackageManager(dir, pkg = null) {
  if (has(dir, 'pnpm-lock.yaml')) return 'pnpm';
  if (has(dir, 'bun.lockb') || has(dir, 'bun.lock')) return 'bun';
  if (has(dir, 'yarn.lock')) return 'yarn';
  if (has(dir, 'package-lock.json')) return 'npm';
  const declared = String(pkg?.packageManager || '').toLowerCase();
  if (declared.startsWith('pnpm')) return 'pnpm';
  if (declared.startsWith('yarn')) return 'yarn';
  if (declared.startsWith('bun')) return 'bun';
  return 'npm';
}

/**
 * Build the command that runs `script` with the given package manager.
 *   npm  → `npm run dev` / `npm start`      (npm has a `start` shorthand)
 *   pnpm → `pnpm dev`    / `pnpm start`
 *   yarn → `yarn dev`    / `yarn start`
 *   bun  → `bun run dev` / `bun run start`
 * @param {'npm'|'pnpm'|'yarn'|'bun'} pm
 * @param {string} script
 * @returns {string}
 */
export function runScript(pm, script) {
  if (pm === 'pnpm' || pm === 'yarn') return `${pm} ${script}`;
  if (pm === 'bun') return `bun run ${script}`;
  return script === 'start' ? 'npm start' : `npm run ${script}`;
}

/** Read+parse a package.json, or null. */
function readPkg(dir) {
  try {
    return JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
  } catch {
    return null;
  }
}

/** True if a file/dir exists. */
function has(dir, name) {
  return fs.existsSync(path.join(dir, name));
}

/** Derive a GitHub repoUrl from .git/config (origin), or null. */
function readRepoUrl(dir) {
  try {
    const cfg = fs.readFileSync(path.join(dir, '.git', 'config'), 'utf8');
    const m = cfg.match(/\[remote "origin"\][\s\S]*?url\s*=\s*(\S+)/);
    if (m) return m[1].replace(/\.git$/, '');
    return null;
  } catch {
    return null;
  }
}

/**
 * Map a raw type to the front-end TypeGroup bucket (SPEC §5).
 * @param {string} type
 * @returns {'Node'|'Python'|'Static'|'Docker'|'Go'|'Rust'|'Other'}
 */
export function typeGroupForType(type) {
  if (!type) return 'Other';
  const t = type.toLowerCase();
  if (t.includes('docker') || t.includes('compose')) return 'Docker';
  if (t.includes('python') || t.includes('fastapi') || t.includes('uvicorn') || t.includes('django') || t.includes('flask')) {
    return 'Python';
  }
  if (t.startsWith('go-')) return 'Go';
  if (t.startsWith('rust-')) return 'Rust';
  if (t === 'html5-static' || t === 'astro') return 'Static';
  if (
    t.startsWith('node-') ||
    t.startsWith('vite-') ||
    t.startsWith('express-') ||
    t.startsWith('electron-') ||
    t === 'next' ||
    t === 'deno' ||
    t === 'vanilla-es-modules' ||
    t === 'monorepo'
  ) {
    return 'Node';
  }
  return 'Other';
}

/** Is `p` an existing directory? */
function isDir(p) {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

/** Read a file as text, or '' if absent/unreadable. */
function readText(dir, name) {
  try {
    return fs.readFileSync(path.join(dir, name), 'utf8');
  } catch {
    return '';
  }
}

// Entry-point sources scanned for a Python web framework, plus the dependency
// manifests as a fallback signal.
const PY_ENTRY_FILES = ['main.py', 'app.py', 'server.py', 'asgi.py', 'wsgi.py'];
const PY_MANIFESTS = ['pyproject.toml', 'requirements.txt', 'Pipfile'];

/** Does anything in `dir` mention `re`? (Python source + manifests.) */
function pythonMentions(dir, re) {
  for (const f of [...PY_ENTRY_FILES, ...PY_MANIFESTS]) {
    if (re.test(readText(dir, f))) return true;
  }
  return false;
}

/** Does any of `files` in `dir` mention FastAPI/uvicorn? (Python web service.) */
function looksLikeFastapi(dir) {
  return pythonMentions(dir, /fastapi|uvicorn|starlette/i);
}

/** Is there any Python project marker at all? */
function looksLikePython(dir) {
  return (
    has(dir, 'pyproject.toml') ||
    has(dir, 'requirements.txt') ||
    has(dir, 'setup.py') ||
    has(dir, 'Pipfile') ||
    has(dir, 'manage.py')
  );
}

/**
 * Classify a non-Node ecosystem from on-disk markers: Python (Django / Flask /
 * FastAPI), Go, Rust, Deno, Docker Compose. Returns null when nothing matches.
 * Generic — keys off manifests and entry-point sources, never folder names.
 * @param {string} dir
 * @returns {{type,framework,devCommand,defaultPort,runnable}|null}
 */
function classifyNonNode(dir) {
  // --- Python -------------------------------------------------------------
  if (looksLikePython(dir)) {
    if (has(dir, 'manage.py')) {
      return { type: 'django-python', framework: 'Django', devCommand: null, defaultPort: 8000, runnable: true };
    }
    if (looksLikeFastapi(dir)) {
      return { type: 'fastapi-python', framework: 'FastAPI (Python)', devCommand: null, defaultPort: 8000, runnable: true };
    }
    if (pythonMentions(dir, /\bflask\b/i)) {
      return { type: 'flask-python', framework: 'Flask', devCommand: null, defaultPort: 5000, runnable: true };
    }
    return { type: 'python', framework: 'Python', devCommand: null, defaultPort: null, runnable: false };
  }

  // --- Deno ---------------------------------------------------------------
  if (has(dir, 'deno.json') || has(dir, 'deno.jsonc')) {
    const cfg = readText(dir, 'deno.json') || readText(dir, 'deno.jsonc');
    const hasDevTask = /"tasks"[\s\S]*?"dev"/.test(cfg);
    return {
      type: 'deno',
      framework: 'Deno',
      devCommand: hasDevTask ? 'deno task dev' : null,
      defaultPort: 8000,
      runnable: hasDevTask,
    };
  }

  // --- Go -----------------------------------------------------------------
  if (has(dir, 'go.mod')) {
    // Only a `main` package is runnable; a library module has no entry point.
    const runnable = has(dir, 'main.go') || isDir(path.join(dir, 'cmd'));
    return { type: 'go-http', framework: 'Go', devCommand: null, defaultPort: 8080, runnable };
  }

  // --- Rust ---------------------------------------------------------------
  if (has(dir, 'Cargo.toml')) {
    const runnable = has(dir, path.join('src', 'main.rs'));
    return { type: 'rust-cargo', framework: 'Rust (cargo)', devCommand: null, defaultPort: 8080, runnable };
  }

  // --- Docker Compose -----------------------------------------------------
  // Detected and labelled, but NOT launchable: `docker compose up` starts
  // containers whose lifetime a process-tree kill cannot reclaim, so stopping
  // the card would leave the stack running. Fail closed until compose gets
  // first-class up/down handling.
  for (const f of ['docker-compose.yml', 'docker-compose.yaml', 'compose.yml', 'compose.yaml']) {
    if (has(dir, f)) {
      return { type: 'docker-compose', framework: 'Docker Compose', devCommand: null, defaultPort: null, runnable: false };
    }
  }

  return null;
}

/**
 * Classify a SINGLE directory (no recursion into subprojects). Generic — keys
 * off package.json deps/scripts and on-disk markers, never folder names.
 * @param {string} dir
 * @returns {{type,framework,devCommand,defaultPort,runnable}}
 */
function classifyLeaf(dir) {
  const pkg = readPkg(dir);
  const scripts = pkg?.scripts || {};
  const deps = { ...(pkg?.dependencies || {}), ...(pkg?.devDependencies || {}) };
  const pm = detectPackageManager(dir, pkg);
  const devCommand = scripts.dev
    ? runScript(pm, 'dev')
    : scripts.start
      ? runScript(pm, 'start')
      : null;

  // A folder can carry a package.json purely for tooling (a lint config, a
  // Tailwind build) while the actual app is Python/Go/Rust/Deno. Whenever there
  // is no JS dev/start script to run, let the other ecosystems claim it first —
  // otherwise those projects surface as dead "node-server" cards with no Start.
  if (!devCommand) {
    const other = classifyNonNode(dir);
    if (other) return { ...other, packageManager: pm };
  }

  let type = 'other';
  let framework = 'Unknown';
  let defaultPort = null;
  let runnable = Boolean(devCommand);

  if (deps.next) {
    type = 'next';
    framework = `Next.js ${stripCaret(deps.next)}`;
    const m = (scripts.dev || '').match(/-p\s+(\d+)/);
    defaultPort = m ? Number(m[1]) : 3000;
  } else if (deps.electron) {
    type = 'electron-vite-react';
    framework = 'Electron + Vite';
    defaultPort = 5173;
  } else if (deps.astro) {
    type = 'astro';
    framework = `Astro ${stripCaret(deps.astro)}`;
    defaultPort = 4321;
  } else if (deps.nuxt) {
    type = 'vite-react';
    framework = `Nuxt ${stripCaret(deps.nuxt)}`;
    defaultPort = 3000;
  } else if (deps['@remix-run/dev'] || deps['@react-router/dev']) {
    type = 'vite-react';
    framework = deps['@remix-run/dev'] ? 'Remix' : 'React Router';
    defaultPort = 5173;
  } else if (deps.vite || deps['@vitejs/plugin-react'] || deps['@sveltejs/kit']) {
    type = 'vite-react';
    framework = deps['@sveltejs/kit']
      ? 'SvelteKit'
      : deps.phaser
        ? 'Phaser 3 + Vite'
        : deps.vue
          ? 'Vite + Vue'
          : deps.svelte
            ? 'Vite + Svelte'
            : deps.solid || deps['vite-plugin-solid']
              ? 'Vite + Solid'
              : deps.preact
                ? 'Vite + Preact'
                : 'Vite + React';
    defaultPort = 5173;
  } else if (deps['node-telegram-bot-api'] || deps.telegraf || deps.grammy || deps['discord.js']) {
    type = 'node-telegram-bot';
    framework = deps['discord.js'] ? 'Discord bot' : 'Telegram bot';
    runnable = Boolean(devCommand);
  } else if (pkg && (deps.express || deps.fastify || deps.koa || deps['@hapi/hapi'] || deps.hono || deps['@nestjs/core'])) {
    type = 'express-node';
    framework = deps['@nestjs/core']
      ? 'NestJS'
      : deps.fastify
        ? 'Fastify'
        : deps.hono
          ? 'Hono'
          : deps.koa
            ? 'Koa'
            : deps['@hapi/hapi']
              ? 'hapi'
              : 'Express';
    defaultPort = 3000;
  } else if (pkg && pkg.bin && !scripts.dev) {
    // A package that ships a `bin` and has no `dev` script is a command-line
    // tool. It may still be worth running (plenty of CLIs open a local
    // dashboard), so it keeps its Start button — but as a PORTLESS project:
    // such a tool binds its own fixed port, if any, and reserving one from the
    // range for it only ever produced a card pointing at a dead port.
    type = 'node-cli';
    framework = 'Node CLI';
    runnable = Boolean(devCommand);
  } else if (pkg && (scripts.dev || '').includes('serve')) {
    type = 'vanilla-es-modules';
    framework = 'Vanilla ES modules';
    const m = (scripts.dev || '').match(/-l\s+(\d+)/);
    defaultPort = m ? Number(m[1]) : 5173;
  } else if (!pkg && has(dir, 'index.html')) {
    type = 'html5-static';
    framework = 'Static HTML/CSS/JS';
    runnable = true;
    defaultPort = 8000;
  } else if (pkg && !devCommand && has(dir, 'index.html')) {
    // A package.json with NO recognizable server framework and NO dev/start
    // script, but an index.html at the root, is a static site that merely keeps
    // a manifest (e.g. for a build dep or metadata). Serve it like any static
    // site instead of mislabeling it a non-runnable "node-server". (fervon.)
    type = 'html5-static';
    framework = 'Static HTML/CSS/JS';
    runnable = true;
    defaultPort = 8000;
  } else if (pkg) {
    type = 'node-server';
    framework = 'Node';
  }

  return { type, framework, devCommand, defaultPort, runnable, packageManager: pm };
}

/** Resolve npm `workspaces` (array or {packages}) into a flat list of globs. */
function workspaceGlobs(pkg) {
  const ws = pkg?.workspaces;
  if (Array.isArray(ws)) return ws;
  if (ws && Array.isArray(ws.packages)) return ws.packages;
  return [];
}

// Conventional names for a *separately runnable service* living beside its
// sibling in a split repo (the classic backend/ + frontend/ layout). We do NOT
// explode npm-workspace `packages/*` internals — those are libraries, and the
// top-level `npm run dev` already launches the whole monorepo. Keeping this list
// tight is what stops a 15-package monorepo from becoming 15 noisy cards.
const SERVICE_SUBDIRS = ['backend', 'frontend', 'server', 'client', 'dashboard', 'webapp'];

// Subproject types worth launching on their own (real apps/servers).
const LAUNCHABLE_TYPES = new Set([
  'next',
  'electron-vite-react',
  'vite-react',
  'astro',
  'fastapi-python',
  'express-node',
  'vanilla-es-modules',
  'html5-static',
]);

/**
 * Find separately-runnable subprojects inside `dir`: the conventional
 * backend/frontend-style service folders only. Generic — keys off folder
 * convention + on-disk type, never specific project names. Returns [] for the
 * common single-app or pure-workspace-monorepo case.
 * @param {string} dir
 * @param {string} id   parent id (prefix for subproject ids)
 */
function detectSubprojects(dir, id) {
  const subs = [];
  for (const name of SERVICE_SUBDIRS) {
    const childDir = path.join(dir, name);
    if (!isDir(childDir)) continue;
    const det = classifyLeaf(childDir);
    if (!LAUNCHABLE_TYPES.has(det.type)) continue; // skip libs / non-servers
    subs.push({
      id: `${id}-${folderToId(name)}`,
      name,
      path: path.resolve(childDir),
      type: det.type,
      typeGroup: typeGroupForType(det.type),
      framework: det.framework,
      defaultPort: det.defaultPort,
      discoveredCommand: det.devCommand,
      packageManager: det.packageManager,
    });
  }
  return subs;
}

/**
 * Detect the framework/type of a project directory from its files.
 * Returns { type, framework, devCommand, defaultPort, runnable, subprojects }.
 * @param {string} dir   absolute project dir
 * @param {string} id
 */
// ---------------------------------------------------------------------------
// Detection cache.
//
// Classifying one project reads and parses several files (package.json, and for
// Python up to eight source/manifest files). The watcher re-runs a full scan
// 750 ms after ANY change in the tree, synchronously, on the event loop — so on
// a big workspace every touched file froze the server for the length of a whole
// rescan. Measured before this cache, on a synthetic workspace: 25 projects
// 48 ms, 100 projects 197 ms, 300 projects 780 ms (worst case 2.2 s).
//
// The cache is keyed by the project's absolute path and validated by a cheap
// signature of stat() calls — no reads, no parsing. It invalidates when:
//   - anything is created, deleted or renamed in the project folder (its own
//     mtime changes), or
//   - a manifest we actually read is edited (that file's mtime/size changes), or
//   - one of the conventional service subfolders changes.
// ---------------------------------------------------------------------------

/** path → { sig, det } */
const detectCache = new Map();

// Every file whose CONTENT can change what we detect. Creating or deleting one
// is caught by the folder's own mtime; editing one needs its own stat.
/**
 * Files whose creation, deletion or edit can change how a project is
 * classified. Shared with the watcher, which uses the same list to decide
 * whether a change inside a project folder is worth a rescan at all.
 */
export const SIGNATURE_FILES = [
  'package.json',
  'pnpm-workspace.yaml',
  'pnpm-lock.yaml',
  'yarn.lock',
  'bun.lockb',
  'bun.lock',
  'package-lock.json',
  'deno.json',
  'deno.jsonc',
  'go.mod',
  'Cargo.toml',
  ...PY_ENTRY_FILES,
  ...PY_MANIFESTS,
  'manage.py',
  'setup.py',
];

/** stat without throwing on a missing file. */
function statOrNull(p) {
  try {
    return fs.statSync(p, { throwIfNoEntry: false }) || null;
  } catch {
    return null;
  }
}

/**
 * A cheap fingerprint of everything detection depends on. Stats only — reading
 * and parsing is exactly what the cache exists to avoid.
 * @param {string} dir
 * @returns {string}
 */
function detectionSignature(dir) {
  const parts = [];
  const self = statOrNull(dir);
  parts.push(self ? String(self.mtimeMs) : '0');
  for (const f of SIGNATURE_FILES) {
    const st = statOrNull(path.join(dir, f));
    parts.push(st ? `${st.mtimeMs}.${st.size}` : '');
  }
  // Service subfolders are classified too, so their contents matter.
  for (const name of SERVICE_SUBDIRS) {
    const st = statOrNull(path.join(dir, name));
    parts.push(st ? String(st.mtimeMs) : '');
  }
  return parts.join('|');
}

/**
 * `detectProject` with the signature cache in front of it.
 * @param {string} dir
 * @param {string} id
 */
function detectProjectCached(dir, id) {
  const key = `${dir}::${id}`;
  const sig = detectionSignature(dir);
  const hit = detectCache.get(key);
  if (hit && hit.sig === sig) {
    hit.seen = true;
    return hit.det;
  }
  const det = detectProject(dir, id);
  detectCache.set(key, { sig, det, seen: true });
  return det;
}

/** Drop cache entries for projects that were not seen in the last scan. */
function pruneDetectCache() {
  for (const [key, entry] of detectCache) {
    if (entry.seen) entry.seen = false;
    else detectCache.delete(key);
  }
}

/** Empty the detection cache (tests, and any future "force refresh" path). */
export function clearDetectCache() {
  detectCache.clear();
}

/** How many entries the cache currently holds (tests/diagnostics). */
export function detectCacheSize() {
  return detectCache.size;
}

function detectProject(dir, id) {
  const pkg = readPkg(dir);
  const scripts = pkg?.scripts || {};
  const isMonorepo = Boolean(workspaceGlobs(pkg).length) || has(dir, 'pnpm-workspace.yaml');
  const pm = detectPackageManager(dir, pkg);

  let leaf;
  if (isMonorepo) {
    leaf = {
      type: 'monorepo',
      framework: pm === 'npm' ? 'npm-workspaces monorepo' : `${pm} workspaces monorepo`,
      devCommand: scripts.dev ? runScript(pm, 'dev') : scripts.start ? runScript(pm, 'start') : null,
      defaultPort: null,
      runnable: Boolean(scripts.dev),
      packageManager: pm,
    };
  } else {
    leaf = classifyLeaf(dir);
  }

  // Generic subproject discovery: only conventional backend/frontend-style
  // service folders (not workspace-package internals). [] for the common case.
  const subprojects = detectSubprojects(dir, id);

  return {
    type: leaf.type,
    framework: leaf.framework,
    devCommand: leaf.devCommand,
    defaultPort: leaf.defaultPort,
    runnable: leaf.runnable,
    packageManager: leaf.packageManager || 'npm',
    subprojects,
    repoUrl: readRepoUrl(dir),
  };
}

function stripCaret(v) {
  return String(v).replace(/^[\^~>=<\s]+/, '');
}

// Files that mark a directory as a real, listable project. A folder with none
// of these (and no own .git repo) is not a project — e.g. an orphaned
// git-worktree shell that still holds a `node_modules/` after the worktree was
// removed, or a stray scratch folder.
const PROJECT_MARKERS = [
  'package.json',
  'index.html',
  'pyproject.toml',
  'requirements.txt',
  'setup.py',
  'Pipfile',
  'manage.py',
  'deno.json',
  'deno.jsonc',
  'docker-compose.yml',
  'docker-compose.yaml',
  'compose.yml',
  'compose.yaml',
  'go.mod',
  'Cargo.toml',
  'pom.xml',
  'build.gradle',
  'Gemfile',
];

/**
 * A live git worktree has a `.git` *file* (not directory) that points at the
 * parent repo. Such a folder is a checkout of another project, not a project of
 * its own, so it should never surface as a standalone card.
 * @param {string} dir
 */
function isGitWorktree(dir) {
  try {
    const g = path.join(dir, '.git');
    return fs.existsSync(g) && fs.statSync(g).isFile();
  } catch {
    return false;
  }
}

/**
 * Generic gate (no name matching): should this directory be listed as a project
 * at all? Skip git worktrees; otherwise require either an own `.git` repo dir or
 * at least one recognizable project-marker file. Filters stray folders and
 * orphaned worktree shells (often just a lone `node_modules/`).
 * @param {string} dir
 */
function isProjectDir(dir) {
  if (isGitWorktree(dir)) return false;
  if (isDir(path.join(dir, '.git'))) return true; // an intentional repo root
  return PROJECT_MARKERS.some((m) => has(dir, m));
}

/**
 * Scan the projects root and return base discovered projects (pre-override).
 * @param {string} projectsRoot
 * @param {object} [opts]
 * @param {string} [opts.selfPath]  folder to exclude as "this dashboard itself"
 *                                  (defaults to the repo root). Passing null
 *                                  disables self-exclusion (used by tests).
 * @returns {Array<object>}
 */
export function scanFilesystem(projectsRoot, opts = {}) {
  const selfPath =
    opts.selfPath === undefined ? REPO_ROOT : opts.selfPath ? path.resolve(opts.selfPath) : null;
  const depth = Math.max(1, Math.min(MAX_SCAN_DEPTH, Number(opts.depth) || 1));
  const out = [];

  /**
   * @param {string} dir        directory to list
   * @param {string[]} trail    folder names from the root down to `dir`
   * @param {number} level      1 = children of the root
   */
  const walk = (dir, trail, level) => {
    let entries = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const ent of entries) {
      if (!ent.isDirectory()) continue;
      if (ent.name.startsWith('.')) continue; // hidden/dot dirs (.claude, .vscode, .idea, .git)
      if (SKIP_DIRS.has(ent.name)) continue;
      if (ent.name.endsWith('.git')) continue; // bare repo backups
      const childDir = path.join(dir, ent.name);
      // Never list the dashboard itself. Compared by resolved path, so it holds
      // whatever the clone folder is named (`launchpad`, `mission-control`, …).
      if (selfPath && path.resolve(childDir) === selfPath) continue;
      const childTrail = [...trail, ent.name];

      if (!isProjectDir(childDir)) {
        // Not a project. It may still be a *container* of projects — the very
        // common `code/work/*` + `code/personal/*` layout, which used to render
        // an empty dashboard with no explanation. Descend if depth allows.
        if (level < depth) walk(childDir, childTrail, level + 1);
        continue;
      }

      // A real project. Nested ones get a path-derived id (`work/api` →
      // `work-api`) so two `api` folders under different parents don't collide;
      // top-level ids are unchanged, which keeps existing configs valid.
      const id = childTrail.map(folderToId).join('-');
      const det = detectProjectCached(childDir, id);
      out.push({
        id,
        folder: ent.name,
        // Show the trail for nested projects so `work/api` and `personal/api`
        // are told apart at a glance.
        name: childTrail.join('/'),
        path: childDir,
        type: det.type,
        typeGroup: typeGroupForType(det.type),
        framework: det.framework,
        repoUrl: det.repoUrl,
        runnable: det.runnable,
        discoveredCommand: det.devCommand,
        defaultPort: det.defaultPort,
        packageManager: det.packageManager,
        subprojects: det.subprojects,
      });
      // A project's own subfolders are handled by detectSubprojects — never
      // descend into one, or a monorepo would explode into dozens of cards.
    }
  };

  walk(projectsRoot, [], 1);
  // Forget projects that no longer exist, so the cache tracks the workspace
  // instead of growing forever across rescans. Skipped for an empty result:
  // `scanWithFallback` probes depth 1 before widening, and pruning on that
  // empty probe would throw away the whole cache on every scan.
  if (out.length) pruneDetectCache();
  return out;
}

/**
 * Scan, and if the configured depth finds nothing, look deeper before giving up.
 *
 * An empty grid is the worst possible first impression and used to be entirely
 * silent: someone whose projects live in `code/work/*` saw a blank dashboard and
 * no hint as to why. Rather than fail quietly we widen the search and *say so*,
 * returning a warning the UI can surface along with the depth that worked.
 *
 * @param {string} projectsRoot
 * @param {object} [opts]
 * @param {number} [opts.depth=1]     configured scanDepth
 * @param {string|null} [opts.selfPath]
 * @returns {{ projects: object[], depthUsed: number, warnings: string[] }}
 */
export function scanWithFallback(projectsRoot, opts = {}) {
  const configured = Math.max(1, Math.min(MAX_SCAN_DEPTH, Number(opts.depth) || 1));
  const warnings = [];
  let projects = scanFilesystem(projectsRoot, { ...opts, depth: configured });
  if (projects.length) return { projects, depthUsed: configured, warnings };

  for (let d = configured + 1; d <= MAX_SCAN_DEPTH; d++) {
    projects = scanFilesystem(projectsRoot, { ...opts, depth: d });
    if (projects.length) {
      warnings.push(
        `No projects directly under "${projectsRoot}" — found ${projects.length} one level deeper, ` +
          `so scanning continues at depth ${d} (settings.scanDepth). ` +
          `Point projectsRoot at a single folder if you'd rather keep the scan shallow.`
      );
      return { projects, depthUsed: d, warnings };
    }
  }
  return { projects: [], depthUsed: configured, warnings };
}

/**
 * Run full hybrid discovery: scan + merge config + resolve ports.
 * Returns { projects: BaseProject[], warnings: string[] }.
 *
 * @param {object} config           parsed config.json
 * @returns {{ projects: object[], warnings: string[] }}
 */
export function discover(config) {
  const settings = config.settings;
  const warnings = [];
  const overrides = config.projects || {};

  // 1. Scan FS (or skip if autoScan:false). `scanWithFallback` widens the
  //    search when the configured depth finds nothing, and warns about it
  //    instead of leaving an unexplained empty grid.
  const depth = settings.scanDepth;
  let discovered = [];
  let depthUsed = Math.max(1, Number(depth) || 1);
  if (settings.autoScan) {
    const scan = scanWithFallback(settings.projectsRoot, { depth });
    discovered = scan.projects;
    depthUsed = scan.depthUsed;
    warnings.push(...scan.warnings);
  }
  const byId = new Map(discovered.map((p) => [p.id, p]));

  // If autoScan:false, only config-listed projects (that exist on disk) show.
  // We still need their on-disk detection, so scan-then-filter.
  if (!settings.autoScan) {
    const all = scanWithFallback(settings.projectsRoot, { depth }).projects;
    const allById = new Map(all.map((p) => [p.id, p]));
    byId.clear();
    for (const id of Object.keys(overrides)) {
      if (allById.has(id)) byId.set(id, allById.get(id));
      else warnings.push(`config project "${id}" not found on disk (skipped)`);
    }
  } else {
    // Warn about config projects that don't exist on disk.
    for (const id of Object.keys(overrides)) {
      if (!byId.has(id)) warnings.push(`config project "${id}" not found on disk (skipped)`);
    }
  }

  // 2. Merge overrides over discovered base.
  const merged = [];
  for (const base of byId.values()) {
    const ov = overrides[base.id] || {};
    const rule = ruleForType(base.type);
    const command = ov.command || base.discoveredCommand || rule.baseCommand;
    const runnable = ov.runnable !== undefined ? ov.runnable : base.runnable;
    merged.push({
      ...base,
      name: ov.name || base.name,
      command,
      runnable,
      hidden: ov.hidden === true,
      cwd: ov.cwd || base.path,
      portFlag: ov.portFlag ?? null,
      portEnv: ov.portEnv || 'PORT',
      // Optional { kind, name } override for the published-version badge, for
      // the case a manifest cannot express (a private workspace root whose
      // published package is one of its members).
      registry: ov.registry || null,
      env: ov.env || {},
      _seedPort: ov.port ?? null,
    });
  }

  // 3. Resolve assignedPort. Precedence: override.port → defaultPort-in-range
  //    → first free in range. Enforce uniqueness; lower-id keeps a clashed port.
  const { start, end } = settings.portRange;
  const used = new Set();

  // First pass: honor explicit seed ports (sorted by id for determinism).
  merged.sort((a, b) => a.id.localeCompare(b.id));
  for (const p of merged) {
    if (p._seedPort != null && p._seedPort >= start && p._seedPort <= end) {
      if (used.has(p._seedPort)) {
        warnings.push(`port ${p._seedPort} clash on "${p.id}"; will reallocate`);
        p._seedPort = null; // resolved in second pass
      } else {
        p.assignedPort = p._seedPort;
        used.add(p._seedPort);
      }
    }
  }
  // Second pass: allocate the rest deterministically from the range.
  let cursor = start;
  for (const p of merged) {
    if (p.assignedPort != null) continue;
    while (cursor <= end && used.has(cursor)) cursor++;
    if (cursor > end) {
      warnings.push(`no port available in range for "${p.id}"`);
      p.assignedPort = null;
    } else {
      p.assignedPort = cursor;
      used.add(cursor);
      cursor++;
    }
  }

  // Assign subproject ports from the same range.
  for (const p of merged) {
    for (const sp of p.subprojects || []) {
      const spOv = overrides[sp.id] || {};
      if (spOv.command) sp.command = spOv.command;
      else if (sp.type === 'fastapi-python') sp.command = ruleForType('fastapi-python').baseCommand;
      else sp.command = sp.discoveredCommand || ruleForType(sp.type).baseCommand;
      let port = spOv.port ?? null;
      if (port == null || used.has(port)) {
        while (cursor <= end && used.has(cursor)) cursor++;
        port = cursor <= end ? cursor : null;
      }
      if (port != null) {
        sp.assignedPort = port;
        used.add(port);
        if (cursor === port) cursor++;
      } else {
        sp.assignedPort = null;
      }
      sp.portFlag = spOv.portFlag ?? null;
      sp.portEnv = spOv.portEnv || 'PORT';
      sp.cwd = spOv.cwd || sp.path;
    }
  }

  return { projects: merged, warnings, depthUsed };
}

/**
 * Build a seed config.json from a fresh scan (first-run). Fully generic — it
 * assigns each discovered project a stable port from the range in deterministic
 * (sorted-id) order. Everything else (command, type, runnable) is derived live
 * by discovery from the project's own files, so the seed stays minimal and the
 * config carries no machine- or project-specific assumptions.
 * @param {object} settings
 * @returns {object} full config object
 */
export function seedConfig(settings) {
  const discovered = scanWithFallback(settings.projectsRoot, { depth: settings.scanDepth }).projects;
  discovered.sort((a, b) => a.id.localeCompare(b.id)); // stable port assignment
  const { start, end } = settings.portRange;

  const projects = {};
  let cursor = start;
  for (const p of discovered) {
    projects[p.id] = cursor <= end ? { port: cursor++ } : {};
  }
  return { $schemaVersion: 1, settings, projects };
}
