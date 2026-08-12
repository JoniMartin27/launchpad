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
// server/src/config.js → repo root is two levels up.
export const REPO_ROOT = path.resolve(__dirname, '..', '..');
export const CONFIG_PATH = path.join(REPO_ROOT, 'config.json');

/**
 * Default folder to scan for projects. Generic & machine-agnostic:
 *   1. MISSION_CONTROL_PROJECTS_ROOT env var (explicit override), else
 *   2. the parent of this repo — Mission Control is meant to live *inside* the
 *      workspace folder it manages (…/projects/mission-control → …/projects).
 * This makes a fresh clone work with zero config on anyone's machine.
 */
export function defaultProjectsRoot() {
  const env = process.env.MISSION_CONTROL_PROJECTS_ROOT;
  if (env && env.trim()) return path.resolve(env.trim());
  return path.resolve(REPO_ROOT, '..');
}

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
