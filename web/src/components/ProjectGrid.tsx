import type { Project, OpenTarget } from '../types';
import type { ViewMode } from './ViewToggle';
import { ProjectCard } from './ProjectCard';
import { SkeletonCard } from './SkeletonCard';
import { FirstRunEmpty, FilteredEmpty, ErrorEmpty } from './EmptyState';

interface Props {
  projects: Project[];
  totalCount: number; // unfiltered count, to distinguish first-run vs filtered-empty
  loading: boolean;
  error: string | null;
  busyIds: Set<string>;
  highlightIds: Set<string>;
  view: ViewMode;
  hasActiveFilters: boolean;
  onRetry: () => void;
  onAdd: () => void;
  onClearFilters: () => void;
  onSelect: (id: string) => void;
  onStart: (id: string) => void;
  onStop: (id: string) => void;
  onRestart: (id: string) => void;
  onInstall: (id: string) => void;
  onOpenApp: (project: Project) => void;
  onOpenIn: (id: string, target: OpenTarget) => void;
}

/**
 * Responsive grid/list of project cards with warm loading / scanning / empty /
 * filtered / error states (DESIGN §7). Cards settle in via a staggered cascade
 * (CSS, per-card --i).
 */
export function ProjectGrid(props: Props) {
  const { projects, totalCount, loading, error, view } = props;

  if (loading) {
    return (
      <div className={`grid ${view}`} aria-busy="true">
        {Array.from({ length: 6 }).map((_, i) => (
          <SkeletonCard key={i} index={i} />
        ))}
      </div>
    );
  }

  if (error) {
    return <ErrorEmpty message={error} onRetry={props.onRetry} />;
  }

  if (totalCount === 0) {
    return <FirstRunEmpty onAdd={props.onAdd} />;
  }

  if (projects.length === 0) {
    return props.hasActiveFilters ? (
      <FilteredEmpty onClear={props.onClearFilters} />
    ) : (
      <FirstRunEmpty onAdd={props.onAdd} />
    );
  }

  return (
    <div className={`grid ${view}`}>
      {projects.map((p, i) => (
        <ProjectCard
          key={p.id}
          project={p}
          index={i}
          busy={props.busyIds.has(p.id)}
          highlight={props.highlightIds.has(p.id)}
          list={view === 'list'}
          onSelect={props.onSelect}
          onStart={props.onStart}
          onStop={props.onStop}
          onRestart={props.onRestart}
          onInstall={props.onInstall}
          onOpenApp={props.onOpenApp}
          onOpenIn={props.onOpenIn}
        />
      ))}
    </div>
  );
}
