// Presentation helpers: derive the friendly CardState, map type→hue, status
// labels/copy, and small formatters. Keeps components declarative.

import type { CardState, Project, RunStatus } from '../types';

/**
 * Derive the visual card state from the raw project model (DESIGN §4.3).
 *
 * Priority: a project that is actively running/stopping/etc. always shows that
 * real runtime state. Only when it is at rest (stopped/error) do the "can't run
 * yet" conditions surface, so a running server never gets demoted to a to-do.
 *
 * CRITICAL (fix for the transient "Error" race): we read `status` straight from
 * the catalog and NEVER substitute a default of 'error'. An unknown/missing
 * status falls back to 'stopped', the calm resting state — never red.
 */
export function deriveCardState(p: Project): CardState {
  const raw: RunStatus = p.status || 'stopped';

  // Live runtime states win outright.
  if (raw === 'running' || raw === 'starting' || raw === 'stopping') return raw;

  // An in-flight install is its own state regardless of where it started.
  if (p.installing) return 'needs-install';

  // At rest: surface friendly "can't run" conditions.
  if (p.needsInstall) return 'needs-install';
  if (p.missingEnv && p.missingEnv.length > 0) return 'needs-env';

  if (raw === 'error') return 'error';
  return 'stopped';
}

/** Whether telemetry (metric chips / sparklines) should render (DESIGN §4.3). */
export function telemetrySuppressed(state: CardState): boolean {
  return state === 'needs-install' || state === 'needs-env';
}

/** Whether a project can be opened in a browser tab right now. */
export function isOpenable(p: Project): boolean {
  return p.status === 'running' && p.portInUse && p.portOwnedByUs;
}

// ---- type hue ----

const TYPE_VARS: Record<string, string> = {
  web: '--type-web',
  api: '--type-api',
  worker: '--type-worker',
  db: '--type-db',
  cli: '--type-cli',
  docs: '--type-docs'
};

/**
 * Map a project to one of the six DESIGN type hues (badge + corner whisper).
 * Type is cosmetic, never state-bearing, so misses are harmless (DESIGN §11).
 * We classify off the raw discovered `type`/`framework`/`typeGroup`.
 */
export function typeHueVar(p: Project): string {
  const t = `${p.type} ${p.framework} ${p.typeGroup}`.toLowerCase();
  if (/docs|astro|starlight|site/.test(t)) return TYPE_VARS.docs;
  if (/sql|postgres|mysql|sqlite|prisma|db|database/.test(t)) return TYPE_VARS.db;
  if (/bot|worker|job|cron|queue|cli|telegram/.test(t)) return /cli|tool/.test(t) ? TYPE_VARS.cli : TYPE_VARS.worker;
  if (/api|express|fastapi|fastify|server|backend|uvicorn/.test(t)) return TYPE_VARS.api;
  if (/python|py/.test(t)) return TYPE_VARS.api;
  if (/web|vite|react|next|frontend|electron|vue|svelte|html|static/.test(t)) return TYPE_VARS.web;
  return TYPE_VARS.web;
}

/** Short type label for the badge (DESIGN §4.1 "[API ·sky]"). */
export function typeLabel(p: Project): string {
  const v = typeHueVar(p);
  switch (v) {
    case TYPE_VARS.api: return 'API';
    case TYPE_VARS.db: return 'DB';
    case TYPE_VARS.worker: return 'Worker';
    case TYPE_VARS.cli: return 'CLI';
    case TYPE_VARS.docs: return 'Docs';
    default: return 'Web';
  }
}

// ---- status labels & personality copy ----

/**
 * The status-row label (DESIGN §4.1). For running projects we append the port
 * ("Running · :3000"); for errors the exit code ("Crashed · exit 1").
 */
export function statusLabel(state: CardState, p: Project): string {
  switch (state) {
    case 'running':
      return p.portInUse ? `Running · :${p.assignedPort}` : 'Running';
    case 'starting':
      return 'Starting…';
    case 'stopping':
      return 'Stopping…';
    case 'error':
      return p.exitCode != null ? `Crashed · exit ${p.exitCode}` : 'Crashed';
    case 'needs-install':
      return p.installing ? 'Installing…' : 'Needs install';
    case 'needs-env': {
      const n = p.missingEnv?.length ?? 0;
      return n ? `Missing .env — ${n} var${n === 1 ? '' : 's'}` : 'Missing .env';
    }
    case 'stopped':
    default:
      return 'Stopped';
  }
}

const SEVEN_DAYS = 7 * 24 * 60 * 60 * 1000;

/**
 * Deterministic personality copy (DESIGN §4.4). One fixed line per condition,
 * never randomised — the same card always reads the same way. Returns null when
 * there's nothing warm to say.
 */
export function personalityCopy(state: CardState, p: Project): string | null {
  if (state === 'error') {
    const code = p.exitCode != null ? `exit ${p.exitCode}` : 'it crashed';
    return `It tapped out. ${code} — want to bring it back?`;
  }
  if (state === 'needs-env') {
    return 'Almost there — it just needs a couple of secrets.';
  }
  if (state === 'needs-install') {
    return p.installing
      ? 'Pulling in its dependencies…'
      : "It hasn't been set up yet — install its dependencies to get going.";
  }
  if (state === 'running' && p.startedAt) {
    const age = Date.now() - new Date(p.startedAt).getTime();
    if (age >= 0 && age < 60_000) return 'Up and warming up.';
  }
  if (state === 'stopped') {
    const ref = p.lastActiveAt || p.startedAt;
    if (ref) {
      const idle = Date.now() - new Date(ref).getTime();
      if (idle > SEVEN_DAYS) return 'Resting peacefully.';
    }
  }
  return null;
}

// ---- formatters ----

export function formatMem(bytes: number | null | undefined): string {
  if (bytes == null || Number.isNaN(bytes)) return '—';
  if (bytes < 1024) return `${bytes}B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${Math.round(kb)}K`;
  const mb = kb / 1024;
  if (mb < 1024) return `${Math.round(mb)}M`;
  return `${(mb / 1024).toFixed(1)}G`;
}

export function formatPct(pct: number | null | undefined): string {
  if (pct == null || Number.isNaN(pct)) return '—';
  return `${Math.round(pct)}%`;
}

/** Compact uptime: "↑ 2h 14m", "↑ 47s". */
export function formatUptime(p: Project): string | null {
  let sec = p.uptimeSec ?? null;
  if (sec == null && p.startedAt) {
    sec = Math.max(0, Math.floor((Date.now() - new Date(p.startedAt).getTime()) / 1000));
  }
  if (sec == null) return null;
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if (h > 0) return `↑ ${h}h ${m}m`;
  if (m > 0) return `↑ ${m}m ${s}s`;
  return `↑ ${s}s`;
}
