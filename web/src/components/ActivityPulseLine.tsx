import { useEffect, useRef, useState } from 'react';

/**
 * Activity pulse line (DESIGN §3.1): a 1px line under the top bar. At rest it's
 * a hairline; whenever ANY project's state changes system-wide, a soft accent
 * highlight sweeps left→right once (700ms) then fades. Peripheral confirmation
 * that *something* changed. Driven by a monotonic `tick` from the store.
 */
export function ActivityPulseLine({ tick }: { tick: number }) {
  const [sweeping, setSweeping] = useState(false);
  const first = useRef(true);

  useEffect(() => {
    if (first.current) {
      first.current = false;
      return; // don't sweep on initial mount
    }
    setSweeping(false);
    // force reflow so the animation restarts even on back-to-back ticks
    requestAnimationFrame(() => {
      setSweeping(true);
      const t = setTimeout(() => setSweeping(false), 720);
      return () => clearTimeout(t);
    });
  }, [tick]);

  return (
    <div className="pulse-line" aria-hidden>
      <div className={`pulse-sweep${sweeping ? ' active' : ''}`} key={tick} />
    </div>
  );
}
