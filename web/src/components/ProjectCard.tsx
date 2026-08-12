import type { CSSProperties } from 'react';
import type { Project, OpenTarget } from '../types';
import { StatusDot } from './StatusDot';
import { TypeBadge } from './TypeBadge';
import { MetricChip } from './MetricChip';
import {
  deriveCardState,
  telemetrySuppressed,
  isOpenable,
  statusLabel,
  personalityCopy,
  typeHueVar,
  formatMem,
  formatPct,
  formatUptime
} from '../utils/presentation';

interface Props {
  project: Project;
  busy: boolean;
  index: number; // for the ⌘1–9 hint + load-cascade stagger
  highlight: boolean; // just discovered → brief accent ring
  list?: boolean;
  onSelect: (id: string) => void;
  onStart: (id: string) => void;
  onStop: (id: string) => void;
  onRestart: (id: string) => void;
  onInstall: (id: string) => void;
  onOpenApp: (project: Project) => void;
  /** Hand this project's path to the editor, straight from the grid. */
  onOpenIn: (id: string, target: OpenTarget) => void;
}

/**
 * The hero object (DESIGN §4). Left edge owns status (2px), top-right owns type.
 * Renders all six states with the correct treatment, telemetry suppression for
 * needs-install / needs-env, deterministic personality copy, and a
 * state-morphing primary action. The whole card is one focus target.
 */
export function ProjectCard({
  project: p,
  busy,
  index,
  highlight,
  list = false,
  onSelect,
  onStart,
  onStop,
  onRestart,
  onInstall,
  onOpenApp,
  onOpenIn
}: Props) {
  const state = deriveCardState(p);
  const suppress = telemetrySuppressed(state);
  const copy = personalityCopy(state, p);
  const openable = isOpenable(p);
  const stagger: CSSProperties = { ['--i' as string]: index };

  const stop = (e: React.MouseEvent) => e.stopPropagation();
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      onSelect(p.id);
    } else if (e.key.toLowerCase() === 's') {
      e.preventDefault();
      if (state === 'running' || state === 'starting') onStop(p.id);
      else if (p.runnable && state !== 'needs-install' && state !== 'needs-env') onStart(p.id);
    }
  };

  // ---- primary action morphs by state (DESIGN §4.3) ----
  function primaryAction() {
    switch (state) {
      case 'running':
      case 'starting':
      case 'stopping':
        return (
          <button
            className="act-btn stop"
            disabled={busy || state === 'stopping'}
            onClick={() => onStop(p.id)}
          >
            {state === 'starting' ? (
              <>
                <span className="btn-spinner" aria-hidden /> Starting…
              </>
            ) : (
              <>⏻ Stop</>
            )}
          </button>
        );
      case 'error':
        return (
          <button className="act-btn restart" disabled={busy} onClick={() => onRestart(p.id)}>
            ↻ Restart
          </button>
        );
      case 'needs-install':
        return (
          <button
            className="act-btn install ghost-cta"
            disabled={busy || p.installing}
            onClick={() => onInstall(p.id)}
          >
            {p.installing ? (
              <>
                <span className="btn-spinner" aria-hidden /> Installing…
              </>
            ) : (
              <>⬇ Install</>
            )}
          </button>
        );
      case 'needs-env':
        return (
          <button className="act-btn setup ghost-cta" onClick={() => onSelect(p.id)}>
            🔑 Set up env
          </button>
        );
      case 'stopped':
      default:
        return (
          <button
            className="act-btn start"
            disabled={busy || !p.runnable}
            title={p.runnable ? 'Start dev server' : 'Not runnable'}
            onClick={() => onStart(p.id)}
          >
            ▶ Start
          </button>
        );
    }
  }

  return (
    <article
      className={`card${list ? ' list' : ''}${highlight ? ' just-found' : ''}`}
      data-state={state}
      style={{ ...stagger, ['--type-hue' as string]: `var(${typeHueVar(p)})` }}
      role="button"
      tabIndex={0}
      aria-label={`${p.name} — ${statusLabel(state, p)}`}
      onClick={() => onSelect(p.id)}
      onKeyDown={onKey}
    >
      {index < 9 && <span className="index-hint" aria-hidden>⌘{index + 1}</span>}

      {/* Row 1: status + type */}
      <header className="card-top">
        <span className="status-row">
          <StatusDot state={state} installing={p.installing} />
          <span className="status-label">{statusLabel(state, p)}</span>
          {/* Armed crash recovery changes what this card will do without you,
              so it has to be visible from the grid, not buried in a JSON file. */}
          {p.autoRestart && (
            <span className="auto-restart-mark" title="Restarts automatically if it crashes" aria-label="auto-restart on">
              ↺
            </span>
          )}
        </span>
        <TypeBadge project={p} />
      </header>

      {/* Title + path */}
      <div className="card-id">
        <h3 className="card-title" title={p.name}>
          {p.name}
        </h3>
        <p className="card-path" title={p.path}>
          {p.path}
        </p>
      </div>

      {/* needs-env amber banner (DESIGN §4.3) */}
      {state === 'needs-env' && (
        <div className="env-banner">
          {p.missingEnv && p.missingEnv.length
            ? `Missing: ${p.missingEnv.join(', ')}`
            : 'Missing required environment variables'}
        </div>
      )}

      {/* Personality copy / vacated-area copy (DESIGN §4.4) */}
      {copy && <p className="card-copy" data-state={state}>{copy}</p>}

      {/* Telemetry — suppressed entirely for needs-install / needs-env */}
      {!suppress && (
        <div className="metric-row">
          {state === 'starting' ? (
            <>
              <MetricChip label="CPU" value="" skeleton />
              <MetricChip label="MEM" value="" skeleton />
            </>
          ) : (
            <>
              <MetricChip
                label="CPU"
                value={formatPct(state === 'running' ? p.cpu ?? 0 : 0)}
                dim={state === 'stopped'}
              />
              <MetricChip
                label="MEM"
                value={formatMem(state === 'running' ? p.mem ?? 0 : 0)}
                dim={state === 'stopped'}
              />
              {state === 'running' && formatUptime(p) && (
                <span className="uptime">{formatUptime(p)}</span>
              )}
            </>
          )}
        </div>
      )}

      {/* Action row */}
      <footer className={`card-actions${suppress ? ' todo' : ''}`} onClick={stop}>
        {primaryAction()}
        {!suppress && (
          <>
            <button
              className="act-btn open"
              disabled={!openable}
              title={openable ? `Open http://127.0.0.1:${p.assignedPort}` : 'Not running'}
              onClick={() => onOpenApp(p)}
            >
              ↗ Open
            </button>
            {/* The single most frequent reason to touch a card is "take me to
                this code". The other two targets (folder, terminal) live in the
                drawer — three more buttons per card would drown the grid. */}
            <button
              className="act-btn open-editor"
              title="Open in your editor"
              onClick={() => onOpenIn(p.id, 'editor')}
            >
              ⌨
            </button>
            <button className="act-btn more" title="Details" onClick={() => onSelect(p.id)}>
              ⋯
            </button>
          </>
        )}
      </footer>
    </article>
  );
}
