import { BrandBlip } from './BrandBlip';

/** First-run empty state (DESIGN §7.1) — warm, with an Add-a-folder CTA. */
export function FirstRunEmpty({ onAdd }: { onAdd: () => void }) {
  return (
    <div className="empty-state first-run">
      <div className="empty-logo">
        <BrandBlip />
      </div>
      <h2>Nothing running yet.</h2>
      <p>
        Mission Control watches your project folders and lights them up here. Point it at a folder to
        begin.
      </p>
      <button className="new-btn big" onClick={onAdd}>
        + Add a folder
      </button>
      <p className="empty-hint">Or drop a project folder anywhere on this window.</p>
    </div>
  );
}

/** Filtered-to-empty state (DESIGN §7.2) — distinct copy from first-run. */
export function FilteredEmpty({ onClear }: { onClear: () => void }) {
  return (
    <div className="empty-state filtered">
      <div className="empty-mark" aria-hidden>
        ⌕
      </div>
      <h2>No projects match these filters.</h2>
      <button className="ghost-btn" onClick={onClear}>
        Clear filters
      </button>
    </div>
  );
}

/** Error state — friendly, with a retry. Never the resting state. */
export function ErrorEmpty({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="empty-state error">
      <div className="empty-mark" aria-hidden>
        ⚠
      </div>
      <h2>Couldn't reach Mission Control.</h2>
      <p className="empty-detail">{message}</p>
      <button className="ghost-btn" onClick={onRetry}>
        ↻ Try again
      </button>
    </div>
  );
}
