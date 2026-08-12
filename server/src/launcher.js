// launcher.js  (a.k.a. process-manager)
// ---------------------------------------------------------------------------
// Spawns a project's dev command with the assigned PORT injected (env + CLI
// flag per framework), tracks the pid, streams logs into the ring buffer +
// WS, applies the readiness heuristic (starting → running), and tree-kills on
// Windows via `taskkill /T /F`. See SPEC §3.3, §7.
//
// Guards:
//   - double-start (ALREADY_RUNNING)
//   - port-in-use by a foreign process (PORT_IN_USE; warn, never clobber)
// ---------------------------------------------------------------------------

import { spawn, execFile } from 'node:child_process';
import { ruleForType, buildSpawnArgs, portStrategyNote } from './frameworks.js';
import { isPortFreeStrict, isPortFree, isPortInUse, allocatePort } from './ports.js';
import { makeAnsiStripper } from './ansi.js';
import { classifyFailure, installState as installStateFor } from './diagnose.js';
import {
  decideRestart,
  shouldForgiveAttempts,
  DEFAULT_MAX_ATTEMPTS,
  DEFAULT_BASE_DELAY_MS,
} from './autorestart.js';

const IS_WINDOWS = process.platform === 'win32';

function nowIso() {
  return new Date().toISOString();
}

/** Install invocation per supported package manager. */
const INSTALLERS = {
  npm: ['install'],
  pnpm: ['install'],
  yarn: ['install'],
  bun: ['install'],
  uv: ['sync'],
};

/** Substitute ${PORT} in env values. */
function resolveEnv(env, port) {
  const out = {};
  for (const [k, v] of Object.entries(env || {})) {
    out[k] = String(v).replace(/\$\{PORT\}/g, String(port));
  }
  return out;
}

export class Launcher {
  /**
   * @param {object} deps
   * @param {object} deps.catalog   catalog instance (runtime state + rings)
   * @param {WsHub}  deps.ws        WebSocket hub for broadcasts
   * @param {object} deps.settings  config.settings (portRange, readyRegex…)
   */
  constructor({ catalog, ws, settings, kill = killTree }) {
    this.catalog = catalog;
    this.ws = ws;
    this.settings = settings;
    // Injectable so a test can supply a deliberately slow killer. Without that
    // seam, "does stop() wait for the kill?" is only observable on POSIX (where
    // there is a SIGTERM grace window); on Windows `taskkill /T /F` returns at
    // once and a timing assertion passes either way.
    this.kill = kill;
    this.readyRegex = new RegExp(settings.readyRegex || 'ready in|listening on|Local:\\s+http|started server|compiled|running at', 'i');
  }

  /**
   * Resolve the port to use for a launch.
   * Precedence: explicit body.port → project.assignedPort (config/seed) →
   * first free in range. Returns { port } or { error }.
   */
  async resolvePort(project, bodyPort) {
    const { start, end } = this.settings.portRange;
    const taken = this.catalog.runningPorts();

    if (bodyPort != null) return { port: bodyPort };
    if (project.assignedPort != null) return { port: project.assignedPort };

    const p = await allocatePort({ start, end, taken });
    if (p == null) return { error: { code: 'NO_PORT_AVAILABLE', message: 'No free port in range.' } };
    return { port: p };
  }

  /**
   * Start a project.
   * @param {object} project  merged project (or subproject) model
   * @param {object} [overrides]  { port, command, extraEnv }  (launch-only)
   * @returns {Promise<{status:number, body:object}>}  HTTP-ish result
   */
  async start(project, overrides = {}) {
    const id = project.id;

    // Guard: double-start.
    const existing = this.catalog.getRuntime(id);
    if (existing && (existing.status === 'running' || existing.status === 'starting')) {
      return {
        status: 409,
        body: { error: { code: 'ALREADY_RUNNING', message: `${id} is already ${existing.status}.`, details: { pid: existing.pid, assignedPort: existing.assignedPort } } },
      };
    }

    // Resolve command + runnability.
    const command = overrides.command || project.command;
    if (!project.runnable && !overrides.command) {
      return { status: 422, body: { error: { code: 'NOT_RUNNABLE', message: `${id} is not runnable (no dev server).` } } };
    }
    if (!command) {
      return { status: 422, body: { error: { code: 'NOT_RUNNABLE', message: `${id} has no resolvable command.` } } };
    }

    // Resolve port.
    const pr = await this.resolvePort(project, overrides.port);
    if (pr.error) return { status: 409, body: { error: pr.error } };
    const port = pr.port;

    const rule = ruleForType(project.type);
    const portless = rule.portless === true || project.type === 'node-cli' || project.type === 'node-telegram-bot';
    // Monorepos run multiple children via `concurrently`; the MC-assigned port
    // only truly serves if the targeted child actually binds it. A bare
    // `npm run dev -- --port <P>` is swallowed by concurrently and the dashboard
    // boots on its OWN default port — so the ready-regex (matched against the
    // API child's output) would falsely flip us to "running" on a port nothing
    // serves. For monorepos we therefore require the assigned port to be bound
    // before reporting running; if it never binds within the grace window we
    // surface a warning instead of a false-positive. (SPEC §7 monorepo note.)
    const requirePortBind = !portless && project.type === 'monorepo';

    // Port-free check (skip for portless projects).
    if (!portless) {
      const free = await isPortFreeStrict(port);
      if (!free) {
        // Could be a stale prior run of ours, but per SPEC we warn & refuse.
        this.ws.broadcastWarning(
          id,
          'PORT_IN_USE',
          `Port ${port} in use by a foreign process; not launched.`,
          // The launch did not happen. That is a failure, not a caveat.
          'error'
        );
        return { status: 409, body: { error: { code: 'PORT_IN_USE', message: `Port ${port} is already in use by a foreign process.`, details: { port } } } };
      }
    }

    // Build spawn cmd + args with port injection.
    const { cmd, args, usedFlag } = buildSpawnArgs({
      command,
      port,
      rule,
      portFlag: project.portFlag,
      portless,
    });

    const portEnv = project.portEnv || rule.portEnv || 'PORT';
    const resolvedExtra = {
      ...resolveEnv(rule.extraEnv, port),
      ...resolveEnv(project.env, port),
      ...resolveEnv(overrides.extraEnv, port),
    };

    const env = {
      ...process.env,
      PORT: String(port),
      [portEnv]: String(port),
      FORCE_COLOR: '1',
      ...resolvedExtra,
    };

    const startedAt = nowIso();
    let child;
    try {
      child = spawn(cmd, args, {
        cwd: project.cwd || project.path,
        env,
        shell: true, // SPEC §7: shell:true (cmd/args are config-defined, not user strings)
        windowsHide: true,
        // POSIX: make the child its OWN process-group leader. With shell:true
        // the direct child is `/bin/sh`, and the dev server is its grandchild —
        // killing just the pid leaves that grandchild alive holding the port.
        // `detached` gives us a group id (= the pid) to signal as `-pid`, which
        // is what killTree does. On Windows `detached` would spawn a new console
        // window, so it stays off there (taskkill /T already walks the tree).
        detached: !IS_WINDOWS,
      });
    } catch (err) {
      this.catalog.setStatus(id, { status: 'error', reason: String(err.message || err) });
      this.ws.broadcastStatus({ projectId: id, status: 'error', pid: null, assignedPort: port, exitCode: null, reason: String(err.message || err) });
      return { status: 500, body: { error: { code: 'SPAWN_FAILED', message: String(err.message || err) } } };
    }

    if (!child.pid) {
      return { status: 500, body: { error: { code: 'SPAWN_FAILED', message: 'spawn produced no pid' } } };
    }

    const strategy = portStrategyNote(rule, usedFlag, portEnv, portless);

    // Register runtime state.
    this.catalog.setRuntime(id, {
      status: 'starting',
      pid: child.pid,
      child,
      assignedPort: port,
      startedAt,
      exitCode: null,
      portStrategy: strategy,
      command: [cmd, ...args].join(' '),
      portless,
      requirePortBind,
      // `setRuntime` replaces the whole record, so the crash counter has to be
      // carried across explicitly — otherwise every auto-restart would start
      // from zero attempts and a project that crashes on boot would be
      // relaunched forever. A start YOU asked for does reset it: you
      // intervened, so the budget is fresh.
      restartAttempts: overrides.carryAttempts ? existing?.restartAttempts || 0 : 0,
    });
    this._broadcastStatus(id, 'starting');

    // Wire logs. Strip ANSI escape codes server-side, ONCE, at ingest so the
    // ring buffer, the card preview (lastLine), the readiness regex, and the WS
    // broadcast are all clean (SPEC P0). One stripper per stream so a split
    // escape sequence never crosses stdout/stderr.
    const ring = this.catalog.ensureRing(id);
    const stripStdout = makeAnsiStripper();
    const stripStderr = makeAnsiStripper();
    // Keep a small rolling tail of recent clean output for failure diagnosis
    // (classifyFailure inspects it when the child exits non-zero on start).
    let recentTail = '';
    const onData = (stream, strip) => (chunk) => {
      const text = strip(chunk.toString('utf8'));
      if (!text) return; // nothing emitted (held back a partial escape)
      ring.push(text);
      this.catalog.setLastLog(id, ring.lastLine());
      recentTail = (recentTail + text).slice(-4000);
      this.catalog.setRecentTail?.(id, recentTail);
      this.ws.broadcastLog(id, stream, text);
      // Readiness via log regex. Skipped for monorepos: a child's "ready" line
      // does NOT prove the MC-assigned port serves (concurrently may have
      // launched the dashboard on its own default port). Those wait for the
      // port-bind poll below.
      if (!requirePortBind && this.catalog.getRuntime(id)?.status === 'starting' && this.readyRegex.test(text)) {
        this._markRunning(id);
      }
    };
    child.stdout?.on('data', onData('stdout', stripStdout));
    child.stderr?.on('data', onData('stderr', stripStderr));

    // Exit wiring.
    child.on('exit', (code, signal) => this._onExit(id, code, signal));
    child.on('error', (err) => {
      const rt = this.catalog.getRuntime(id);
      if (rt && rt.status === 'starting') {
        this.catalog.setStatus(id, { status: 'error', reason: String(err.message || err), exitCode: null });
        this._broadcastStatus(id, 'error', { reason: String(err.message || err) });
      }
    });

    // Readiness heuristics 1 (port bound) and 3 (grace timer).
    this._scheduleReadiness(id, port, portless, requirePortBind);

    return {
      status: 202,
      body: { ok: true, id, status: 'starting', pid: child.pid, assignedPort: port, command: [cmd, ...args].join(' '), startedAt },
    };
  }

  /** Poll the port and/or run a grace timer to flip starting → running. */
  _scheduleReadiness(id, port, portless, requirePortBind = false) {
    if (portless) {
      // Portless CLIs and bots bind nothing, so "still alive after a moment" is
      // the only readiness signal available. Configurable because a test needs
      // to reach `running` quickly to exercise what happens AFTER it — and
      // because 2.5s is a guess, not a law.
      setTimeout(() => {
        const rt = this.catalog.getRuntime(id);
        if (rt && rt.status === 'starting') this._markRunning(id);
      }, this.settings.portlessGraceMs ?? 2500);
      return;
    }
    let elapsed = 0;
    const tick = async () => {
      const rt = this.catalog.getRuntime(id);
      if (!rt || rt.status !== 'starting') return; // resolved or gone
      elapsed += 400;
      // Check BOTH IPv4 and IPv6 loopback: Vite binds ::1 by default on
      // Windows, so an IPv4-only probe would miss it (pato-patrick fix).
      const inUse = await isPortInUse(port).catch(() => false);
      if (inUse) {
        // Port bound → likely our child is up.
        this._markRunning(id);
        return;
      }
      if (elapsed >= 20000) {
        // Grace window elapsed without the assigned port binding.
        if (this.catalog.getRuntime(id)?.status === 'starting') {
          if (requirePortBind) {
            // Monorepo: the assigned port never bound (likely concurrently
            // swallowed the --port flag and the child is on its own default).
            // Don't claim a false-positive "running on :<port>"; warn instead.
            // The process is left alive (the user may still use the child's
            // own port); MC just won't advertise a port nothing serves.
            this.ws.broadcastWarning(
              id,
              'PORT_NOT_BOUND',
              `Started but nothing is serving on the assigned port ${port} after 20s — for monorepos the port may not have propagated through concurrently. Check the project's own dev port.`,
              // A caveat, not a failure: the process is alive and may well be
              // useful on its own port.
              'warn'
            );
            this.catalog.setStatus(id, { status: 'error', reason: `assigned port ${port} never bound (monorepo)` });
            this._broadcastStatus(id, 'error', { reason: `assigned port ${port} never bound (monorepo)` });
          } else {
            // Non-monorepo: keep the process and assume up (portless-ish app).
            this._markRunning(id);
          }
        }
        return;
      }
      setTimeout(tick, 400);
    };
    setTimeout(tick, 400);
  }

  _markRunning(id) {
    const rt = this.catalog.getRuntime(id);
    if (!rt || rt.status !== 'starting') return;
    this.catalog.setStatus(id, { status: 'running' });
    this._broadcastStatus(id, 'running');
  }

  _onExit(id, code, signal) {
    const rt = this.catalog.getRuntime(id);
    const wasStarting = rt?.status === 'starting';
    const wasStopping = rt?.status === 'stopping';
    const exitCode = code == null ? null : code;

    if (wasStarting && code && code !== 0) {
      // Exited non-zero before reaching running. Classify the blocker into a
      // friendly bucket (needs-install / needs-env / needs-build / error) from
      // the on-disk install state + the recent log tail, so the UI can show a
      // helpful reason instead of a bare "error" (SPEC item 2).
      const project = this.catalog.getLaunchable(id) || {};
      const logTail = this.catalog.getRecentTail?.(id) || '';
      const { status: failureClass, reason } = classifyFailure({ project, exitCode, logTail });
      this.catalog.setStatus(id, { status: 'error', exitCode, reason, failureClass });
      this.catalog.clearChild(id);
      this._broadcastStatus(id, 'error', { exitCode, reason, failureClass });
      return;
    }

    const wasRunning = rt?.status === 'running';
    const startedAtMs = rt?.startedAt ? Date.parse(rt.startedAt) : null;
    const attempts = rt?.restartAttempts || 0;

    this.catalog.setStatus(id, { status: 'stopped', exitCode, reason: wasStopping ? 'stopped' : signal ? `signal ${signal}` : null, failureClass: null });
    this.catalog.clearChild(id);
    this._broadcastStatus(id, 'stopped', { exitCode });

    if (wasRunning && !wasStopping) this._maybeAutoRestart(id, { exitCode, attempts, startedAtMs });
  }

  /**
   * A project died on its own. Decide whether to bring it back, and say so
   * either way — a dashboard that silently relaunches things is as unnerving as
   * one that silently gives up.
   *
   * @param {string} id
   * @param {object} ctx  { exitCode, attempts, startedAtMs }
   */
  _maybeAutoRestart(id, { exitCode, attempts, startedAtMs }) {
    const project = this.catalog.getLaunchable(id);
    if (!project) return;

    // A project that had been up for a while gets its budget back: two crashes
    // a day apart are not a crash loop.
    const forgiven = shouldForgiveAttempts(startedAtMs, Date.now(), this.settings.autoRestartHealthyMs);
    const used = forgiven ? 0 : attempts;

    const decision = decideRestart({
      enabled: project.autoRestart === true,
      exitCode,
      previousStatus: 'running',
      attempts: used,
      maxAttempts: this.settings.autoRestartMax ?? DEFAULT_MAX_ATTEMPTS,
      baseDelayMs: this.settings.autoRestartDelayMs ?? DEFAULT_BASE_DELAY_MS,
    });

    if (!decision.restart) {
      // Only worth saying out loud when the user asked for auto-restart and did
      // not get it; otherwise it is just noise about a feature they never
      // switched on.
      if (project.autoRestart === true && used >= (this.settings.autoRestartMax ?? DEFAULT_MAX_ATTEMPTS)) {
        this.ws.broadcastWarning(
          id,
          'AUTO_RESTART_GAVE_UP',
          `Not restarting ${id} again: ${decision.reason}.`,
          // You asked for recovery and you are not getting it. Say it loudly.
          'error'
        );
      }
      this.catalog.setStatus(id, { restartAttempts: 0 });
      return;
    }

    const next = used + 1;
    this.catalog.setStatus(id, { restartAttempts: next });
    this.ws.broadcastWarning(
      id,
      'AUTO_RESTARTING',
      `${id} ${decision.reason}; restarting in ${Math.round(decision.delayMs / 1000)}s (attempt ${next}).`,
      // Good news: the dashboard is fixing something. Shouting it in red made
      // the recovery look like the failure.
      'info'
    );

    const timer = setTimeout(() => {
      const rt = this.catalog.getRuntime(id);
      // Someone may have started or removed it while we waited.
      if (rt && (rt.status === 'running' || rt.status === 'starting')) return;
      const fresh = this.catalog.getLaunchable(id);
      if (!fresh) return;
      this.start(fresh, { carryAttempts: true }).catch(() => {});
    }, decision.delayMs);
    // Never hold the process open just to retry something.
    timer.unref?.();
  }

  /**
   * Stop a project: tree-kill via taskkill /T /F.
   * @param {string} id
   * @returns {Promise<{status:number, body:object}>}
   */
  async stop(id, { wait = false } = {}) {
    const rt = this.catalog.getRuntime(id);
    if (!rt || (rt.status !== 'running' && rt.status !== 'starting')) {
      return { status: 409, body: { error: { code: 'NOT_RUNNING', message: `${id} is not running.` } } };
    }
    const pid = rt.pid;
    this.catalog.setStatus(id, { status: 'stopping' });
    this._broadcastStatus(id, 'stopping');

    // On POSIX the kill is polite first: SIGTERM, then up to a two-second grace
    // window before SIGKILL. Awaiting that held the HTTP response hostage — and
    // a batch stop of five projects held it for ten seconds — for no reason:
    // the browser learns the real outcome from the `stopped` WS event that the
    // child's own exit handler pushes. So we answer 202 (accepted, in progress)
    // and let the kill finish in the background.
    // An adopted process (recovered from a previous run of the dashboard) has
    // no child handle, so no 'exit' event will ever fire for it. Nobody would
    // move it out of `stopping`, and the card would hang there forever — so we
    // confirm the death ourselves once the kill lands.
    const killing = this.kill(pid)
      .catch(() => {})
      .then(async () => {
        if (!rt.adopted) return;
        await waitFor(() => !isPidAlive(pid), 5000);
        // `adopted` described a live process we had inherited; once it is gone
        // the card is just stopped, and should not keep claiming its logs are
        // unavailable for a reason that no longer applies.
        this.catalog.setStatus(id, { status: 'stopped', exitCode: null, reason: 'stopped', adopted: false });
        this.catalog.clearChild(id);
        this._broadcastStatus(id, 'stopped', { exitCode: null });
      });

    if (wait) {
      await killing;
      return { status: 200, body: { ok: true, id, status: 'stopping' } };
    }
    // Final 'stopped' is pushed by the child 'exit' handler.
    return { status: 202, body: { ok: true, id, status: 'stopping' } };
  }

  /**
   * Restart: stop (await tree kill + port free) then start with same params.
   * Works from stopped too (no NOT_RUNNING).
   */
  async restart(project, overrides = {}) {
    const id = project.id;
    const rt = this.catalog.getRuntime(id);
    if (rt && (rt.status === 'running' || rt.status === 'starting')) {
      const port = rt.assignedPort;
      await this.kill(rt.pid);
      // Wait for exit + port free (bounded).
      await waitFor(async () => {
        const cur = this.catalog.getRuntime(id);
        const stopped = !cur || cur.status === 'stopped' || cur.status === 'error';
        const free = port == null ? true : await isPortFree(port, '127.0.0.1').catch(() => true);
        return stopped && free;
      }, 8000);
    }
    return this.start(project, overrides);
  }

  _broadcastStatus(id, status, extra = {}) {
    const rt = this.catalog.getRuntime(id);
    this.ws.broadcastStatus({
      projectId: id,
      status,
      pid: rt?.pid ?? null,
      assignedPort: rt?.assignedPort ?? null,
      exitCode: rt?.exitCode ?? null,
      reason: extra.reason ?? null,
      ...extra,
    });
  }

  /**
   * Run the dependency installer for a project (SPEC item 2), streaming its
   * output over the SAME WS log channel as a normal launch so the UI shows it
   * live. Chooses `npm install` for Node projects and `uv sync` for Python
   * projects. Refuses to install while the project is running.
   *
   * @param {object} project  merged project (or subproject) model
   * @returns {Promise<{status:number, body:object}>}
   */
  async install(project) {
    const id = project.id;
    const rt = this.catalog.getRuntime(id);
    if (rt && (rt.status === 'running' || rt.status === 'starting')) {
      return { status: 409, body: { error: { code: 'ALREADY_RUNNING', message: `${id} is ${rt.status}; stop it before installing.` } } };
    }
    const inst = installStateFor(project);
    const cwd = project.cwd || project.path;
    // Pick the installer the project actually uses: `uv sync` for Python,
    // otherwise the detected Node package manager (npm / pnpm / yarn / bun).
    // Installing with the wrong manager can rewrite a foreign lockfile.
    const installer = inst.installer || project.packageManager || 'npm';
    const cmd = INSTALLERS[installer] ? installer : 'npm';
    const args = INSTALLERS[cmd];

    const ring = this.catalog.ensureRing(id);
    const banner = `\n[mission-control] installing dependencies: ${cmd} ${args.join(' ')} (cwd: ${cwd})\n`;
    ring.push(banner);
    this.ws.broadcastInstallLog(id, 'stdout', banner);

    let child;
    try {
      child = spawn(cmd, args, { cwd, env: { ...process.env }, shell: true, windowsHide: true });
    } catch (err) {
      const msg = `\n[mission-control] install failed to spawn: ${String(err.message || err)}\n`;
      ring.push(msg);
      this.ws.broadcastInstallLog(id, 'stderr', msg);
      return { status: 500, body: { error: { code: 'SPAWN_FAILED', message: String(err.message || err) } } };
    }

    // Mark a lightweight 'installing' runtime flag so the UI can show a spinner,
    // and announce the install lifecycle so cards reflect it (type: 'install').
    this.catalog.setStatus(id, { installing: true });
    this.ws.broadcastInstall(id, 'started');

    const stripStdout = makeAnsiStripper();
    const stripStderr = makeAnsiStripper();
    const pump = (stream, strip) => (chunk) => {
      const text = strip(chunk.toString('utf8'));
      if (!text) return;
      ring.push(text);
      this.catalog.setLastLog(id, ring.lastLine());
      // Install output flows on the dedicated install.log channel so the UI
      // routes it to the "Install output" panel, not the runtime log stream.
      this.ws.broadcastInstallLog(id, stream, text);
    };
    child.stdout?.on('data', pump('stdout', stripStdout));
    child.stderr?.on('data', pump('stderr', stripStderr));

    return await new Promise((resolve) => {
      child.on('error', (err) => {
        const msg = `\n[mission-control] install error: ${String(err.message || err)}\n`;
        ring.push(msg);
        this.ws.broadcastInstallLog(id, 'stderr', msg);
        this.catalog.setStatus(id, { installing: false });
        this.ws.broadcastInstall(id, 'failed', String(err.message || err));
        resolve({ status: 500, body: { error: { code: 'SPAWN_FAILED', message: String(err.message || err) } } });
      });
      child.on('exit', (code) => {
        const ok = code === 0;
        const msg = `\n[mission-control] install ${ok ? 'completed' : `failed (exit ${code})`}\n`;
        ring.push(msg);
        this.ws.broadcastInstallLog(id, ok ? 'stdout' : 'stderr', msg);
        this.catalog.setStatus(id, { installing: false });
        // Announce completion so cards clear the spinner and re-read needsInstall.
        if (ok) this.ws.broadcastInstall(id, 'done');
        else this.ws.broadcastInstall(id, 'failed', `install exited with code ${code}`);
        resolve({ status: ok ? 200 : 500, body: ok ? { ok: true, id, installer: cmd } : { error: { code: 'SPAWN_FAILED', message: `install exited with code ${code}` } } });
      });
    });
  }

  /** Tree-kill every tracked child (dashboard shutdown). */
  async killAll() {
    const pids = this.catalog.allTrackedPids();
    await Promise.all(pids.map((pid) => this.kill(pid)));
  }
}

/**
 * Is this pid still around? Exported because adoption needs the same check on
 * boot, before any child of ours exists.
 * @param {number} pid
 * @returns {boolean}
 */
export function isPidAlive(pid) {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err?.code === 'EPERM'; // exists, owned by someone else
  }
}

/**
 * Is a process (or process group, for a negative pid) still alive?
 * Signal 0 performs the permission/existence check without delivering anything.
 * @param {number} target  pid, or -pid for a group
 * @returns {boolean}
 */
function isAlive(target) {
  try {
    process.kill(target, 0);
    return true;
  } catch (err) {
    // EPERM = it exists but belongs to someone else — still alive.
    return err?.code === 'EPERM';
  }
}

/**
 * Kill a full process tree, cross-platform. Never throws; a pid that is already
 * gone is fine.
 *
 * - **Windows**: `taskkill /PID <pid> /T /F` walks the tree for us.
 * - **POSIX**: children are spawned `detached`, so the child pid IS a process
 *   group id. Signalling `-pid` reaches the shell AND the dev server it spawned.
 *   We ask politely first (SIGTERM, so frameworks can flush and release the
 *   port) and escalate to SIGKILL only if the group is still alive after the
 *   grace window.
 *
 * @param {number} pid
 * @param {object} [opts]
 * @param {number} [opts.graceMs=2000]  time to wait for SIGTERM to land
 * @returns {Promise<void>}
 */
export function killTree(pid, { graceMs = 2000 } = {}) {
  return new Promise((resolve) => {
    if (!pid) return resolve();
    if (IS_WINDOWS) {
      execFile('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true }, () => resolve());
      return;
    }

    // POSIX. Target the process GROUP (-pid) so grandchildren die too; fall
    // back to the bare pid if the child was never detached (no group of its own).
    const targets = isAlive(-pid) ? [-pid] : [pid];
    const signal = (sig) => {
      for (const t of targets) {
        try {
          process.kill(t, sig);
        } catch {
          /* already gone */
        }
      }
    };

    signal('SIGTERM');

    const deadline = Date.now() + graceMs;
    const poll = () => {
      if (!targets.some((t) => isAlive(t))) return resolve();
      if (Date.now() >= deadline) {
        signal('SIGKILL');
        return resolve();
      }
      setTimeout(poll, 100);
    };
    setTimeout(poll, 50);
  });
}

/** Poll `fn` until truthy or timeout. */
async function waitFor(fn, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    // eslint-disable-next-line no-await-in-loop
    if (await fn()) return true;
    if (Date.now() > deadline) return false;
    // eslint-disable-next-line no-await-in-loop
    await new Promise((r) => setTimeout(r, 200));
  }
}
