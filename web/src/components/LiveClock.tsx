import { useEffect, useState } from 'react';
import { Digits } from './Digits';

/**
 * A steady mono clock ticking once a second (DESIGN §9) — a heartbeat that
 * confirms the system is alive even when every project is calm. Uses the
 * digit cross-fade so the seconds tick without a layout jump.
 */
export function LiveClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);
  const hh = String(now.getHours()).padStart(2, '0');
  const mm = String(now.getMinutes()).padStart(2, '0');
  const ss = String(now.getSeconds()).padStart(2, '0');
  return (
    <span className="live-clock" title="Local time" aria-label={`${hh}:${mm}:${ss}`}>
      <Digits value={`${hh}:${mm}:${ss}`} />
    </span>
  );
}
