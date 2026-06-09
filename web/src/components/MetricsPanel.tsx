import type { Project } from '../types';
import { Sparkline } from './Sparkline';
import { Digits } from './Digits';
import { formatMem, formatPct, formatUptime } from '../utils/presentation';

/**
 * Metrics panel (DESIGN §5.3): CPU & MEM as 60s-rolling mini sparklines with a
 * large tabular current value (digit cross-fade), plus uptime + restart count.
 * The history arrays are accumulated by the drawer from live status/metric ticks.
 */
export function MetricsPanel({
  project: p,
  cpuHistory,
  memHistory,
  restarts
}: {
  project: Project;
  cpuHistory: number[];
  memHistory: number[];
  restarts: number;
}) {
  const memMb = (p.mem ?? 0) / (1024 * 1024);
  return (
    <section className="panel">
      <div className="panel-head">Metrics</div>
      <div className="panel-body metrics">
        <div className="metric-block">
          <div className="metric-block-head">
            <span className="mb-label">CPU</span>
            <Digits className="mb-value" value={formatPct(p.cpu ?? 0)} />
          </div>
          <Sparkline data={cpuHistory} max={100} />
        </div>

        <div className="metric-block">
          <div className="metric-block-head">
            <span className="mb-label">MEM</span>
            <Digits className="mb-value" value={formatMem(p.mem ?? 0)} />
          </div>
          <Sparkline data={memHistory.map((b) => b / (1024 * 1024))} max={Math.max(memMb * 1.2, 64)} />
        </div>

        <div className="metric-foot">
          <span>{formatUptime(p) ?? '↑ —'}</span>
          <span>
            {restarts} restart{restarts === 1 ? '' : 's'}
          </span>
        </div>
      </div>
    </section>
  );
}
