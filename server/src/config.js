// config.js
// ---------------------------------------------------------------------------
// Load / save / validate config.json (SPEC §4).
// - config.json lives at the repo root (sibling of root package.json).
// - Atomic write: write config.json.tmp then rename.
// - If absent on first run, the caller (discovery) seeds it from the catalog.
// ---------------------------------------------------------------------------

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// server/src/config.js → package root is two levels up.
export const REPO_ROOT = path.resolve(__dirname, '..', '..');

// Hard ceiling on how deep a scan may go below projectsRoot. Depth 3 covers
// every real workspace layout seen so far (`code/work/client/app`); beyond that
// the cost of walking a big tree synchronously outweighs any plausible benefit.
export const MAX_SCAN_DEPTH = 3;

/**
 * Are we running from an installed package (`npx @fervon/launchpad`, a global
 * or local dependency) rather than from a git checkout?
 *
 * It changes two things that would otherwise be nonsense: the folder we scan
 * (the parent of an install dir is `node_modules`, not your projects) and where
 * config is written (an npx install is a throwaway cache directory).
 *
 * @param {string} [root]
 * @returns {boolean}
 */
export function isInstalledPackage(root = REPO_ROOT) {
  return path.resolve(root).split(path.sep).includes('node_modules');
}

/**
 * Default folder to scan for projects:
 *   1. `MISSION_CONTROL_PROJECTS_ROOT` (explicit override), else
 *   2. installed as a package → the **current working directory**: you run
 *      `npx @fervon/launchpad` from the folder you want managed, else
 *   3. a git checkout → the parent of this repo, because Mission Control is
 *      meant to live *inside* the workspace it manages
 *      (…/projects/launchpad → …/projects).
 * @returns {string}
 */
export function defaultProjectsRoot(root = REPO_ROOT) {
  const env = process.env.MISSION_CONTROL_PROJECTS_ROOT;
  if (env && env.trim()) return path.resolve(env.trim());
  if (isInstalledPackage(root)) return path.resolve(process.cwd());
  return path.resolve(root, '..');
}

/**
 * Where config lives:
 *   1. `MISSION_CONTROL_CONFIG` (explicit override), else
 *   2. installed as a package → `.launchpad.json` **inside the projects root**,
 *      so settings and port assignments belong to that workspace and survive
 *      the throwaway npx cache, else
 *   3. a git checkout → `config.json` at the repo root (unchanged).
 * @returns {string}
 */
export function defaultConfigPath(root = REPO_ROOT) {
  const env = process.env.MISSION_CONTROL_CONFIG;
  if (env && env.trim()) return path.resolve(env.trim());
  if (isInstalledPackage(root)) return path.join(defaultProjectsRoot(root), '.launchpad.json');
  return path.join(root, 'config.json');
}

export const CONFIG_PATH = defaultConfigPath();

/**
 * Port the dashboard itself listens on. `MISSION_CONTROL_PORT` overrides
 * config.json, mirroring `MISSION_CONTROL_PROJECTS_ROOT`: :7777 is a popular
 * port (a local FastAPI or LLM server may already own it) and, until now, the
 * only way around a clash was hand-editing a git-ignored config file.
 * @returns {number}
 */
export function defaultDashboardPort() {
  const env = Number(process.env.MISSION_CONTROL_PORT);
  return Number.isInteger(env) && env > 0 && env < 65536 ? env : 7777;
}

/** Default global settings (SPEC §4). */
export const DEFAULT_SETTINGS = {
  projectsRoot: defaultProjectsRoot(),
  dashboardPort: defaultDashboardPort(),
  portRange: { start: 4000, end: 4099 },
  ringBytes: 262144,
  metricsTtlSec: 60,
  autoScan: true,
  // How many folder levels below projectsRoot to look for projects. 1 = the
  // classic flat workspace. Raise it for a `code/work/*` + `code/personal/*`
  // layout — or just let discovery notice the empty result and widen the search
  // on its own, which it will tell you about.
  scanDepth: 1,
  // Upper bound on per-project manifest watchers. One fs.watch is one inotify
  // instance on Linux and the OS default is 128 for the whole machine, so this
  // stays well under it; projects past the cap still refresh on Rescan.
  maxProjectWatchers: 64,
  readyRegex: 'ready in|listening on|Local:\\s+http|started server|compiled|running at',
};

/**
 * Read and parse config.json. Returns null if the file does not exist
 * (so the caller can seed it). Throws on malformed JSON.
 * @returns {object|null}
 */
export function loadConfig() {
  if (!fs.existsSync(CONFIG_PATH)) return null;
  const raw = fs.readFileSync(CONFIG_PATH, 'utf8');
  return JSON.parse(raw);
}

/**
 * Atomically write config.json (tmp + rename).
 * @param {object} config
 */
export function saveConfig(config) {
  const tmp = CONFIG_PATH + '.tmp';
  const json = JSON.stringify(config, null, 2);
  fs.writeFileSync(tmp, json, 'utf8');
  fs.renameSync(tmp, CONFIG_PATH);
}

/**
 * Validate a config object's shape. Returns { ok, errors[] }.
 * Enforces: settings present, portRange sane, per-project ports within range
 * and unique. See SPEC §4 (CONFIG_INVALID).
 * @param {object} config
 * @returns {{ ok: boolean, errors: string[] }}
 */
export function validateConfig(config) {
  const errors = [];
  if (!config || typeof config !== 'object') {
    return { ok: false, errors: ['config is not an object'] };
  }
  const s = config.settings;
  if (!s || typeof s !== 'object') {
    errors.push('settings missing');
  } else {
    if (typeof s.dashboardPort !== 'number') errors.push('settings.dashboardPort must be a number');
    if (!s.portRange || typeof s.portRange.start !== 'number' || typeof s.portRange.end !== 'number') {
      errors.push('settings.portRange.{start,end} must be numbers');
    } else if (s.portRange.start > s.portRange.end) {
      errors.push('settings.portRange.start must be <= end');
    }
    if (s.scanDepth !== undefined) {
      if (!Number.isInteger(s.scanDepth) || s.scanDepth < 1 || s.scanDepth > MAX_SCAN_DEPTH) {
        errors.push(`settings.scanDepth must be an integer between 1 and ${MAX_SCAN_DEPTH}`);
      }
    }
    if (s.ringBytes !== undefined && typeof s.ringBytes !== 'number') errors.push('settings.ringBytes must be a number');
    if (s.metricsTtlSec !== undefined && typeof s.metricsTtlSec !== 'number') errors.push('settings.metricsTtlSec must be a number');
  }

  const projects = config.projects || {};
  if (typeof projects !== 'object') {
    errors.push('projects must be an object');
  } else {
    const range = s?.portRange || DEFAULT_SETTINGS.portRange;
    const seenPorts = new Map(); // port → id
    for (const [id, p] of Object.entries(projects)) {
      if (p == null || typeof p !== 'object') {
        errors.push(`projects.${id} must be an object`);
        continue;
      }
      if (p.port !== undefined) {
        if (typeof p.port !== 'number' || !Number.isInteger(p.port)) {
          errors.push(`projects.${id}.port must be an integer`);
        } else if (p.port < range.start || p.port > range.end) {
          errors.push(`projects.${id}.port ${p.port} outside range ${range.start}-${range.end}`);
        } else if (seenPorts.has(p.port)) {
          errors.push(`projects.${id}.port ${p.port} duplicates projects.${seenPorts.get(p.port)}`);
        } else {
          seenPorts.set(p.port, id);
        }
      }
      for (const [field, type] of [
        ['name', 'string'],
        ['command', 'string'],
        ['portFlag', 'string'],
        ['portEnv', 'string'],
        ['cwd', 'string'],
      ]) {
        if (p[field] !== undefined && typeof p[field] !== type) {
          errors.push(`projects.${id}.${field} must be a ${type}`);
        }
      }
      for (const boolField of ['hidden', 'runnable']) {
        if (p[boolField] !== undefined && typeof p[boolField] !== 'boolean') {
          errors.push(`projects.${id}.${boolField} must be a boolean`);
        }
      }
      if (p.env !== undefined && (typeof p.env !== 'object' || p.env === null)) {
        errors.push(`projects.${id}.env must be an object`);
      }
      if (p.registry !== undefined) {
        const r = p.registry;
        const kindOk = r && ['npm', 'pypi', 'none'].includes(r.kind);
        const nameOk = r && (r.kind === 'none' || (typeof r.name === 'string' && r.name.trim()));
        if (!kindOk || !nameOk) {
          errors.push(`projects.${id}.registry must be { kind: "npm"|"pypi"|"none", name } (name required unless kind is "none")`);
        }
      }
    }
  }

  // Named batches: { "stack": ["api", "web", "db"] }. Members are checked
  // against the catalog at call time, not here — a profile may legitimately
  // name a project that is temporarily absent from disk.
  const profiles = config.profiles;
  if (profiles !== undefined) {
    if (typeof profiles !== 'object' || profiles === null || Array.isArray(profiles)) {
      errors.push('profiles must be an object of name → [projectId]');
    } else {
      for (const [name, ids] of Object.entries(profiles)) {
        if (!Array.isArray(ids) || ids.some((v) => typeof v !== 'string')) {
          errors.push(`profiles.${name} must be an array of project ids`);
        } else if (!ids.length) {
          errors.push(`profiles.${name} is empty`);
        }
      }
    }
  }

  return { ok: errors.length === 0, errors };
}

/**
 * Merge partial settings into the config and return a new config object.
 * Used by PATCH /api/config (top-level settings only).
 * @param {object} config
 * @param {object} partialSettings
 * @returns {object}
 */
export function mergeSettings(config, partialSettings) {
  return {
    ...config,
    settings: { ...config.settings, ...partialSettings },
  };
}

/**
 * Upsert a per-project override block (PATCH /api/projects/:id/config).
 * Shallow-merges into config.projects[id].
 * @param {object} config
 * @param {string} id
 * @param {object} partial
 * @returns {object}
 */
export function upsertProjectOverride(config, id, partial) {
  const projects = { ...(config.projects || {}) };
  projects[id] = { ...(projects[id] || {}), ...partial };
  return { ...config, projects };
}
