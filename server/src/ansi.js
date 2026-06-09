// ansi.js
// ---------------------------------------------------------------------------
// Strip ANSI/VT escape sequences from log text server-side, BEFORE it is
// buffered into the ring, used for the card preview, matched by the readiness
// regex, or broadcast over WS. Dev servers emit SGR color codes (the launcher
// even forces FORCE_COLOR=1) which otherwise render as garbage like "[44m[1m"
// in the browser. See punch-list P0.
//
// We strip once, at ingest. The regex covers the common families:
//   - CSI sequences   ESC [ ... <final byte>   (colors, cursor moves)
//   - OSC / charset    ESC ] / ESC ( etc.
// The introducer is ESC () or the 8-bit CSI byte (). Regexes are
// built from string literals with \u escapes so no raw control bytes live in
// this source file (they don't survive some editors/transports cleanly).
//
// Edge case: an escape sequence can be split across two stdout chunks (e.g.
// "ESC[" in chunk A, "44m" in chunk B). A single-pass regex cannot see across
// chunks, so makeAnsiStripper() holds a trailing partial-escape sliver until
// the next chunk completes it. The launcher uses the stateful version (one per
// stream); the stateless stripAnsi is kept for tests / one-shot use.
// ---------------------------------------------------------------------------

// Introducer character class: ESC or 8-bit CSI.
const INTRO = '[\\u001b\\u009b]';

// Matches a *complete* ANSI escape sequence.
const ANSI_RE = new RegExp(
  INTRO + '[[\\]()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-PR-TZcf-nq-uy=><~]',
  'g'
);

// Matches a *trailing partial* escape at the very end of a chunk: an ESC/CSI
// that has begun a sequence but is not yet terminated by a final byte. The
// leading introducer is MANDATORY, so plain trailing text/digits (e.g.
// "port 4003\n") is never held back — only a genuinely unterminated escape is.
const TRAILING_PARTIAL_RE = new RegExp(INTRO + '[[\\]()#;?]*[0-9;]*$');

/**
 * Stateless strip of all complete ANSI escape sequences in a string.
 * @param {string} s
 * @returns {string}
 */
export function stripAnsi(s) {
  if (!s) return s;
  // Reset lastIndex defensively (global regex is stateful across calls).
  ANSI_RE.lastIndex = 0;
  return s.replace(ANSI_RE, '');
}

/**
 * Create a stateful stripper that correctly handles escape sequences split
 * across chunk boundaries. Returns a function (chunk:string) => cleanText.
 * Any trailing partial escape is buffered and prepended to the next chunk.
 *
 * Use one stripper per stream (stdout/stderr) per project so the carried sliver
 * never crosses streams.
 * @returns {(chunk: string) => string}
 */
export function makeAnsiStripper() {
  let carry = '';
  return (chunk) => {
    const input = carry + (chunk || '');
    carry = '';
    // Hold back any unterminated escape at the very end for the next chunk,
    // then strip all complete sequences from what remains.
    let pending = input;
    const m = pending.match(TRAILING_PARTIAL_RE);
    if (m) {
      carry = m[0];
      pending = pending.slice(0, pending.length - carry.length);
    }
    return stripAnsi(pending);
  };
}

export { ANSI_RE };
