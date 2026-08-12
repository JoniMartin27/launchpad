// state.js
// ---------------------------------------------------------------------------
// Remembering what was running, so a dashboard that died badly does not leave
// you stranded.
//
// The dashboard kills its children on SIGINT/SIGTERM, so an orderly restart has
// nothing to recover. A DISORDERLY one — Task Manager, `kill -9`, a closed lid,
// a crash — is different: the dev servers survive, and the next boot has no
// memory of them. The card says "stopped", pressing Start answers
// `PORT_IN_USE: in use by a foreign process`, and there is no button anywhere to
// stop something the dashboard does not know it started. You go hunting for the
// pid by hand — the exact chore the README promises to abolish.
//
// So each launch is written to a small state file, and on boot anything still
// alive AND still holding its port is adopted back into the catalog.
// ---------------------------------------------------------------------------

import fs from 'node:fs';
import path from 'node:path';

/** Bump when the on-disk shape changes; older files are ignored, not migrated. */
export const STATE_VERSION = 1;

/**
 * Where the state file lives: beside the config, so it follows the same rules
 * (repo root for a checkout, projects folder for an npm install).
 * @param {string} configPath
 * @returns {string}
 */
export function stateFileFor(configPath) {
  return path.join(path.dirname(configPath), '.launchpad-state.json');
}

/**
 * Read the state file. A missing, unreadable, malformed or version-mismatched
 * file is simply "nothing was running" — never an error: this is a convenience,
 * and it must not be able to stop the dashboard from booting.
 * @param {string} file
 * @returns {{ running: object[] }}
 */
export function loadState(file) {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!parsed || parsed.version !== STATE_VERSION || !Array.isArray(parsed.running)) {
      return { running: [] };
    }
    return { running: parsed.running };
  } catch {
    return { running: [] };
  }
}

/**
 * Write the state file. Best-effort: a read-only projects folder means no
 * adoption next time, which is a degradation, not a failure.
 * @param {string} file
 * @param {object[]} running  [{ id, pid, port, command, startedAt, portless }]
 */
export function saveState(file, running) {
  try {
    const payload = JSON.stringify({ version: STATE_VERSION, savedAt: new Date().toISOString(), running }, null, 2);
    fs.writeFileSync(file, payload);
    return true;
  } catch {
    return false;
  }
}

/**
 * Decide which saved processes are still really there.
 *
 * Being alive is not enough: pids are recycled, aggressively so on Windows, and
 * adopting the wrong process would let the dashboard kill something unrelated.
 * A process must ALSO still hold the port we recorded. Portless projects (bots,
 * CLIs) have no such evidence, so they are deliberately NOT adopted — claiming
 * a recycled pid is one of ours is worse than forgetting it.
 *
 * Pure: the two probes are injected, so the whole matrix is testable.
 *
 * @param {object[]} saved
 * @param {object} probes
 * @param {(pid:number) => boolean} probes.isAlive
 * @param {(port:number) => Promise<boolean>} probes.isPortBound
 * @returns {Promise<{ adopt: object[], drop: Array<{ entry: object, reason: string }> }>}
 */
export async function reconcile(saved, { isAlive, isPortBound }) {
  const adopt = [];
  const drop = [];
  for (const entry of saved || []) {
    if (!entry || typeof entry.id !== 'string' || !Number.isInteger(entry.pid)) {
      drop.push({ entry, reason: 'malformed entry' });
      continue;
    }
    if (!isAlive(entry.pid)) {
      drop.push({ entry, reason: 'process is gone' });
      continue;
    }
    if (entry.portless || entry.port == null) {
      // Alive, but nothing proves it is OUR process rather than a recycled pid.
      drop.push({ entry, reason: 'portless: cannot prove the pid is still ours' });
      continue;
    }
    // eslint-disable-next-line no-await-in-loop
    const bound = await isPortBound(entry.port);
    if (!bound) {
      drop.push({ entry, reason: `port ${entry.port} is no longer served` });
      continue;
    }
    adopt.push(entry);
  }
  return { adopt, drop };
}
