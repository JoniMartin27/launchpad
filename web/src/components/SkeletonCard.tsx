/** Scanning placeholder (DESIGN §7.3): a card silhouette with shimmer chips. */
export function SkeletonCard({ index }: { index: number }) {
  return (
    <div className="card skeleton-card" style={{ ['--i' as string]: index }} aria-hidden>
      <div className="sk-top">
        <span className="sk-dot" />
        <span className="sk-badge" />
      </div>
      <span className="sk-line title" />
      <span className="sk-line path" />
      <div className="sk-metrics">
        <span className="metric-chip skeleton" />
        <span className="metric-chip skeleton" />
      </div>
      <div className="sk-actions">
        <span className="sk-btn" />
        <span className="sk-btn" />
      </div>
    </div>
  );
}
