// Turning a server warning into something a person can read.
// ---------------------------------------------------------------------------
// Warnings arrive with a stable machine code (`PORT_IN_USE`,
// `AUTO_RESTART_GAVE_UP`…) and a sentence written for a human. The dashboard
// used to put the CODE in the toast title — so the first thing you read was a
// SCREAMING_CONSTANT — and painted every one of them red, including
// "restarting in 2s", which is the dashboard fixing something, not failing.
// ---------------------------------------------------------------------------

import type { ToastKind } from '../store/useProjects';

/** Headline per known code. Anything unknown is de-screamed, never shown raw. */
const HEADLINES: Record<string, string> = {
  PORT_IN_USE: 'That port is taken',
  PORT_NOT_BOUND: 'Started, but nothing is on that port',
  AUTO_RESTARTING: 'Bringing it back',
  AUTO_RESTART_GAVE_UP: 'It kept crashing, so it stays down'
};

/**
 * `AUTO_RESTART_GAVE_UP` → `Auto restart gave up`. Only a fallback: a code we
 * have not written copy for is still better read as words than as a constant.
 * @param code
 */
export function prettifyCode(code: string): string {
  const words = String(code || '')
    .toLowerCase()
    .replace(/_/g, ' ')
    .trim();
  if (!words) return 'Something happened';
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/**
 * The toast headline for a warning, prefixed with the project when we know it.
 * @param code
 * @param projectName
 */
export function warningTitle(code: string, projectName?: string): string {
  const headline = HEADLINES[code] || prettifyCode(code);
  return projectName ? `${projectName}: ${headline}` : headline;
}

/**
 * Map the server's severity onto a toast kind. Defaults to an error so an older
 * server (which sent no level) keeps its old, loud behaviour rather than
 * silently downgrading a real problem to a friendly note.
 * @param level
 */
export function warningToastKind(level?: string): ToastKind {
  if (level === 'info') return 'info';
  // A caveat keeps its own colour rather than being flattened into "info":
  // "started, but nothing is on that port" is something you must act on.
  if (level === 'warn') return 'warn';
  return 'error';
}
