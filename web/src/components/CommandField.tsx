import { forwardRef } from 'react';

interface Props {
  value: string;
  onChange: (v: string) => void;
  onFocusPalette?: () => void;
}

/**
 * Command field (DESIGN §3): "ghost until focused" — transparent at rest with a
 * faint placeholder + ⌘K hint, rising to a filled, accent-ringed, slightly
 * wider field on focus. Doubles as an inline project filter.
 */
export const CommandField = forwardRef<HTMLInputElement, Props>(function CommandField(
  { value, onChange, onFocusPalette },
  ref
) {
  return (
    <div className="command-field">
      <span className="cf-icon" aria-hidden>
        ⌕
      </span>
      <input
        ref={ref}
        className="cf-input"
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onFocus={onFocusPalette}
        placeholder="Jump to a project…"
        aria-label="Jump to a project"
        spellCheck={false}
      />
      <span className="cf-kbd" aria-hidden>
        ⌘K
      </span>
    </div>
  );
});
