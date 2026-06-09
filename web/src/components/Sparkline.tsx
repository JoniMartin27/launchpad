import { useId } from 'react';

/**
 * Mini sparkline (DESIGN §5.3): 1.5px accent stroke + soft area-gradient fade
 * beneath, draws left→right on mount via stroke-dashoffset (CSS, --dur-spark).
 * Pure SVG, no deps. `max` lets callers fix the scale (e.g. 100 for CPU%).
 */
export function Sparkline({
  data,
  width = 220,
  height = 40,
  max
}: {
  data: number[];
  width?: number;
  height?: number;
  max?: number;
}) {
  const gid = useId().replace(/:/g, '');
  const pad = 2;
  const w = width;
  const h = height;

  if (data.length < 2) {
    return (
      <svg className="sparkline" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" role="img" aria-label="sparkline">
        <line x1="0" y1={h - pad} x2={w} y2={h - pad} stroke="var(--slate-4)" strokeWidth="1" />
      </svg>
    );
  }

  const hi = Math.max(max ?? 0, ...data, 1);
  const lo = Math.min(...data, 0);
  const span = hi - lo || 1;
  const stepX = (w - pad * 2) / (data.length - 1);

  const pts = data.map((v, i) => {
    const x = pad + i * stepX;
    const y = pad + (1 - (v - lo) / span) * (h - pad * 2);
    return [x, y] as const;
  });

  const line = pts.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  const area = `${line} L${pts[pts.length - 1][0].toFixed(1)},${h} L${pts[0][0].toFixed(1)},${h} Z`;

  return (
    <svg
      className="sparkline"
      viewBox={`0 0 ${w} ${h}`}
      preserveAspectRatio="none"
      role="img"
      aria-label="metric over time"
    >
      <defs>
        <linearGradient id={`spark-${gid}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.25" />
          <stop offset="100%" stopColor="var(--accent)" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#spark-${gid})`} />
      <path className="spark-stroke" d={line} fill="none" stroke="var(--accent)" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}
