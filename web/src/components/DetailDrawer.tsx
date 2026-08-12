import { useEffect, useRef, useState } from 'react';
import type { Project, GitInfo, OpenTarget } from '../types';
import { getGit } from '../api/client';
import { ws } from '../api/ws';
import { LogConsole } from './LogConsole';
import { StatusDot } from './StatusDot';
import { TypeBadge } from './TypeBadge';
import { GitPanel } from './GitPanel';
import { MetricsPanel } from './MetricsPanel';
import {
  deriveCardState,
  telemetrySuppressed,
  isOpenable,
  statusLabel,
  personalityCopy
} from '../utils/presentation';

interface Props {
  project: Project;
  logs: string[];
  installLogs: string[];
  busy: boolean;
  onClose: () => void;
  onStart: (id: string) => void;
  onStop: (id: string) => void;
  onRestart: (id: string) => void;
  onInstall: (id: string) => void;
  onClearLogs: (id: string) => void;
  onOpenApp: (project: Project) => void;
  /** Hand the project path to the editor, the file manager or a terminal. */
  onOpenIn: (id: string, target: OpenTarget) => void;
}

/**
 * Detail drawer (DESIGN §5): a persistent instrument you retune. Header with a
 * big status dot + state-morphing action; three stacked panels — Live logs,
 * Git, Metrics. For needs-install / needs-env the logs panel shows the
 * install/setup output instead of runtime logs, and metrics are suppressed.
 * Switching projects keeps the shell and cross-fades the contents.
 */
export function DetailDrawer(props: Props) {
  const { project: p, logs, installLogs } = props;
  const state = deriveCardState(p);
  const suppress = telemetrySuppressed(state);

  const [git, setGit] = useState<GitInfo | null>(null);
  const [gitErr, setGitErr] = useState<string | null>(null);

  // Rolling metric history for the sparklines, accumulated from live ticks.
  const [cpuHistory, setCpuHistory] = useState<number[]>([]);
  const [memHistory, setMemHistory] = useState<number[]>([]);
  const restartsRef = useRef(0);
  const lastStatusRef = useRef(p.status);

  // Cross-fade contents on project switch (DESIGN §5 "shell stays put").
  const [fadeKey, setFadeKey] = useState(p.id);
  useEffect(() => setFadeKey(p.id), [p.id]);

  // Subscribe to this project's live log stream while open (SPEC §3.4).
  useEffect(() => {
    ws.subscribe(p.id);
    return () => ws.unsubscribe(p.id);
  }, [p.id]);

  // Reset per-project state on switch, then fetch git.
  useEffect(() => {
    let alive = true;
    setGit(null);
    setGitErr(null);
    setCpuHistory([]);
    setMemHistory([]);
    restartsRef.current = 0;
    getGit(p.id)
      .then((g) => alive && setGit(g))
      .catch((e) => alive && setGitErr(e.message));
    return () => {
      alive = false;
    };
  }, [p.id]);

  // Accumulate metric history from live values.
  useEffect(() => {
    if (state !== 'running') return;
    setCpuHistory((h) => [...h, p.cpu ?? 0].slice(-60));
    setMemHistory((h) => [...h, p.mem ?? 0].slice(-60));
  }, [p.cpu, p.mem, state]);

  // Count restarts (running re-entered after leaving it).
  useEffect(() => {
    const prev = lastStatusRef.current;
    if (p.status === 'starting' && prev !== 'starting' && prev !== 'stopped') {
      restartsRef.current += 1;
    }
    lastStatusRef.current = p.status;
  }, [p.status]);

  // Close on Escape.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && props.onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [props]);

  const openable = isOpenable(p);
  const copy = personalityCopy(state, p);

  function primary() {
    if (state === 'running' || state === 'starting' || state === 'stopping') {
      return (
        <button className="act-btn stop big" disabled={props.busy || state === 'stopping'} onClick={() => props.onStop(p.id)}>
          ⏻ Stop
        </button>
      );
    }
    if (state === 'error') {
      return (
        <button className="act-btn restart big" disabled={props.busy} onClick={() => props.onRestart(p.id)}>
          ↻ Restart
        </button>
      );
    }
    if (state === 'needs-install') {
      return (
        <button className="act-btn install big" disabled={props.busy || p.installing} onClick={() => props.onInstall(p.id)}>
          {p.installing ? '… Installing' : '⬇ Install'}
        </button>
      );
    }
    return (
      <button className="act-btn start big" disabled={props.busy || !p.runnable} onClick={() => props.onStart(p.id)}>
        ▶ Start
      </button>
    );
  }

  // For needs-install / needs-env the log panel shows install/setup output.
  const showInstallStream = state === 'needs-install';
  const logSource = showInstallStream ? installLogs : logs;

  return (
    <>
      <div className="drawer-scrim" onClick={props.onClose} />
      <aside className="drawer" role="dialog" aria-label={`${p.name} details`} data-state={state}>
        <header className="drawer-head">
          <div className="dh-main">
            <StatusDot state={state} big installing={p.installing} />
            <div className="dh-titles">
              <div className="dh-title-row">
                <h2 className="dh-title" title={p.name}>
                  {p.name}
                </h2>
                <TypeBadge project={p} />
              </div>
              <div className="dh-status">{statusLabel(state, p)}</div>
            </div>
          </div>
          <div className="dh-actions">
            {primary()}
            {!suppress && (
              <>
                {(state === 'running' || state === 'starting') && (
                  <button className="act-btn ghost" disabled={props.busy} onClick={() => props.onRestart(p.id)}>
                    ↻
                  </button>
                )}
                <button className="act-btn ghost" disabled={!openable} title="Open in browser" onClick={() => props.onOpenApp(p)}>
                  ↗
                </button>
              </>
            )}
            {/* The `cd` the README promises to save. The path is already known;
                these just hand it to the tool you would have typed it into. */}
            <span className="open-group" role="group" aria-label="Open this project">
              <button className="act-btn ghost" title="Open in your editor" onClick={() => props.onOpenIn(p.id, 'editor')}>
                ⌨
              </button>
              <button className="act-btn ghost" title="Open the folder" onClick={() => props.onOpenIn(p.id, 'folder')}>
                🗀
              </button>
              <button className="act-btn ghost" title="Open a terminal here" onClick={() => props.onOpenIn(p.id, 'terminal')}>
                ›_
              </button>
            </span>
            <button className="drawer-close" onClick={props.onClose} aria-label="Close" title="Close (Esc)">
              ✕
            </button>
          </div>
        </header>

        <div className="drawer-body" key={fadeKey}>
          {copy && <p className="drawer-copy">{copy}</p>}

          {/* needs-env hint */}
          {state === 'needs-env' && (
            <section className="panel env-setup">
              <div className="panel-head">Environment</div>
              <div className="panel-body">
                <p className="env-explainer">
                  This project needs a few environment variables before it can start. Add them to a{' '}
                  <code>.env</code> file in the project root:
                </p>
                {p.missingEnv && p.missingEnv.length > 0 && (
                  <ul className="env-list">
                    {p.missingEnv.map((v) => (
                      <li key={v}>
                        <code>{v}=</code>
                      </li>
                    ))}
                  </ul>
                )}
                <p className="env-path">
                  <code>{p.path}\.env</code>
                </p>
              </div>
            </section>
          )}

          {/* Logs / install output */}
          <section className="panel logs-panel">
            <div className="panel-head">
              {showInstallStream ? 'Install output' : 'Live logs'}
            </div>
            <LogConsole
              key={`${p.id}-${showInstallStream ? 'install' : 'run'}`}
              lines={logSource}
              onClear={showInstallStream ? undefined : () => props.onClearLogs(p.id)}
              emptyHint={
                showInstallStream
                  ? 'Press Install to set this project up — output will appear here.'
                  : p.adopted
                    ? // Honest about a real limit: this process was already running
                      // when the dashboard started, so its output went somewhere we
                      // never had a handle on. Stop and start it to get logs back.
                      'This one was already running when the dashboard started, so its output is not ours to show. Stop and start it to stream logs again.'
                    : undefined
              }
            />
          </section>

          {/* Git */}
          <GitPanel git={git} error={gitErr} />

          {/* Metrics — suppressed for telemetry-suppressed states */}
          {!suppress && (
            <MetricsPanel
              project={p}
              cpuHistory={cpuHistory}
              memHistory={memHistory}
              restarts={restartsRef.current}
            />
          )}

          {/* Subprojects */}
          {p.subprojects.length > 0 && (
            <section className="panel">
              <div className="panel-head">Subprojects</div>
              <div className="panel-body">
                {p.subprojects.map((s) => (
                  <div className="subproject" key={s.id}>
                    <StatusDot state={s.status} />
                    <span className="sp-name">{s.name}</span>
                    <span className="sp-port">:{s.assignedPort}</span>
                    <div className="sp-actions">
                      {s.status === 'running' || s.status === 'starting' ? (
                        <button className="act-btn stop sm" onClick={() => props.onStop(s.id)}>
                          ⏻
                        </button>
                      ) : (
                        <button className="act-btn start sm" onClick={() => props.onStart(s.id)}>
                          ▶
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>
      </aside>
    </>
  );
}
