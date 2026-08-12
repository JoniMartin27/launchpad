import type { TypeGroup } from '../types';

export const TYPE_GROUPS: TypeGroup[] = ['Node', 'Python', 'Static', 'Docker', 'Go', 'Rust', 'Other'];

export type SortKey = 'recent' | 'name' | 'status' | 'uptime';

const SORT_LABELS: Record<SortKey, string> = {
  recent: 'recently active',
  name: 'name A–Z',
  status: 'status',
  uptime: 'uptime'
};

interface Props {
  present: TypeGroup[];
  active: Set<TypeGroup>;
  onToggle: (g: TypeGroup) => void;
  runningOnly: boolean;
  onToggleRunningOnly: () => void;
  sort: SortKey;
  onSort: (s: SortKey) => void;
}

/**
 * Filter rail (DESIGN §3.2): type chips (one per present type-group) that fill
 * with a tinted ring when active, a "Running only" chip, and a ghost Sort
 * dropdown at the right edge.
 */
export function FilterRail({
  present,
  active,
  onToggle,
  runningOnly,
  onToggleRunningOnly,
  sort,
  onSort
}: Props) {
  return (
    <div className="filter-rail">
      <div className="filter-chips" role="group" aria-label="Type filters">
        {present.map((g) => (
          <button
            key={g}
            className={`type-chip${active.has(g) ? ' active' : ''}`}
            data-group={g}
            aria-pressed={active.has(g)}
            onClick={() => onToggle(g)}
          >
            {g}
          </button>
        ))}
        <button
          className={`type-chip running${runningOnly ? ' active' : ''}`}
          aria-pressed={runningOnly}
          onClick={onToggleRunningOnly}
          title="Show only running / starting projects"
        >
          ● Running only
        </button>
      </div>

      <label className="sort-dropdown">
        <span className="sort-label">Sort:</span>
        <select value={sort} onChange={(e) => onSort(e.target.value as SortKey)} aria-label="Sort projects">
          {(Object.keys(SORT_LABELS) as SortKey[]).map((k) => (
            <option key={k} value={k}>
              {SORT_LABELS[k]}
            </option>
          ))}
        </select>
        <span className="sort-chevron" aria-hidden>
          ⌄
        </span>
      </label>
    </div>
  );
}
