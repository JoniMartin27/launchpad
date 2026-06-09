import type { CardState } from '../types';

const LABELS: Record<CardState, string> = {
  stopped: 'Stopped',
  starting: 'Starting',
  running: 'Running',
  stopping: 'Stopping',
  error: 'Crashed',
  'needs-install': 'Needs install',
  'needs-env': 'Needs environment'
};

/**
 * Status indicator that encodes color + SHAPE + MOTION together (DESIGN §4.3,
 * §11) — never color alone, for color-blind legibility. The glyph/shape lives
 * in CSS via `data-state`; this component just sizes it and labels it for a11y.
 *
 *   stopped       → hollow ring ○ (no motion)
 *   starting      → dashed ring ◐ (1.6s pulse)
 *   running       → solid dot ● (3s breathing + 8s ring-ping)
 *   error         → dot+notch ⊗ (two pulses then rest)
 *   needs-install → hollow / rotating arc ◜ when installing
 *   needs-env     → hollow ring + key line-icon
 */
export function StatusDot({
  state,
  big = false,
  installing = false
}: {
  state: CardState;
  big?: boolean;
  installing?: boolean;
}) {
  return (
    <span
      className={`status-dot${big ? ' big' : ''}`}
      data-state={state}
      data-installing={installing ? 'true' : undefined}
      role="img"
      aria-label={LABELS[state]}
      title={LABELS[state]}
    />
  );
}
