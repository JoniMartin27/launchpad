// Typed fetch wrappers for every REST endpoint (SPEC §2).
// All calls go through the Vite proxy in dev (/api → 127.0.0.1:7777) and are
// same-origin in the production single-port build.

import type {
  ProjectsResponse,
  Project,
  GitInfo,
  MetricsInfo,
  LogsSnapshot,
  HealthInfo,
  StartResponse,
  ApiError
} from '../types';

/** Error thrown by the client carrying the parsed API error envelope. */
export class ApiClientError extends Error {
  code: string;
  status: number;
  details?: Record<string, unknown>;
  constructor(status: number, code: string, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = 'ApiClientError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      ...init,
      headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) }
    });
  } catch (e) {
    // Network-level failure (backend down, proxy refused, etc.).
    throw new ApiClientError(0, 'NETWORK', (e as Error).message || 'Network error');
  }

  // 204 / empty body guard.
  const text = await res.text();
  const body = text ? JSON.parse(text) : null;

  if (!res.ok) {
    const env = body as ApiError | null;
    const err = env?.error;
    throw new ApiClientError(
      res.status,
      err?.code || 'HTTP_ERROR',
      err?.message || `HTTP ${res.status}`,
      err?.details
    );
  }
  return body as T;
}

// ---- projects ----

export function getProjects(includeHidden = false): Promise<ProjectsResponse> {
  const q = includeHidden ? '?includeHidden=true' : '';
  return request<ProjectsResponse>(`/api/projects${q}`);
}

export function getProject(id: string): Promise<Project> {
  return request<Project>(`/api/projects/${encodeURIComponent(id)}`);
}

// ---- lifecycle ----

export interface StartOptions {
  port?: number;
  command?: string;
  extraEnv?: Record<string, string>;
}

export function startProject(id: string, opts?: StartOptions): Promise<StartResponse> {
  return request<StartResponse>(`/api/projects/${encodeURIComponent(id)}/start`, {
    method: 'POST',
    body: JSON.stringify(opts || {})
  });
}

export function stopProject(id: string): Promise<{ ok: boolean; id: string; status: string }> {
  return request(`/api/projects/${encodeURIComponent(id)}/stop`, { method: 'POST' });
}

/** One project's outcome inside a batch. Partial success is the normal case. */
export interface BatchItem {
  id: string;
  outcome: 'started' | 'stopping' | 'already-running' | 'not-running' | 'not-runnable' | 'not-found' | 'failed';
  port?: number | null;
  reason?: string;
}

export interface BatchResult {
  ok: boolean;
  action: 'start' | 'stop';
  requested: number;
  succeeded: number;
  failed: number;
  results: BatchItem[];
}

/**
 * Start or stop several projects in one call — by id list or by named profile.
 * Note the server answers 207 when only some of them worked, and `request`
 * treats 2xx as success, so callers must read `failed`/`results` rather than
 * assuming a resolved promise means everything came up.
 */
export function batchStart(target: { ids: string[] } | { profile: string }): Promise<BatchResult> {
  return request('/api/batch/start', { method: 'POST', body: JSON.stringify(target) });
}

export function batchStop(target: { ids: string[] } | { profile: string }): Promise<BatchResult> {
  return request('/api/batch/stop', { method: 'POST', body: JSON.stringify(target) });
}

export function restartProject(id: string, opts?: StartOptions): Promise<StartResponse> {
  return request<StartResponse>(`/api/projects/${encodeURIComponent(id)}/restart`, {
    method: 'POST',
    body: JSON.stringify(opts || {})
  });
}

// ---- info ----

export function getGit(id: string): Promise<GitInfo> {
  return request<GitInfo>(`/api/projects/${encodeURIComponent(id)}/git`);
}

export function getMetrics(id: string, fresh = false): Promise<MetricsInfo> {
  const q = fresh ? '?fresh=true' : '';
  return request<MetricsInfo>(`/api/projects/${encodeURIComponent(id)}/metrics${q}`);
}

export function getLogs(id: string, tail?: number): Promise<LogsSnapshot> {
  const q = tail ? `?tail=${tail}` : '';
  return request<LogsSnapshot>(`/api/projects/${encodeURIComponent(id)}/logs${q}`);
}

// ---- system ----

export function getHealth(): Promise<HealthInfo> {
  return request<HealthInfo>('/api/health');
}

export function refresh(): Promise<{ ok: boolean; projects: Project[]; warnings?: string[] }> {
  return request('/api/refresh', { method: 'POST' });
}

/**
 * Force a filesystem rescan (DESIGN §3). Backend is adding this IN PARALLEL.
 * Falls back to /api/refresh transparently if /api/rescan isn't deployed yet
 * (404 / NOT_FOUND), so the Rescan affordance always does *something* useful.
 */
export async function rescan(): Promise<{ ok: boolean; projects: Project[]; warnings?: string[] }> {
  try {
    return await request('/api/rescan', { method: 'POST' });
  } catch (e) {
    const err = e as ApiClientError;
    if (err.status === 404 || err.code === 'NOT_FOUND' || err.code === 'HTTP_ERROR') {
      return refresh();
    }
    throw e;
  }
}

export interface InstallResponse {
  ok: boolean;
  id: string;
  status?: string;
}

/**
 * Kick off dependency install for a project (DESIGN §2; backend adding IN
 * PARALLEL). Live output streams over WS as `install.log` messages. Returns
 * immediately; lifecycle arrives via the `install` WS event.
 */
export function installProject(id: string): Promise<InstallResponse> {
  return request<InstallResponse>(`/api/projects/${encodeURIComponent(id)}/install`, {
    method: 'POST',
    body: JSON.stringify({})
  });
}

export function openInVsCode(id: string): Promise<{ ok: boolean }> {
  return request('/api/open', { method: 'POST', body: JSON.stringify({ id }) });
}
