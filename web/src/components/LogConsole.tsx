import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { toLogLines } from '../utils/ansi';

interface Props {
  lines: string[];
  onClear?: () => void;
  emptyHint?: string;
}

/**
 * Shared log viewer (DESIGN §6). Renders ANSI-FREE text, autoscrolls while
 * Follow is on, level-ticks error/warn lines, soft-wraps optionally, supports a
 * substring filter and a clear action, and shows a "Jump to latest" pill when
 * the user scrolls up (which disengages Follow).
 */
export function LogConsole({ lines, onClear, emptyHint }: Props) {
  const [filter, setFilter] = useState('');
  const [follow, setFollow] = useState(true);
  const [wrap, setWrap] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);

  const clean = useMemo(() => toLogLines(lines), [lines]);
  const rendered = useMemo(() => {
    const f = filter.trim().toLowerCase();
    return f ? clean.filter((l) => l.text.toLowerCase().includes(f)) : clean;
  }, [clean, filter]);

  // Autoscroll to bottom on new content while following.
  useLayoutEffect(() => {
    if (!follow) return;
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [rendered, follow]);

  // Scrolling up disengages Follow; returning to the bottom re-engages it.
  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
    setFollow(atBottom);
  };

  const jumpToLatest = () => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
    setFollow(true);
  };

  // Re-pin to bottom when the source project changes (lines array identity
  // resets). Caller remounts via key on project switch; this is a safety net.
  useEffect(() => {
    setFollow(true);
  }, []);

  return (
    <div className="logview">
      <div className="logview-toolbar">
        <input
          className="log-filter"
          type="text"
          placeholder="Filter…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          aria-label="Filter log"
        />
        <button
          className={`pill-toggle${wrap ? ' on' : ''}`}
          onClick={() => setWrap((v) => !v)}
          aria-pressed={wrap}
          title="Soft-wrap long lines"
        >
          Wrap
        </button>
        <button
          className={`pill-toggle${follow ? ' on' : ''}`}
          onClick={() => (follow ? setFollow(false) : jumpToLatest())}
          aria-pressed={follow}
          title="Follow new output"
        >
          ▢ Follow
        </button>
        {onClear && (
          <button className="pill-toggle" onClick={onClear} title="Clear (local)">
            Clear
          </button>
        )}
      </div>

      <div className={`logview-body${wrap ? ' wrap' : ''}`} ref={scrollRef} onScroll={onScroll}>
        {rendered.length === 0 ? (
          <div className="logview-empty">
            {filter
              ? 'No lines match the filter.'
              : emptyHint || 'Quiet in here. Logs will show up the moment it has something to say.'}
          </div>
        ) : (
          rendered.map((l) => (
            <div key={l.key} className="log-line" data-level={l.level}>
              {l.text || ' '}
            </div>
          ))
        )}
      </div>

      {!follow && (
        <button className="jump-latest" onClick={jumpToLatest}>
          ↓ Jump to latest
        </button>
      )}
    </div>
  );
}
