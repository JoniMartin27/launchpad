import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Project, TypeGroup, OpenTarget } from './types';
import { useProjects } from './store/useProjects';
import {
  startProject,
  stopProject,
  restartProject,
  installProject,
  rescan as apiRescan,
  batchStart,
  openIn,
  updateProjectConfig,
  batchStop,
  ApiClientError
} from './api/client';
import { deriveCardState } from './utils/presentation';
import { TopBar } from './components/TopBar';
import { ActivityPulseLine } from './components/ActivityPulseLine';
import { FilterRail, TYPE_GROUPS, type SortKey } from './components/FilterRail';
import { ProjectGrid } from './components/ProjectGrid';
import { DetailDrawer } from './components/DetailDrawer';
import { ToastStack } from './components/ToastStack';
import type { ViewMode } from './components/ViewToggle';

/**
 * App root (DESIGN): owns layout, search/filter/sort/view state, lifecycle +
 * install action handlers, the Rescan affordance, drag-drop onboarding, and the
 * toast surface. All data + WS wiring lives in the useProjects store.
 */
export default function App() {
  const store = useProjects();
  const {
    projects,
    warnings,
    loading,
    error,
    connected,
    logs,
    installLogs,
    toasts,
    highlightIds,
    pulseTick,
    refresh,
    applySnapshot,
    clearLogs,
    pushToast,
    dismissToast,
    setLocalStatus,
    setLocalProject,
    setLocalInstalling
  } = store;

  // ---- UI state ----
  const [search, setSearch] = useState('');
  const [activeGroups, setActiveGroups] = useState<Set<TypeGroup>>(new Set());
  const [runningOnly, setRunningOnly] = useState(false);
  const [sort, setSort] = useState<SortKey>('recent');
  const [view, setView] = useState<ViewMode>('grid');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [busyIds, setBusyIds] = useState<Set<string>>(new Set());
  const [batchBusy, setBatchBusy] = useState(false);
  const [rescanning, setRescanning] = useState(false);
  const [dragOver, setDragOver] = useState(false);

  // ---- derived ----
  const present = useMemo<TypeGroup[]>(
    () => TYPE_GROUPS.filter((g) => projects.some((p) => p.typeGroup === g)),
    [projects]
  );

  const counts = useMemo(() => {
    let running = 0;
    let starting = 0;
    let stopped = 0;
    for (const p of projects) {
      const s = deriveCardState(p);
      if (s === 'running') running++;
      else if (s === 'starting' || s === 'stopping') starting++;
      else stopped++;
    }
    return { running, starting, stopped };
  }, [projects]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    let list = projects.filter((p) => {
      const s = deriveCardState(p);
      if (runningOnly && s !== 'running' && s !== 'starting') return false;
      if (activeGroups.size > 0 && !activeGroups.has(p.typeGroup)) return false;
      if (q) {
        const hay = `${p.name} ${p.framework} ${p.type} ${p.assignedPort} ${p.id}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });

    const statusRank = (p: Project) => {
      const s = deriveCardState(p);
      return s === 'running' ? 0 : s === 'starting' ? 1 : s === 'error' ? 2 : 3;
    };
    list = [...list].sort((a, b) => {
      switch (sort) {
        case 'name':
          return a.name.localeCompare(b.name);
        case 'status':
          return statusRank(a) - statusRank(b);
        case 'uptime': {
          const ua = a.startedAt ? new Date(a.startedAt).getTime() : Infinity;
          const ub = b.startedAt ? new Date(b.startedAt).getTime() : Infinity;
          return ua - ub;
        }
        case 'recent':
        default: {
          const ra = new Date(a.lastActiveAt || a.startedAt || 0).getTime();
          const rb = new Date(b.lastActiveAt || b.startedAt || 0).getTime();
          return rb - ra;
        }
      }
    });
    return list;
  }, [projects, search, runningOnly, activeGroups, sort]);

  const selected = useMemo(
    () => projects.find((p) => p.id === selectedId) || null,
    [projects, selectedId]
  );

  const hasActiveFilters = activeGroups.size > 0 || runningOnly || search.trim() !== '';

  // ---- helpers ----
  const setBusy = useCallback((id: string, on: boolean) => {
    setBusyIds((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  }, []);

  const toggleGroup = useCallback((g: TypeGroup) => {
    setActiveGroups((prev) => {
      const next = new Set(prev);
      if (next.has(g)) next.delete(g);
      else next.add(g);
      return next;
    });
  }, []);

  const clearFilters = useCallback(() => {
    setActiveGroups(new Set());
    setRunningOnly(false);
    setSearch('');
  }, []);

  // ---- lifecycle actions (final status arrives over WS) ----
  const handleStart = useCallback(
    async (id: string) => {
      setBusy(id, true);
      setLocalStatus(id, 'starting');
      try {
        await startProject(id);
      } catch (e) {
        const err = e as ApiClientError;
        setLocalStatus(id, 'stopped');
        pushToast({ kind: 'error', projectId: id, title: `Couldn't start ${id}`, detail: err.message });
      } finally {
        setBusy(id, false);
      }
    },
    [setBusy, setLocalStatus, pushToast]
  );

  const handleStop = useCallback(
    async (id: string) => {
      setBusy(id, true);
      setLocalStatus(id, 'stopping');
      try {
        await stopProject(id);
      } catch (e) {
        const err = e as ApiClientError;
        pushToast({ kind: 'error', projectId: id, title: `Couldn't stop ${id}`, detail: err.message });
      } finally {
        setBusy(id, false);
      }
    },
    [setBusy, setLocalStatus, pushToast]
  );

  const handleRestart = useCallback(
    async (id: string) => {
      setBusy(id, true);
      setLocalStatus(id, 'starting');
      try {
        await restartProject(id);
      } catch (e) {
        const err = e as ApiClientError;
        pushToast({ kind: 'error', projectId: id, title: `Couldn't restart ${id}`, detail: err.message });
      } finally {
        setBusy(id, false);
      }
    },
    [setBusy, setLocalStatus, pushToast]
  );

  const handleInstall = useCallback(
    async (id: string) => {
      setBusy(id, true);
      setLocalInstalling(id, true);
      try {
        await installProject(id);
        // Live output + completion arrive over WS (install.log / install).
      } catch (e) {
        const err = e as ApiClientError;
        setLocalInstalling(id, false);
        // A failed install (non-2xx) also arrives as a WS `install failed`
        // event which toasts with the reason, so only surface transport-level
        // failures here to avoid a duplicate error toast.
        if (err.code === 'NETWORK') {
          pushToast({ kind: 'error', projectId: id, title: `Couldn't install ${id}`, detail: err.message });
        }
      } finally {
        setBusy(id, false);
      }
    },
    [setBusy, setLocalInstalling, pushToast]
  );

  // ---- rescan affordance (DESIGN §3) ----
  const handleRescan = useCallback(async () => {
    setRescanning(true);
    try {
      const res = await apiRescan();
      if (res.projects) applySnapshot(res.projects, { toast: true });
      pushToast({ kind: 'info', title: 'Rescanned project folders' });
    } catch (e) {
      const err = e as ApiClientError;
      pushToast({ kind: 'error', title: 'Rescan failed', detail: err.message });
    } finally {
      setRescanning(false);
    }
  }, [applySnapshot, pushToast]);

  // ---- batch lifecycle ----
  // The server acts per project and answers with one outcome each, so the toast
  // reports what really happened rather than a blanket "done": a stack where
  // two of five came up is the normal case, not an error state.
  const runBatch = useCallback(
    async (action: 'start' | 'stop', ids: string[], verb: string) => {
      if (!ids.length) return;
      setBatchBusy(true);
      try {
        const res = action === 'start' ? await batchStart({ ids }) : await batchStop({ ids });
        const skipped = res.results.filter(
          (r) => r.outcome === 'already-running' || r.outcome === 'not-running' || r.outcome === 'not-runnable'
        ).length;
        const parts = [`${res.succeeded} ${verb}`];
        if (skipped) parts.push(`${skipped} skipped`);
        if (res.failed) parts.push(`${res.failed} failed`);
        pushToast({
          kind: res.failed ? 'error' : 'info',
          title: parts.join(' · '),
          detail: res.results
            .filter((r) => r.outcome === 'failed' || r.outcome === 'not-found')
            .map((r) => `${r.id}: ${r.reason}`)
            .join('\n') || undefined
        });
      } catch (e) {
        pushToast({ kind: 'error', title: `Batch ${action} failed`, detail: (e as ApiClientError).message });
      } finally {
        setBatchBusy(false);
      }
    },
    [pushToast]
  );

  // "Startable" is deliberately narrow: runnable, not already up, and not
  // waiting on an install. Anything else would make the count a lie.
  const startableVisible = useMemo(
    () =>
      filtered
        .filter((p) => p.runnable && !p.needsInstall && p.status !== 'running' && p.status !== 'starting')
        .map((p) => p.id),
    [filtered]
  );

  const runningIds = useMemo(
    () => projects.filter((p) => p.status === 'running' || p.status === 'starting').map((p) => p.id),
    [projects]
  );

  const handleStartVisible = useCallback(
    () => void runBatch('start', startableVisible, 'started'),
    [runBatch, startableVisible]
  );
  const handleStopAll = useCallback(() => void runBatch('stop', runningIds, 'stopping'), [runBatch, runningIds]);

  const handleOpenIn = useCallback(
    async (id: string, target: OpenTarget) => {
      try {
        await openIn(id, target);
      } catch (e) {
        const err = e as ApiClientError;
        // A missing editor or terminal is a setup problem, not a crash: say
        // which tool could not be run and carry on.
        pushToast({ kind: 'error', projectId: id, title: `Couldn't open the ${target}`, detail: err.message });
      }
    },
    [pushToast]
  );

  // Arming crash recovery is a config change: the server validates it,
  // persists it and re-runs discovery, so the fresh project comes back in the
  // response and we splice it into the grid rather than guessing.
  const handleToggleAutoRestart = useCallback(
    async (id: string, on: boolean) => {
      try {
        const updated = await updateProjectConfig(id, { autoRestart: on });
        setLocalProject(updated);
        pushToast({
          kind: 'info',
          projectId: id,
          title: on ? `${id} will restart itself if it crashes` : `${id} will stay down if it crashes`
        });
      } catch (e) {
        pushToast({ kind: 'error', projectId: id, title: "Couldn't change that setting", detail: (e as ApiClientError).message });
      }
    },
    [pushToast, setLocalProject]
  );

  // ---- open helpers ----
  const openApp = useCallback((p: Project) => {
    window.open(`http://127.0.0.1:${p.assignedPort}`, '_blank', 'noreferrer');
  }, []);

  const handleNew = useCallback(() => {
    pushToast({
      kind: 'info',
      title: 'Add a project folder',
      detail: 'Drop a folder onto this window, or place it under your projects root and Rescan.'
    });
  }, [pushToast]);

  // ---- keyboard: ⌘K focuses the command field; Esc closes drawer ----
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        const el = document.querySelector<HTMLInputElement>('.cf-input');
        el?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // ---- window-wide drag-drop onboarding (DESIGN §7.1) ----
  useEffect(() => {
    const onOver = (e: DragEvent) => {
      e.preventDefault();
      setDragOver(true);
    };
    const onLeave = (e: DragEvent) => {
      if (e.relatedTarget === null) setDragOver(false);
    };
    const onDrop = (e: DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      // The browser can't read absolute folder paths; we nudge toward Rescan.
      pushToast({
        kind: 'info',
        title: 'Folder noticed',
        detail: 'Move it under your projects root if needed, then Rescan to pick it up.',
        actions: [{ label: 'Rescan', primary: true, onClick: () => void handleRescan() }]
      });
    };
    window.addEventListener('dragover', onOver);
    window.addEventListener('dragleave', onLeave);
    window.addEventListener('drop', onDrop);
    return () => {
      window.removeEventListener('dragover', onOver);
      window.removeEventListener('dragleave', onLeave);
      window.removeEventListener('drop', onDrop);
    };
  }, [pushToast, handleRescan]);

  return (
    <div className={`app${dragOver ? ' drag-over' : ''}`}>
      <TopBar
        search={search}
        onSearch={setSearch}
        running={counts.running}
        starting={counts.starting}
        stopped={counts.stopped}
        scanning={loading}
        connected={connected}
        view={view}
        onView={setView}
        onStartVisible={handleStartVisible}
        onStopAll={handleStopAll}
        startableCount={startableVisible.length}
        batchBusy={batchBusy}
        onRescan={handleRescan}
        rescanning={rescanning}
        onNew={handleNew}
      />

      <ActivityPulseLine tick={pulseTick} />

      <main className="app-body">
        {warnings.length > 0 && (
          <div className="warn-banner" role="status">
            <span className="warn-icon" aria-hidden>
              ⚠
            </span>
            <ul className="warn-list">
              {warnings.map((w, i) => (
                // Indexed key: the list is replaced wholesale on every scan, and
                // two warnings can legitimately read the same.
                <li key={`${i}-${w}`}>{w}</li>
              ))}
            </ul>
          </div>
        )}

        <div className="content">
          {projects.length > 0 && (
            <FilterRail
              present={present}
              active={activeGroups}
              onToggle={toggleGroup}
              runningOnly={runningOnly}
              onToggleRunningOnly={() => setRunningOnly((v) => !v)}
              sort={sort}
              onSort={setSort}
            />
          )}

          <ProjectGrid
            projects={filtered}
            totalCount={projects.length}
            loading={loading}
            error={error}
            busyIds={busyIds}
            onOpenIn={handleOpenIn}
            highlightIds={highlightIds}
            view={view}
            hasActiveFilters={hasActiveFilters}
            onRetry={refresh}
            onAdd={handleNew}
            onClearFilters={clearFilters}
            onSelect={setSelectedId}
            onStart={handleStart}
            onStop={handleStop}
            onRestart={handleRestart}
            onInstall={handleInstall}
            onOpenApp={openApp}
          />
        </div>
      </main>

      <footer className="app-foot">
        <span className="foot-mark">
          <span className="foot-flame" aria-hidden>🔥</span>
          parte de{' '}
          <a href="https://fervon.dev" target="_blank" rel="noreferrer">
            Fervon
          </a>
        </span>
        <span className="foot-tag">forjado al rojo vivo</span>
      </footer>

      {selected && (
        <DetailDrawer
          project={selected}
          logs={logs[selected.id] || []}
          installLogs={installLogs[selected.id] || []}
          busy={busyIds.has(selected.id)}
          onOpenIn={handleOpenIn}
          onToggleAutoRestart={handleToggleAutoRestart}
          onClose={() => setSelectedId(null)}
          onStart={handleStart}
          onStop={handleStop}
          onRestart={handleRestart}
          onInstall={handleInstall}
          onClearLogs={clearLogs}
          onOpenApp={openApp}
        />
      )}

      {dragOver && (
        <div className="drop-overlay" aria-hidden>
          <div className="drop-msg">Drop a project folder to add it</div>
        </div>
      )}

      <ToastStack toasts={toasts} onDismiss={dismissToast} />
    </div>
  );
}
