import { useRef } from 'react';
import { BrandBlip } from './BrandBlip';
import { TallyPill } from './TallyPill';
import { CommandField } from './CommandField';
import { ViewToggle, type ViewMode } from './ViewToggle';
import { LiveClock } from './LiveClock';

interface Props {
  search: string;
  onSearch: (v: string) => void;
  running: number;
  starting: number;
  stopped: number;
  scanning: boolean;
  connected: boolean;
  view: ViewMode;
  onView: (m: ViewMode) => void;
  onRescan: () => void;
  rescanning: boolean;
  onNew: () => void;
}

/**
 * Top bar (DESIGN §3): brand + blip, live tally pill, ghost command field, view
 * toggle, Rescan affordance, "+ New", a live clock, and a connection indicator.
 */
export function TopBar({
  search,
  onSearch,
  running,
  starting,
  stopped,
  scanning,
  connected,
  view,
  onView,
  onRescan,
  rescanning,
  onNew
}: Props) {
  const fieldRef = useRef<HTMLInputElement>(null);

  return (
    <header className="topbar">
      <div className="topbar-inner">
        <div className="topbar-left">
          <div className="brand">
            <BrandBlip />
            <span className="wordmark">Mission Control</span>
          </div>
          <TallyPill running={running} starting={starting} stopped={stopped} scanning={scanning} />
        </div>

        <div className="topbar-center">
          <CommandField ref={fieldRef} value={search} onChange={onSearch} />
        </div>

        <div className="topbar-right">
          <button
            className={`rescan-btn${rescanning ? ' busy' : ''}`}
            onClick={onRescan}
            disabled={rescanning}
            title="Rescan project folders"
          >
            <span className="rescan-glyph" aria-hidden>
              ⟳
            </span>
            <span className="rescan-label">Rescan</span>
          </button>
          <ViewToggle mode={view} onChange={onView} />
          <button className="new-btn" onClick={onNew} title="Add a project folder">
            + New
          </button>
          <LiveClock />
          <span
            className={`conn-dot${connected ? ' online' : ''}`}
            title={connected ? 'Live — connected' : 'Reconnecting…'}
            aria-label={connected ? 'connected' : 'reconnecting'}
          />
        </div>
      </div>
    </header>
  );
}
