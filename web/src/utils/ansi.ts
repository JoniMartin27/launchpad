// ANSI handling for the log viewer (DESIGN §6). We render ANSI-FREE text:
// strip all escape sequences, then classify each line's level for left-ticks.
// Regexes are built from explicit char codes so they survive copy/paste and
// don't embed raw control bytes in source.

const ESC = '\\x1b'; // ESC (0x1B)
const BEL = '\\x07'; // BEL (0x07)

// CSI / SGR / cursor / erase: ESC [ ... <final-byte 0x40–0x7E>.
const CSI_RE = new RegExp(ESC + '\\[[0-9;?]*[ -/]*[\\x40-\\x7e]', 'g');
// OSC: ESC ] ... (BEL | ESC \). Used for window-title escapes, etc.
const OSC_RE = new RegExp(ESC + '\\][\\s\\S]*?(?:' + BEL + '|' + ESC + '\\\\)', 'g');
// Other two-char escapes: ESC followed by a single 0x40–0x5F byte.
const ESC2_RE = new RegExp(ESC + '[\\x40-\\x5f]', 'g');
// Stray control chars except \n and \t (bell, backspace, CR, vertical tab…).
// eslint-disable-next-line no-control-regex
const CTRL_RE = /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g;

/** Remove every ANSI escape sequence + stray control char from a string. */
export function stripAnsi(input: string): string {
  return input
    .replace(CSI_RE, '')
    .replace(OSC_RE, '')
    .replace(ESC2_RE, '')
    .replace(CTRL_RE, '');
}

export type LogLevel = 'error' | 'warn' | 'info';

const ERR_RE = /(error|err|exception|fatal|unhandled|EADDRINUSE|ECONN|ENOENT|fail|panic)/i;
const WARN_RE = /\b(warn|warning|deprecat)\b|⚠/i;

/** Heuristic level for left-tick colouring (DESIGN §6 level ticks). */
export function classifyLine(line: string): LogLevel {
  if (ERR_RE.test(line)) return 'error';
  if (WARN_RE.test(line)) return 'warn';
  return 'info';
}

export interface LogLine {
  text: string;
  level: LogLevel;
  key: number;
}

/**
 * Turn the raw per-project chunk mirror (possibly partial lines, possibly with
 * ANSI) into clean, classified, keyed lines ready to render. Stable keys via a
 * running index so React animates only newly-appended lines.
 */
export function toLogLines(chunks: string[]): LogLine[] {
  const joined = stripAnsi(chunks.join(''));
  const parts = joined.length ? joined.split('\n') : [];
  if (parts.length && parts[parts.length - 1] === '') parts.pop();
  return parts.map((text, i) => ({ text, level: classifyLine(text), key: i }));
}
