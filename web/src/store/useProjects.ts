// Central store: projects[], live status mutation from WS, per-project log
// ring mirror, install-log streams, auto-detect (rescan) handling, and toasts.
// Plain React hooks + a module-level singleton WS (no external state lib).

import { useCallback, useEffect, useRef, useState } from 'react';
import type { Project, RunStatus, WsServerMessage } from '../types';
import { getProjects, refresh as apiRefresh } from '../api/client';
import { ws } from '../api/ws';

// Soft cap on mirrored log lines per project in the browser (server ring is the
// source of truth; this is just what we keep for rendering).
const MAX_LOG_LINES = 2000;

export type ToastKind = 'info' | 'success' | 'error' | 'discovery';

export interface Toast {
  id: number;
  kind: ToastKind;
  projectId?: string;
  title: string;
  detail?: string;
  // Discovery toasts carry actions (Add / Ignore) wired by the App layer.
  actions?: { label: string; primary?: boolean; onClick: () => void }[];
  sticky?: boolean; // don't auto-dismiss (e.g. while hovered)
}

let toastSeq = 1;

export function useProjects() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);
  const [logs, setLogs] = useState<Record<string, string[]>>({});
  const [installLogs, setInstallLogs] = useState<Record<string, string[]>>({});
  const [toasts, setToasts] = useState<Toast[]>([]);

  // Ids of cards that just animated in via rescan — gets a brief accent ring.
  const [highlightIds, setHighlightIds] = useState<Set<string>>(new Set());
  // Monotonic counter; bumping it sweeps the activity-pulse line (DESIGN §3.1).
  const [pulseTick, setPulseTick] = useState(0);

  const projectsRef = useRef<Project[]>([]);
  projectsRef.current = projects;

  const pulse = useCallback(() => setPulseTick((t) => t + 1), []);

  // ---- toasts ----
  const pushToast = useCallback((t: Omit<Toast, 'id'>): number => {
    const id = toastSeq++;
    setToasts((prev) => [{ id, ...t }, ...prev].slice(0, 6));
    if (!t.sticky) {
      setTimeout(() => setToasts((prev) => prev.filter((x) => x.id !== id)), 6000);
    }
    return id;
  }, []);

  const dismissToast = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  // ---- initial + manual load ----
  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await getProjects();
      setProjects(res.projects);
    } catch (e) {
      setError((e as Error).message || 'Failed to load projects');
    } finally {
      setLoading(false);
    }
  }, []);

  const refresh = useCallback(async () => {
    setError(null);
    try {
      const res = await apiRefresh();
      setProjects(res.projects);
      pulse();
    } catch (e) {
      setError((e as Error).message || 'Refresh failed');
    }
  }, [pulse]);

  /**
   * Apply a fresh discovery snapshot, diffing against current state so we can
   * highlight newly-added cards and toast removals (DESIGN §3, §8). Used by both
   * the Rescan affordance result and the `rescan` WS event's `projects` form.
   */
  const applySnapshot = useCallback(
    (next: Project[], opts?: { toast?: boolean }) => {
      const prevIds = new Set(projectsRef.current.map((p) => p.id));
      const nextIds = new Set(next.map((p) => p.id));
      const added = next.filter((p) => !prevIds.has(p.id));
      const removed = projectsRef.current.filter((p) => !nextIds.has(p.id));

      setProjects(next);
      if (added.length || removed.length) pulse();

      if (added.length) {
        setHighlightIds((prev) => {
          const s = new Set(prev);
          added.forEach((p) => s.add(p.id));
          return s;
        });
        added.forEach((p) => {
          // clear the highlight ring after the drawer duration
          setTimeout(() => {
            setHighlightIds((prev) => {
              const s = new Set(prev);
              s.delete(p.id);
              return s;
            });
          }, 1200);
        });
      }

      if (opts?.toast) {
        added.forEach((p) =>
          pushToast({
            kind: 'discovery',
            projectId: p.id,
            title: `Found a new project — ${p.name}`,
            detail: `${p.path} · ${p.typeGroup}`
          })
        );
        removed.forEach((p) =>
          pushToast({ kind: 'info', title: `${p.name} is no longer on disk`, detail: p.path })
        );
      }
    },
    [pulse, pushToast]
  );

  // ---- WS wiring ----
  useEffect(() => {
    load();

    const offState = ws.onStateChange(setConnected);
    const offMsg = ws.onMessage((msg: WsServerMessage) => {
      switch (msg.type) {
        case 'status': {
          setProjects((prev) =>
            prev.map((p) => {
              if (p.id === msg.projectId) {
                return {
                  ...p,
                  status: msg.status,
                  pid: msg.pid,
                  assignedPort: msg.assignedPort ?? p.assignedPort,
                  exitCode: msg.exitCode,
                  // A reason from the server becomes friendly failure copy.
                  failureReason: msg.reason ?? (msg.status === 'error' ? p.failureReason : null),
                  // Leaving 'starting' for 'running' clears an in-flight install.
                  installing: msg.status === 'running' ? false : p.installing,
                  startedAt:
                    msg.status === 'starting' || msg.status === 'running'
                      ? p.startedAt || new Date().toISOString()
                      : p.startedAt,
                  portInUse: msg.status === 'running' ? true : p.portInUse,
                  portOwnedByUs: msg.status === 'running'
                };
              }
              if (p.subprojects.some((s) => s.id === msg.projectId)) {
                return {
                  ...p,
                  subprojects: p.subprojects.map((s) =>
                    s.id === msg.projectId
                      ? { ...s, status: msg.status, pid: msg.pid, portInUse: msg.status === 'running' }
                      : s
                  )
                };
              }
              return p;
            })
          );
          pulse();
          break;
        }

        case 'log.replay': {
          setLogs((prev) => ({ ...prev, [msg.projectId]: msg.lines.slice(-MAX_LOG_LINES) }));
          break;
        }

        case 'log': {
          setLogs((prev) => {
            const existing = prev[msg.projectId] || [];
            const next = [...existing, msg.data];
            if (next.length > MAX_LOG_LINES) next.splice(0, next.length - MAX_LOG_LINES);
            return { ...prev, [msg.projectId]: next };
          });
          setProjects((prev) =>
            prev.map((p) =>
              p.id === msg.projectId ? { ...p, lastLogLine: msg.data.replace(/\n$/, '') } : p
            )
          );
          break;
        }

        case 'install.log': {
          setInstallLogs((prev) => {
            const existing = prev[msg.projectId] || [];
            const next = [...existing, msg.data];
            if (next.length > MAX_LOG_LINES) next.splice(0, next.length - MAX_LOG_LINES);
            return { ...prev, [msg.projectId]: next };
          });
          break;
        }

        case 'install': {
          setProjects((prev) =>
            prev.map((p) => {
              if (p.id !== msg.projectId) return p;
              if (msg.status === 'started') return { ...p, installing: true };
              if (msg.status === 'done') {
                return { ...p, installing: false, needsInstall: false };
              }
              // failed
              return { ...p, installing: false, failureReason: msg.reason ?? 'Install failed' };
            })
          );
          const proj = projectsRef.current.find((p) => p.id === msg.projectId);
          const name = proj?.name ?? msg.projectId;
          if (msg.status === 'done') pushToast({ kind: 'success', title: `Installed ${name}` });
          if (msg.status === 'failed') {
            pushToast({ kind: 'error', title: `Couldn't install ${name}`, detail: msg.reason ?? undefined });
          }
          pulse();
          break;
        }

        case 'catalog': {
          // The server's live-discovery broadcast (file watcher + rescan/refresh
          // routes) ships `type: 'catalog'` with id-only added/removed/changed
          // diffs plus a full `projects` snapshot. Reconcile off the snapshot so
          // an open dashboard reflects folders that appear/disappear on disk.
          if (msg.projects) applySnapshot(msg.projects, { toast: true });
          break;
        }

        case 'rescan': {
          // Accept multiple shapes (DESIGN §3, backend in parallel).
          if (msg.projects) {
            applySnapshot(msg.projects, { toast: true });
            break;
          }
          if (msg.added && msg.added.length) {
            setProjects((prev) => {
              const have = new Set(prev.map((p) => p.id));
              const fresh = msg.added!.filter((p) => !have.has(p.id));
              return [...prev, ...fresh];
            });
            setHighlightIds((prev) => {
              const s = new Set(prev);
              msg.added!.forEach((p) => s.add(p.id));
              return s;
            });
            msg.added.forEach((p) => {
              pushToast({
                kind: 'discovery',
                projectId: p.id,
                title: `Found a new project — ${p.name}`,
                detail: `${p.path} · ${p.typeGroup ?? ''}`.trim()
              });
              setTimeout(() => {
                setHighlightIds((prev) => {
                  const s = new Set(prev);
                  s.delete(p.id);
                  return s;
                });
              }, 1200);
            });
          }
          if (msg.removed && msg.removed.length) {
            const removedIds = msg.removed.map((r) => (typeof r === 'string' ? r : r.id));
            setProjects((prev) => prev.filter((p) => !removedIds.includes(p.id)));
          }
          pulse();
          break;
        }

        case 'warning': {
          const proj = projectsRef.current.find((p) => p.id === msg.projectId);
          pushToast({
            kind: 'error',
            projectId: msg.projectId,
            title: proj ? `${proj.name}: ${msg.code}` : msg.code,
            detail: msg.message
          });
          break;
        }

        case 'pong':
          break;
      }
    });

    ws.connect();
    return () => {
      offState();
      offMsg();
      ws.close();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const clearLogs = useCallback((projectId: string) => {
    setLogs((prev) => ({ ...prev, [projectId]: [] }));
  }, []);

  // Optimistic local status set (used right after a start/stop REST call).
  const setLocalStatus = useCallback((id: string, status: RunStatus) => {
    setProjects((prev) => prev.map((p) => (p.id === id ? { ...p, status } : p)));
  }, []);

  const setLocalInstalling = useCallback((id: string, installing: boolean) => {
    setProjects((prev) => prev.map((p) => (p.id === id ? { ...p, installing } : p)));
    if (installing) setInstallLogs((prev) => ({ ...prev, [id]: [] }));
  }, []);

  return {
    projects,
    loading,
    error,
    connected,
    logs,
    installLogs,
    toasts,
    highlightIds,
    pulseTick,
    load,
    refresh,
    applySnapshot,
    clearLogs,
    pushToast,
    dismissToast,
    setLocalStatus,
    setLocalInstalling
  };
}
