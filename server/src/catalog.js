// catalog.js
// ---------------------------------------------------------------------------
// In-memory catalog = single source of runtime truth. Holds:
//   - the merged base projects from discovery (id → base)
//   - runtime state per id (status, pid, child, ports, rings)
// Produces the §5 frontend Project model by combining base + runtime + warm
// metrics + cached git summary.
// ---------------------------------------------------------------------------

import { RingBuffer } from './ring.js';
import { warmMetrics } from './metrics.js';
import { installState } from './diagnose.js';

export class Catalog {
  /**
   * @param {object} settings  config.settings (ringBytes…)
   */
  constructor(settings) {
    this.settings = settings;
    /** @type {Map<string, object>} id → merged base project */
    this.base = new Map();
    /** @type {Map<string, object>} id → runtime state */
    this.runtime = new Map();
    /** @type {Map<string, RingBuffer>} id → ring buffer */
    this.rings = new Map();
    /** @type {Map<string, string>} id → last log line */
    this.lastLog = new Map();
    /** @type {Map<string, string>} id → recent clean log tail (for diagnosis) */
    this.recentTail = new Map();
    /** @type {Map<string, object>} id → base subproject (launchable individually) */
    this.subBase = new Map();
    this.warnings = [];
  }

  /**
   * Replace the discovered base set (after discovery / refresh / rescan).
   * Preserves existing runtime state for ids that survive, prunes leaked
   * runtime/ring/log entries for ids that disappeared (UNLESS their process is
   * still alive — those are kept and surfaced as a warning), and returns a diff
   * of what changed so callers (POST /api/rescan) can report it and broadcast.
   *
   * @param {object[]} projects  merged base projects from discovery
   * @param {string[]} [warnings]
   * @returns {{ added: string[], removed: string[], changed: string[] }}
   */
  setProjects(projects, warnings = []) {
    const prevBase = this.base;
    const nextById = new Map(projects.map((p) => [p.id, p]));

    // --- compute diff vs the previous base set ---
    const added = [];
    const removed = [];
    const changed = [];
    for (const id of nextById.keys()) {
      if (!prevBase.has(id)) added.push(id);
    }
    for (const [id, prev] of prevBase) {
      const next = nextById.get(id);
      if (!next) {
        removed.push(id);
      } else if (baseSignature(prev) !== baseSignature(next)) {
        changed.push(id);
      }
    }

    this.base = nextById;
    this.warnings = warnings;

    // --- prune leaked maps for ids that vanished from disk ---
    // Keep entries whose process is still alive (warn instead of dropping a
    // tracked, still-running child whose folder disappeared).
    for (const id of removed) {
      const rt = this.runtime.get(id);
      const alive = rt && (rt.status === 'running' || rt.status === 'starting' || rt.status === 'stopping');
      if (alive) {
        this.warnings.push(`project "${id}" disappeared from disk but its process is still ${rt.status}; keeping runtime until it exits`);
        continue;
      }
      this.runtime.delete(id);
      this.rings.delete(id);
      this.lastLog.delete(id);
      this.recentTail.delete(id);
    }

    // Index subprojects so they can be started/stopped by their own id.
    // Preserve subBase entries for vanished subprojects whose process is alive.
    const keptSubs = new Map();
    for (const [sid, sp] of this.subBase) {
      const rt = this.runtime.get(sid);
      const alive = rt && (rt.status === 'running' || rt.status === 'starting' || rt.status === 'stopping');
      if (alive) keptSubs.set(sid, sp);
    }
    this.subBase = keptSubs;
    for (const p of projects) {
      for (const sp of p.subprojects || []) {
        this.subBase.set(sp.id, {
          ...sp,
          parentId: p.id,
          runnable: true,
          env: {},
          portEnv: sp.portEnv || 'PORT',
          portFlag: sp.portFlag ?? null,
        });
      }
    }

    return { added, removed, changed };
  }

  /** A launchable entity (top-level project OR subproject) by id. */
  getLaunchable(id) {
    return this.base.get(id) || this.subBase.get(id) || null;
  }

  getBase(id) {
    return this.base.get(id) || null;
  }

  allBase() {
    return [...this.base.values()];
  }

  // --- rings -------------------------------------------------------------

  ensureRing(id) {
    let r = this.rings.get(id);
    if (!r) {
      r = new RingBuffer(this.settings.ringBytes || 262144);
      this.rings.set(id, r);
    }
    return r;
  }

  getRing(id) {
    return this.rings.get(id) || null;
  }

  setLastLog(id, line) {
    if (line != null) this.lastLog.set(id, line);
  }

  /** Store a rolling tail of recent clean log text (for failure diagnosis). */
  setRecentTail(id, text) {
    this.recentTail.set(id, text);
  }

  getRecentTail(id) {
    return this.recentTail.get(id) || '';
  }

  // --- runtime state -----------------------------------------------------

  getRuntime(id) {
    return this.runtime.get(id) || null;
  }

  /**
   * Create/replace runtime state for a launch. Stamps `statusChangedAt` like
   * `setStatus` does, so a port probe taken before this launch is not mistaken
   * for evidence about it.
   */
  setRuntime(id, state) {
    this.runtime.set(id, { statusChangedAt: Date.now(), ...state });
  }

  /**
   * Patch status-related fields on existing runtime. A change of `status` also
   * stamps `statusChangedAt`, which is what lets `toProject` tell a port probe
   * taken BEFORE the transition from one taken after it (see the portInUse
   * freshness check there).
   */
  setStatus(id, patch) {
    const cur = this.runtime.get(id) || {};
    const next = { ...cur, ...patch };
    if (patch.status !== undefined && patch.status !== cur.status) {
      next.statusChangedAt = Date.now();
    }
    this.runtime.set(id, next);
  }

  /** Clear the live child reference after exit (keep last status/exitCode). */
  clearChild(id) {
    const cur = this.runtime.get(id);
    if (cur) {
      cur.child = null;
      cur.pid = null;
    }
  }

  isRunning(id) {
    const rt = this.runtime.get(id);
    return rt ? rt.status === 'running' || rt.status === 'starting' : false;
  }

  /** Ports currently held by running/starting children. */
  runningPorts() {
    const set = new Set();
    for (const rt of this.runtime.values()) {
      if ((rt.status === 'running' || rt.status === 'starting') && rt.assignedPort != null) {
        set.add(rt.assignedPort);
      }
    }
    return set;
  }

  /** All tracked, still-live pids (for shutdown tree-kill). */
  allTrackedPids() {
    const pids = [];
    for (const rt of this.runtime.values()) {
      if (rt.pid && (rt.status === 'running' || rt.status === 'starting' || rt.status === 'stopping')) {
        pids.push(rt.pid);
      }
    }
    return pids;
  }

  /** Count of running projects (for /api/health). */
  runningCount() {
    let n = 0;
    for (const rt of this.runtime.values()) if (rt.status === 'running') n++;
    return n;
  }

  /**
   * Is `port` currently owned by one of our running children?
   * @param {number} port
   * @returns {boolean}
   */
  portOwnedByUs(port) {
    for (const rt of this.runtime.values()) {
      if (rt.assignedPort === port && (rt.status === 'running' || rt.status === 'starting')) return true;
    }
    return false;
  }

  // --- §5 model assembly -------------------------------------------------

  /** Build the §5 SubProject view. */
  _subView(sp) {
    const rt = this.runtime.get(sp.id);
    return {
      id: sp.id,
      name: sp.name,
      path: sp.path,
      type: sp.type,
      command: sp.command,
      assignedPort: sp.assignedPort ?? null,
      defaultPort: sp.defaultPort ?? null,
      portStrategy: rt?.portStrategy || sp.portEnv || 'PORT',
      status: rt?.status || 'stopped',
      pid: rt?.pid ?? null,
      portInUse: rt ? rt.status === 'running' : false,
    };
  }

  /**
   * Assemble the full §5 Project model for one id.
   * Cheap: uses warm caches only (no network).
   * @param {string} id
   * @param {object} [gitSummaryCache]  optional id→git summary map
   * @returns {object|null}
   */
  toProject(id, gitSummaryCache) {
    const b = this.base.get(id);
    if (!b) return null;
    const rt = this.runtime.get(id);
    const metrics = warmMetrics(id);

    const status = rt?.status || 'stopped';
    const running = status === 'running';

    // Friendly install signal (SPEC item 2): is node_modules / venv present?
    const inst = installState(b);

    return {
      id: b.id,
      name: b.name,
      path: b.path,
      type: b.type,
      typeGroup: b.typeGroup,
      framework: b.framework,
      repoUrl: b.repoUrl ?? null,
      packageManager: b.packageManager ?? null,

      runnable: b.runnable,
      command: rt?.command || b.command,
      hidden: b.hidden === true,

      assignedPort: rt?.assignedPort ?? b.assignedPort ?? null,
      defaultPort: b.defaultPort ?? null,
      portStrategy: rt?.portStrategy || b.portEnv || 'PORT',

      status,
      pid: rt?.pid ?? null,
      startedAt: rt?.startedAt ?? null,
      exitCode: rt?.exitCode ?? null,
      // When we're actively running the process, the assigned port IS in use
      // and owned by us — force true so a stale/empty metrics probe can't
      // contradict the live status. Only when not running do we trust the
      // metrics port probe (which may detect a foreign listener) — and only if
      // that probe was taken AFTER the last status change. Otherwise a card
      // stayed "port in use" for the rest of the metrics TTL (up to 60s) after
      // a stop that had already freed the port.
      portInUse: running ? true : probeIsFresh(metrics, rt) ? metrics.port.inUse : false,
      portOwnedByUs: running ? true : probeIsFresh(metrics, rt) ? metrics.port.ownedByUs : false,

      // ---- friendly status (SPEC item 2) ----
      // needsInstall: dependencies (node_modules / venv) appear missing.
      // installer:    which installer to run ("npm" | "uv" | null).
      // failureClass: when status==='error', a friendly bucket
      //               ("needs-install" | "needs-env" | "needs-build" | "error").
      // failureReason: human explanation for the current error (if any).
      needsInstall: inst.needsInstall,
      installer: inst.installer,
      installing: rt?.installing === true,
      failureClass: rt?.failureClass ?? (inst.needsInstall ? 'needs-install' : null),
      failureReason: status === 'error' ? rt?.reason ?? inst.reason ?? null : inst.needsInstall ? inst.reason : null,

      lastLogLine: this.lastLog.get(id) ?? null,

      registry: metrics
        ? { kind: metrics.registry.kind, name: metrics.registry.name, latestVersion: metrics.registry.latestVersion }
        : null,
      ci: metrics ? { status: metrics.ci.status, workflow: metrics.ci.workflow, runUrl: metrics.ci.runUrl } : null,
      git: gitSummaryCache?.[id] ?? null,

      subprojects: (b.subprojects || []).map((sp) => this._subView(sp)),
    };
  }

  /**
   * All projects as §5 models, excluding hidden unless includeHidden.
   * @param {object} opts
   * @param {boolean} [opts.includeHidden]
   * @param {object} [opts.gitSummaryCache]
   * @returns {object[]}
   */
  toProjects({ includeHidden = false, gitSummaryCache } = {}) {
    const out = [];
    for (const b of this.base.values()) {
      if (b.hidden && !includeHidden) continue;
      out.push(this.toProject(b.id, gitSummaryCache));
    }
    return out;
  }
}

/**
 * Was the cached port probe taken after the project's last status change?
 *
 * The metrics cache has a 60s TTL, so right after a stop it still holds the
 * probe from while the server was up — the card kept claiming the port was in
 * use long after it had been freed. A probe older than the transition tells us
 * nothing about the current state, so we treat it as "unknown" (false) until
 * the warmer re-probes.
 *
 * @param {object|null} metrics  warm metrics blob (has ISO `fetchedAt`)
 * @param {object|null} rt       runtime state (has ms `statusChangedAt`)
 * @returns {boolean}
 */
export function probeIsFresh(metrics, rt) {
  if (!metrics?.port) return false;
  if (!rt?.statusChangedAt) return true; // never transitioned → nothing to invalidate
  const probedAt = Date.parse(metrics.fetchedAt);
  return Number.isFinite(probedAt) && probedAt >= rt.statusChangedAt;
}

/**
 * Stable signature of a base project's discovery-relevant fields. Used to
 * detect "changed" projects across a rescan (path/type/command/port/hidden/
 * runnable changes) without treating every rescan as a full churn.
 * @param {object} b
 * @returns {string}
 */
function baseSignature(b) {
  return JSON.stringify({
    name: b.name,
    path: b.path,
    type: b.type,
    framework: b.framework,
    command: b.command,
    assignedPort: b.assignedPort,
    hidden: b.hidden === true,
    runnable: b.runnable,
    repoUrl: b.repoUrl ?? null,
    subprojects: (b.subprojects || []).map((s) => `${s.id}:${s.assignedPort}:${s.command}`),
  });
}
