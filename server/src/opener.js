// opener.js
// ---------------------------------------------------------------------------
// "Open this project in my editor / file manager / terminal" — the gesture that
// saves the `cd`, which is what the README promises and the dashboard never
// actually offered (the old `/api/open` existed but nothing in the UI called
// it, and it only knew about VS Code).
//
// SECURITY. The previous implementation ran `execFile('code', [path], { shell:
// true })`. With `shell: true` Node concatenates the arguments into a shell
// string WITHOUT escaping them (Node warns about this: DEP0190), so a project
// folder called `demo & whoami` executed `whoami`. Folder names are not user
// input in the "typed into a box" sense, but they are attacker-influenced:
// cloning a repository is enough to choose one.
//
// So: paths are never concatenated into a shell string here. Every command is
// spawned with `shell: false` and the path as a separate argv entry, where the
// operating system passes it verbatim and no metacharacter means anything.
// ---------------------------------------------------------------------------

/** What a card can open. */
export const OPEN_TARGETS = ['editor', 'folder', 'terminal'];

/**
 * Work out how to open `dir` for the given target, without ever building a
 * shell string. Pure: takes the platform, returns a plan or an error, runs
 * nothing. That is what makes the whole matrix testable on one machine.
 *
 * @param {object} opts
 * @param {string} opts.target          'editor' | 'folder' | 'terminal'
 * @param {string} opts.dir             absolute project directory (from the catalog)
 * @param {string} [opts.platform]      process.platform
 * @param {string} [opts.editorCommand] settings.editorCommand (default 'code')
 * @returns {{ cmd: string, args: string[], shell: false } | { error: { code: string, message: string } }}
 */
export function resolveOpenCommand({ target, dir, platform = process.platform, editorCommand = 'code' }) {
  if (!OPEN_TARGETS.includes(target)) {
    return {
      error: { code: 'BAD_TARGET', message: `Unknown target "${target}". Use one of: ${OPEN_TARGETS.join(', ')}.` },
    };
  }
  if (!dir || typeof dir !== 'string') {
    return { error: { code: 'NO_PATH', message: 'That project has no path on disk.' } };
  }

  const isWin = platform === 'win32';
  const isMac = platform === 'darwin';

  if (target === 'editor') {
    // Whatever the user configured. On Windows `code` is a .cmd shim, which
    // `spawn` cannot execute without a shell — so we invoke it through
    // cmd.exe's own argv (`cmd /c <editor> <dir>`), still as separate argv
    // entries, never as one concatenated string.
    return isWin
      ? { cmd: 'cmd', args: ['/c', editorCommand, dir], shell: false }
      : { cmd: editorCommand, args: [dir], shell: false };
  }

  if (target === 'folder') {
    // `explorer.exe` exits 1 even when it opened the window perfectly — a
    // long-standing Windows quirk. Its exit status carries no information, so
    // only a failure to *launch* it (ENOENT) counts as a problem.
    if (isWin) return { cmd: 'explorer', args: [dir], shell: false, ignoreExit: true };
    if (isMac) return { cmd: 'open', args: [dir], shell: false };
    return { cmd: 'xdg-open', args: [dir], shell: false };
  }

  // terminal
  if (isWin) {
    // Windows Terminal if present; the caller falls back when it is missing.
    return { cmd: 'wt', args: ['-d', dir], shell: false };
  }
  if (isMac) {
    return { cmd: 'open', args: ['-a', 'Terminal', dir], shell: false };
  }
  // Linux has no single answer. `x-terminal-emulator` is the Debian alternative
  // that usually points at whatever is installed; when it is absent the caller
  // reports TOOL_MISSING rather than guessing wrong.
  return { cmd: 'x-terminal-emulator', args: ['--working-directory', dir], shell: false };
}

/**
 * A second command to try when the first is not installed. Only Windows has a
 * sensible one: `wt` ships with Windows Terminal, which is not on every
 * machine, whereas `cmd` always is.
 *
 * @param {object} opts  same shape as resolveOpenCommand
 * @returns {{ cmd: string, args: string[], shell: false } | null}
 */
export function resolveOpenFallback({ target, dir, platform = process.platform }) {
  if (target !== 'terminal' || platform !== 'win32') return null;
  // `start` is a cmd.exe builtin: `cmd /c start "" /D <dir> cmd` opens a new
  // console in that directory. The empty "" is the window title, which `start`
  // otherwise steals from the first quoted argument.
  return { cmd: 'cmd', args: ['/c', 'start', '', '/D', dir, 'cmd'], shell: false };
}

/** Human-readable name of what we tried to launch, for error messages. */
export function toolNameFor(plan) {
  return plan?.cmd === 'cmd' ? plan.args?.[1] || 'cmd' : plan?.cmd || 'the tool';
}
