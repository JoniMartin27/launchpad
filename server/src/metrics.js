// metrics.js
// ---------------------------------------------------------------------------
// Health metrics per project (SPEC §2.2 GET /api/projects/:id/metrics):
//   - registry: latest npm or PyPI version (global fetch, Node 18+)
//   - ci:       GitHub Actions latest run via `gh` CLI
//   - port:     is the assigned port in use, and owned by us?
//
// All lookups are cached with a TTL and NEVER throw out of getMetrics():
// optional tools / network failures degrade inside the response body.
// ---------------------------------------------------------------------------

import { execFile } from 'node:child_process';
import { isPortInUse } from './ports.js';

// id → { fetchedAt, data }
const cache = new Map();

/** Parse "owner/repo" slug from a GitHub remote URL. */
export function repoSlug(repoUrl) {
  if (!repoUrl) return null;
  const m = repoUrl.match(/github\.com[/:]([^/]+\/[^/.]+)/i);
  return m ? m[1] : null;
}

/** Fetch latest npm version. Returns { ok, latestVersion } or { ok:false, error }. */
async function fetchNpm(name) {
  try {
    const res = await fetch(`https://registry.npmjs.org/${encodeURIComponent(name)}/latest`, {
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) return { ok: false, error: `npm ${res.status}` };
    const json = await res.json();
    return { ok: true, latestVersion: json.version || null };
  } catch (err) {
    return { ok: false, error: String(err.message || err) };
  }
}

/** Fetch latest PyPI version. */
async function fetchPyPI(name) {
  try {
    const res = await fetch(`https://pypi.org/pypi/${encodeURIComponent(name)}/json`, {
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) return { ok: false, error: `pypi ${res.status}` };
    const json = await res.json();
    return { ok: true, latestVersion: json.info?.version || null };
  } catch (err) {
    return { ok: false, error: String(err.message || err) };
  }
}

/** Run `gh run list` for the repo. Resolves the parsed latest run, or null. */
function ghLatestRun(slug) {
  return new Promise((resolve) => {
    execFile(
      'gh',
      [
        'run',
        'list',
        '--repo',
        slug,
        '--limit',
        '1',
        '--json',
        'status,conclusion,workflowName,url,createdAt',
      ],
      { windowsHide: true, timeout: 10000 },
      (err, stdout) => {
        if (err) {
          // gh missing or not authed / no repo access.
          resolve({ available: false });
          return;
        }
        try {
          const arr = JSON.parse(String(stdout).trim() || '[]');
          if (!arr.length) {
            resolve({ available: true, status: 'none' });
            return;
          }
          const r = arr[0];
          let status = 'unknown';
          if (r.status === 'completed') {
            status = r.conclusion === 'success' ? 'passing' : 'failing';
          } else if (r.status) {
            status = 'unknown'; // in-progress / queued
          }
          resolve({
            available: true,
            status,
            conclusion: r.conclusion || null,
            workflow: r.workflowName || null,
            runUrl: r.url || null,
            ranAt: r.createdAt || null,
          });
        } catch {
          resolve({ available: false });
        }
      }
    );
  });
}

/**
 * Determine the registry kind/name for a project.
 * Heuristic: a published npm package name (from its package.json `name`) ⇒ npm;
 * a python project ⇒ pypi; otherwise none. The catalog passes hints in.
 * @param {object} project  base/merged project (has type, path)
 * @returns {{ kind:'npm'|'pypi'|'none', name:string|null }}
 */
export function registryTarget(project) {
  // Known published packages in this workspace.
  const NPM_NAMES = { lookspan: 'lookspan' };
  const PYPI_NAMES = { inferbench: 'inferbench' };
  if (NPM_NAMES[project.id]) return { kind: 'npm', name: NPM_NAMES[project.id] };
  if (PYPI_NAMES[project.id]) return { kind: 'pypi', name: PYPI_NAMES[project.id] };
  if (project.typeGroup === 'Python') return { kind: 'pypi', name: project.id };
  return { kind: 'none', name: null };
}

/**
 * Get metrics for a project, with TTL caching.
 * @param {object} project    merged project (id, repoUrl, assignedPort, type…)
 * @param {object} opts
 * @param {number} opts.ttlSec
 * @param {boolean} [opts.fresh]   bypass cache
 * @param {function(number):Promise<boolean>} [opts.isOwnedByUs]  port-owner check
 * @returns {Promise<object>}  §2.2 metrics shape (never throws)
 */
export async function getMetrics(project, { ttlSec = 60, fresh = false, isOwnedByUs } = {}) {
  const now = Date.now();
  const cached = cache.get(project.id);
  if (!fresh && cached && now - cached.fetchedAt < ttlSec * 1000) {
    return cached.data;
  }

  // --- registry ---
  const target = registryTarget(project);
  let registry;
  if (target.kind === 'npm') {
    const r = await fetchNpm(target.name);
    registry = { kind: 'npm', name: target.name, latestVersion: r.latestVersion || null, ok: r.ok, ...(r.error ? { error: r.error } : {}) };
  } else if (target.kind === 'pypi') {
    const r = await fetchPyPI(target.name);
    registry = { kind: 'pypi', name: target.name, latestVersion: r.latestVersion || null, ok: r.ok, ...(r.error ? { error: r.error } : {}) };
  } else {
    registry = { kind: 'none', name: null, latestVersion: null, ok: true };
  }

  // --- ci ---
  const slug = repoSlug(project.repoUrl);
  let ci;
  if (!slug) {
    ci = { available: false, status: 'none', workflow: null, runUrl: null };
  } else {
    const run = await ghLatestRun(slug);
    if (!run.available) {
      ci = { available: false, status: 'none', workflow: null, runUrl: null };
    } else {
      ci = {
        available: true,
        status: run.status || 'none',
        conclusion: run.conclusion || null,
        workflow: run.workflow || null,
        runUrl: run.runUrl || null,
        ranAt: run.ranAt || null,
      };
    }
  }

  // --- port ---
  let inUse = false;
  let ownedByUs = false;
  if (project.assignedPort != null) {
    // Dual-stack probe (127.0.0.1 + ::1): Vite binds IPv6 ::1 by default on
    // Windows, so an IPv4-only check reports portInUse=false even though the
    // project genuinely serves on ::1. Mirrors the launcher readiness poller.
    inUse = await isPortInUse(project.assignedPort).catch(() => false);
    if (inUse && typeof isOwnedByUs === 'function') {
      ownedByUs = await isOwnedByUs(project.assignedPort).catch(() => false);
    }
  }

  const data = {
    id: project.id,
    fetchedAt: new Date().toISOString(),
    registry,
    ci,
    port: { assignedPort: project.assignedPort ?? null, inUse, ownedByUs },
  };
  cache.set(project.id, { fetchedAt: now, data });
  return data;
}

/** Invalidate all cached metrics (POST /api/refresh). */
export function clearMetricsCache() {
  cache.clear();
}

/** Read the warm (cached) metrics for inlining into /api/projects, or null. */
export function warmMetrics(id) {
  return cache.get(id)?.data || null;
}
