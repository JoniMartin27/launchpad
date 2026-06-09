import type { Project } from '../types';
import { typeHueVar, typeLabel } from '../utils/presentation';

const GLYPH: Record<string, string> = {
  Web: '◇',
  API: '⬡',
  DB: '⛁',
  Worker: '⚙',
  CLI: '›_',
  Docs: '❏'
};

/**
 * Type badge (DESIGN §4.1): a small pill at the card's top-right, filled with
 * its type hue at 18% + tinted text + glyph. The hue is the THIRD redundant
 * channel after glyph + text label, so type is never the only signal (§11).
 */
export function TypeBadge({ project }: { project: Project }) {
  const hue = typeHueVar(project);
  const label = typeLabel(project);
  return (
    <span className="type-badge" style={{ ['--hue' as string]: `var(${hue})` }}>
      <span className="type-glyph" aria-hidden>
        {GLYPH[label] ?? '◇'}
      </span>
      {label}
    </span>
  );
}
