import { Digits } from './Digits';

/**
 * A metric chip (DESIGN §4.1): mono, tabular, e.g. `CPU 12%`. The numeric part
 * cross-fades digit-by-digit on change. `dim` desaturates it for stopped cards
 * (memory of last values); `skeleton` shows the starting-state shimmer.
 */
export function MetricChip({
  label,
  value,
  dim = false,
  skeleton = false
}: {
  label: string;
  value: string;
  dim?: boolean;
  skeleton?: boolean;
}) {
  if (skeleton) {
    return <span className="metric-chip skeleton" aria-hidden />;
  }
  return (
    <span className={`metric-chip${dim ? ' dim' : ''}`}>
      <span className="metric-label">{label}</span>
      <Digits value={value} className="metric-value" />
    </span>
  );
}
