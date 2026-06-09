import { useEffect, useRef, useState } from 'react';

/**
 * Renders a numeric string where each character that CHANGED since the last
 * render briefly cross-fades (DESIGN §9 "single-digit cross-fade on tick").
 * Tabular numerals (via CSS `--num`) keep width fixed so nothing relayouts.
 *
 * Implementation: per character index, when the glyph differs from the previous
 * render we tag it `data-flip` for one paint, then clear it. Cheap and layout-free.
 */
export function Digits({ value, className }: { value: string; className?: string }) {
  const prev = useRef<string>(value);
  const [flips, setFlips] = useState<boolean[]>([]);

  useEffect(() => {
    const old = prev.current;
    const next = value;
    const changed: boolean[] = [];
    for (let i = 0; i < next.length; i++) changed[i] = old[i] !== next[i];
    prev.current = next;
    setFlips(changed);
    const t = setTimeout(() => setFlips([]), 140);
    return () => clearTimeout(t);
  }, [value]);

  return (
    <span className={`digits${className ? ' ' + className : ''}`}>
      {value.split('').map((ch, i) => (
        <span key={i} className="digit" data-flip={flips[i] ? 'true' : undefined}>
          {ch}
        </span>
      ))}
    </span>
  );
}
