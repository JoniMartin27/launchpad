// autorestart.js
// ---------------------------------------------------------------------------
// Bringing a crashed dev server back up — carefully.
//
// A dev server that dies on its own leaves a red card and nothing else: you
// notice minutes later, when the thing you were testing stops answering. But
// restarting automatically is easy to get wrong in a way that is worse than not
// doing it at all: a project that crashes on boot would be relaunched forever,
// burning CPU and filling the log with the same stack trace.
//
// So the policy here is deliberately timid:
//   - **off unless asked for**, per project (`autoRestart: true`);
//   - only after a **non-zero** exit — a clean exit means "it finished", not
//     "it crashed", and portless CLIs finish all the time;
//   - never after YOU stopped it, and never for a start that never came up
//     (that is a needs-install / needs-env problem, and relaunching it would
//     just hide the diagnosis);
//   - a **bounded** number of attempts, with the wait growing each time;
//   - and the counter resets once the project has stayed up for a while, so a
//     server that hiccups twice a day is not eventually refused.
//
// Pure decision function: no timers, no state, no side effects. The launcher
// owns the counter and the clock; this owns the policy.
// ---------------------------------------------------------------------------

/** Attempts before we stop trying, and how long we wait between them. */
export const DEFAULT_MAX_ATTEMPTS = 3;
export const DEFAULT_BASE_DELAY_MS = 1000;

/**
 * How long a project must stay up before its crash counter is forgiven. Shorter
 * than this and we are clearly in a crash loop; longer and it is a project that
 * ran fine for a while and then fell over, which deserves a fresh budget.
 */
export const DEFAULT_HEALTHY_MS = 60_000;

/**
 * Should this exit be followed by a restart?
 *
 * @param {object} args
 * @param {boolean} args.enabled       per-project `autoRestart`
 * @param {number|null} args.exitCode
 * @param {string} args.previousStatus status the project had when it died
 * @param {number} args.attempts       consecutive restarts already made
 * @param {number} [args.maxAttempts]
 * @param {number} [args.baseDelayMs]
 * @returns {{ restart: boolean, delayMs: number, reason: string }}
 */
export function decideRestart({
  enabled,
  exitCode,
  previousStatus,
  attempts,
  maxAttempts = DEFAULT_MAX_ATTEMPTS,
  baseDelayMs = DEFAULT_BASE_DELAY_MS,
}) {
  const no = (reason) => ({ restart: false, delayMs: 0, reason });

  if (!enabled) return no('auto-restart is off for this project');
  if (previousStatus === 'stopping') return no('you stopped it');
  if (previousStatus === 'starting') {
    // It never came up. Relaunching would loop over the same missing
    // dependency or missing env var, and bury the diagnosis the UI just made.
    return no('it never finished starting; fix the reported problem first');
  }
  if (previousStatus !== 'running') return no(`it was ${previousStatus || 'not running'}`);
  if (exitCode === 0 || exitCode == null) return no('it exited cleanly, so nothing crashed');
  if (attempts >= maxAttempts) {
    return no(`already restarted ${attempts} time(s) in a row and it kept crashing`);
  }

  // 1s, 2s, 4s… so a project that is going to fail anyway fails slowly instead
  // of hammering the machine.
  const delayMs = baseDelayMs * 2 ** attempts;
  return { restart: true, delayMs, reason: `crashed with code ${exitCode}` };
}

/**
 * Has the project been up long enough to deserve a clean slate?
 * @param {number|null} startedAtMs
 * @param {number} nowMs
 * @param {number} [healthyMs]
 * @returns {boolean}
 */
export function shouldForgiveAttempts(startedAtMs, nowMs, healthyMs = DEFAULT_HEALTHY_MS) {
  if (!startedAtMs) return false;
  return nowMs - startedAtMs >= healthyMs;
}
