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

// Folders that are never projects.
const SKIP_DIRS = new Set([
  'node_modules',
  'mission-control',
  'notes',
  'tmp',
  '.git',
]);

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
 * @returns {'Node'|'Python'|'Static'|'Docker'|'Other'}
 */
export function typeGroupForType(type) {
  if (!type) return 'Other';
  const t = type.toLowerCase();
  if (t.includes('docker')) return 'Docker';
  if (t.includes('python') || t.includes('fastapi') || t.includes('uvicorn')) return 'Python';
  if (t === 'html5-static' || t === 'astro') return 'Static';
  if (
    t.startsWith('node-') ||
    t.startsWith('vite-') ||
    t.startsWith('express-') ||
    t.startsWith('electron-') ||
    t === 'next' ||
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

/** Does any of `files` in `dir` mention FastAPI/uvicorn? (Python web service.) */
function looksLikeFastapi(dir) {
  for (const f of ['main.py', 'app.py', 'server.py', 'asgi.py']) {
    try {
      if (/fastapi|uvicorn|starlette/i.test(fs.readFileSync(path.join(dir, f), 'utf8'))) return true;
    } catch {
      /* ignore */
    }
  }
  // pyproject/requirements as a fallback signal.
  for (const f of ['pyproject.toml', 'requirements.txt']) {
    try {
      if (/fastapi|uvicorn|starlette/i.test(fs.readFileSync(path.join(dir, f), 'utf8'))) return true;
    } catch {
      /* ignore */
    }
  }
  return false;
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
  const devCommand = scripts.dev ? 'npm run dev' : scripts.start ? 'npm start' : null;

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
  } else if (deps.vite || deps['@vitejs/plugin-react']) {
    type = 'vite-react';
    framework = deps.phaser ? 'Phaser 3 + Vite' : deps.vue ? 'Vite + Vue' : deps.svelte ? 'Vite + Svelte' : 'Vite + React';
    defaultPort = 5173;
  } else if (deps['node-telegram-bot-api'] || deps.telegraf || deps.grammy) {
    type = 'node-telegram-bot';
    framework = 'Telegram bot';
    runnable = Boolean(devCommand);
  } else if (pkg && !devCommand && scripts.start) {
    type = 'node-cli';
    framework = 'Node CLI';
    runnable = false;
  } else if (pkg && (deps.express || deps.fastify || deps.koa || deps['@hapi/hapi'])) {
    type = 'express-node';
    framework = deps.fastify ? 'Fastify' : deps.koa ? 'Koa' : deps['@hapi/hapi'] ? 'hapi' : 'Express';
    defaultPort = 3000;
  } else if (pkg && (scripts.dev || '').includes('serve')) {
    type = 'vanilla-es-modules';
    framework = 'Vanilla ES modules';
    const m = (scripts.dev || '').match(/-l\s+(\d+)/);
    defaultPort = m ? Number(m[1]) : 5173;
  } else if (!pkg && (looksLikeFastapi(dir) || has(dir, 'pyproject.toml') || has(dir, 'requirements.txt'))) {
    // Python project with no package.json.
    const fastapi = looksLikeFastapi(dir);
    type = fastapi ? 'fastapi-python' : 'python';
    framework = fastapi ? 'FastAPI (Python)' : 'Python';
    runnable = fastapi;
    defaultPort = fastapi ? 8000 : null;
  } else if (!pkg && has(dir, 'index.html')) {
    type = 'html5-static';
    framework = 'Static HTML/CSS/JS';
    runnable = true;
    defaultPort = 8000;
  } else if (pkg) {
    type = 'node-server';
    framework = 'Node';
  }

  return { type, framework, devCommand, defaultPort, runnable };
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
      framework: det.framework,
      defaultPort: det.defaultPort,
      discoveredCommand: det.devCommand,
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
function detectProject(dir, id) {
  const pkg = readPkg(dir);
  const scripts = pkg?.scripts || {};
  const isMonorepo = Boolean(workspaceGlobs(pkg).length);

  let leaf;
  if (isMonorepo) {
    leaf = {
      type: 'monorepo',
      framework: 'npm-workspaces monorepo',
      devCommand: scripts.dev ? 'npm run dev' : scripts.start ? 'npm start' : null,
      defaultPort: null,
      runnable: Boolean(scripts.dev),
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
 * @returns {Array<object>}
 */
export function scanFilesystem(projectsRoot) {
  const out = [];
  let entries = [];
  try {
    entries = fs.readdirSync(projectsRoot, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const ent of entries) {
    if (!ent.isDirectory()) continue;
    if (ent.name.startsWith('.')) continue; // hidden/dot dirs (.claude, .vscode, .idea, .git)
    if (SKIP_DIRS.has(ent.name)) continue;
    if (ent.name.endsWith('.git')) continue; // bare repo backups
    const dir = path.join(projectsRoot, ent.name);
    if (!isProjectDir(dir)) continue; // skip worktrees / stray non-project folders
    const id = folderToId(ent.name);
    const det = detectProject(dir, id);
    out.push({
      id,
      folder: ent.name,
      name: ent.name,
      path: dir,
      type: det.type,
      typeGroup: typeGroupForType(det.type),
      framework: det.framework,
      repoUrl: det.repoUrl,
      runnable: det.runnable,
      discoveredCommand: det.devCommand,
      defaultPort: det.defaultPort,
      subprojects: det.subprojects,
    });
  }
  return out;
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

  // 1. Scan FS (or skip if autoScan:false).
  let discovered = [];
  if (settings.autoScan) {
    discovered = scanFilesystem(settings.projectsRoot);
  }
  const byId = new Map(discovered.map((p) => [p.id, p]));

  // If autoScan:false, only config-listed projects (that exist on disk) show.
  // We still need their on-disk detection, so scan-then-filter.
  if (!settings.autoScan) {
    const all = scanFilesystem(settings.projectsRoot);
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

  return { projects: merged, warnings };
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
  const discovered = scanFilesystem(settings.projectsRoot);
  discovered.sort((a, b) => a.id.localeCompare(b.id)); // stable port assignment
  const { start, end } = settings.portRange;

  const projects = {};
  let cursor = start;
  for (const p of discovered) {
    projects[p.id] = cursor <= end ? { port: cursor++ } : {};
  }
  return { $schemaVersion: 1, settings, projects };
}
