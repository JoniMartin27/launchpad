// Frontend data model — exact mirror of SPEC §5.
// These types are the frozen contract between server/ and web/.

export type RegistryKind = 'npm' | 'pypi' | 'none';
export type CiStatus = 'passing' | 'failing' | 'none' | 'unknown';
export type RunStatus = 'stopped' | 'starting' | 'running' | 'stopping' | 'error';
export type TypeGroup = 'Node' | 'Python' | 'Static' | 'Docker' | 'Go' | 'Rust' | 'Other';
/** Node package manager detected from the project's lockfile. */
export type PackageManager = 'npm' | 'pnpm' | 'yarn' | 'bun';

/**
 * Visual/UX status the card actually renders. This is a SUPERSET of the
 * backend RunStatus: it folds in two "can't run yet" conditions that the
 * backend signals via separate fields (`needsInstall`, `failureReason` /
 * missing env), so the card can render them as friendly to-do states rather
 * than a bare red error. Derived in `deriveCardState` (store), never sent over
 * the wire. See DESIGN §4.3.
 */
export type CardState = RunStatus | 'needs-install' | 'needs-env';

export interface SubProject {
  id: string;
  name: string;
  path: string;
  type: string;
  command: string;
  assignedPort: number;
  defaultPort: number | null;
  portStrategy: string;
  status: RunStatus;
  pid: number | null;
  portInUse: boolean;
}

export interface Project {
  id: string;
  name: string;
  path: string;
  type: string;
  typeGroup: TypeGroup;
  framework: string;
  repoUrl: string | null;
  /** Detected package manager (Node projects); null for other ecosystems. */
  packageManager: PackageManager | null;

  runnable: boolean;
  command: string;
  hidden: boolean;

  // ---- port ----
  assignedPort: number;
  defaultPort: number | null;
  portStrategy: string;

  // ---- live runtime ----
  status: RunStatus;
  pid: number | null;
  startedAt: string | null;
  exitCode: number | null;
  portInUse: boolean;
  portOwnedByUs: boolean;

  // ---- last log preview ----
  lastLogLine: string | null;

  // ---- friendliness fields (backend adding IN PARALLEL — all OPTIONAL) ----
  // Degrade gracefully if any are absent (older server build). See DESIGN §2.
  needsInstall?: boolean;          // deps not installed → show Install CTA
  installing?: boolean;            // an install is in flight (also tracked locally)
  missingEnv?: string[] | null;    // names of required-but-missing env vars
  failureReason?: string | null;   // friendly, human reason a start failed/can't happen
  lastActiveAt?: string | null;    // ISO; powers "Resting peacefully" (>7d) copy
  cpu?: number | null;             // live CPU % (0–100)
  mem?: number | null;             // live MEM in bytes
  uptimeSec?: number | null;       // live uptime seconds

  // ---- cached health (may be null until first metrics fetch) ----
  registry: { kind: RegistryKind; name: string | null; latestVersion: string | null } | null;
  ci: { status: CiStatus; workflow: string | null; runUrl: string | null } | null;
  git: { branch: string | null; dirty: boolean; ahead: number; behind: number } | null;

  // ---- subprojects ----
  subprojects: SubProject[];
}

// ---- REST response shapes (SPEC §2) ----

export interface ProjectsResponse {
  projects: Project[];
  /** Discovery warnings (widened search, port clash, config entry off disk). */
  warnings?: string[];
  generatedAt: string;
}

export interface ApiError {
  error: { code: string; message: string; details?: Record<string, unknown> };
}

export interface GitInfo {
  id: string;
  isRepo: boolean;
  branch?: string;
  ahead?: number;
  behind?: number;
  dirty?: boolean;
  staged?: number;
  unstaged?: number;
  untracked?: number;
  lastCommit?: { hash: string; subject: string; relative: string };
  remoteUrl?: string | null;
}

export interface MetricsInfo {
  id: string;
  fetchedAt: string;
  registry: { kind: RegistryKind; name: string | null; latestVersion: string | null; ok: boolean; error?: string };
  ci: {
    available: boolean;
    status: CiStatus;
    conclusion?: string;
    workflow: string | null;
    runUrl: string | null;
    ranAt?: string;
  };
  port: { assignedPort: number; inUse: boolean; ownedByUs: boolean };
}

export interface LogsSnapshot {
  id: string;
  lines: string[];
  running: boolean;
  droppedBytes: number;
}

export interface HealthInfo {
  ok: boolean;
  version: string;
  uptimeSec: number;
  runningCount: number;
  boundHost: string;
  port: number;
}

export interface StartResponse {
  ok: boolean;
  id: string;
  status: RunStatus;
  pid: number;
  assignedPort: number;
  command: string;
  startedAt: string;
}

// ---- WebSocket protocol (SPEC §3) ----

export type WsClientMessage =
  | { type: 'subscribe'; projectId: string }
  | { type: 'unsubscribe'; projectId: string }
  | { type: 'ping' };

export interface WsLogReplay {
  type: 'log.replay';
  ts: string;
  projectId: string;
  lines: string[];
  droppedBytes: number;
}

export interface WsLog {
  type: 'log';
  ts: string;
  projectId: string;
  stream: 'stdout' | 'stderr';
  data: string;
}

export interface WsStatus {
  type: 'status';
  ts: string;
  projectId: string;
  status: RunStatus;
  pid: number | null;
  assignedPort: number | null;
  exitCode: number | null;
  reason: string | null;
}

export interface WsWarning {
  type: 'warning';
  ts: string;
  projectId: string;
  code: string;
  message: string;
}

export interface WsPong {
  type: 'pong';
  ts: string;
}

/**
 * Auto-detect event — backend adding IN PARALLEL (DESIGN §3, §8). Fired when
 * a rescan discovers folders that appeared/disappeared. We accept a few likely
 * shapes and normalise in the WS dispatch so we degrade gracefully:
 *   - `added` / `removed` arrays of Project (or partial) — preferred
 *   - or a full `projects` snapshot to diff against.
 */
export interface WsRescan {
  type: 'rescan';
  ts: string;
  added?: Project[];
  removed?: Array<{ id: string; name?: string } | string>;
  projects?: Project[];
}

/**
 * Live-discovery broadcast emitted by the server (file watcher + rescan/refresh
 * routes). `added`/`removed`/`changed` are id strings; `projects` is the full
 * fresh snapshot the UI reconciles against.
 */
export interface WsCatalog {
  type: 'catalog';
  ts: string;
  added?: string[];
  removed?: string[];
  changed?: string[];
  projects?: Project[];
  warnings?: string[];
}

/** Live install/setup output (DESIGN §2). Streamed during POST .../install. */
export interface WsInstallLog {
  type: 'install.log';
  ts: string;
  projectId: string;
  stream?: 'stdout' | 'stderr';
  data: string;
}

/** Install lifecycle (started / done / failed). */
export interface WsInstall {
  type: 'install';
  ts: string;
  projectId: string;
  status: 'started' | 'done' | 'failed';
  reason?: string | null;
}

export type WsServerMessage =
  | WsLogReplay
  | WsLog
  | WsStatus
  | WsWarning
  | WsPong
  | WsRescan
  | WsCatalog
  | WsInstallLog
  | WsInstall;
