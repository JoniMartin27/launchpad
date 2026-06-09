export type ViewMode = 'grid' | 'list';

/**
 * Grid / List segmented toggle (DESIGN §3) with a sliding accent-neutral puck
 * that springs between segments. The puck position is driven by `data-mode`.
 */
export function ViewToggle({ mode, onChange }: { mode: ViewMode; onChange: (m: ViewMode) => void }) {
  return (
    <div className="view-toggle" role="tablist" aria-label="View mode" data-mode={mode}>
      <span className="view-puck" aria-hidden />
      <button
        role="tab"
        aria-selected={mode === 'grid'}
        className={`view-seg${mode === 'grid' ? ' active' : ''}`}
        onClick={() => onChange('grid')}
        title="Grid view"
      >
        ▦ Grid
      </button>
      <button
        role="tab"
        aria-selected={mode === 'list'}
        className={`view-seg${mode === 'list' ? ' active' : ''}`}
        onClick={() => onChange('list')}
        title="List view"
      >
        ☰ List
      </button>
    </div>
  );
}
