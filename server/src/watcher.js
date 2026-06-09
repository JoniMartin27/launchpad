// watcher.js
// ---------------------------------------------------------------------------
// Filesystem watcher on the projects root (SPEC item 3). Watches the IMMEDIATE
// children of projectsRoot only (a project folder appearing/disappearing), and
// on a debounced change re-runs discovery and broadcasts the diff over WS so
// open dashboards update live — without polling.
//
// Uses the built-in node:fs.watch (zero new heavy deps, per project rules).
// On Windows fs.watch is recursive-capable but we deliberately keep it shallow:
// we only care about top-level folder add/remove/rename, NOT churn inside a
// project (node_modules writes, build output, etc.) which would spam rescans.
// fs.watch on a directory fires for entries created/removed/renamed directly
// inside it, which is exactly the top-level signal we want.
// ---------------------------------------------------------------------------

import fs from 'node:fs';

// Names whose appearance/disappearance should never trigger a rescan.
const IGNORE = new Set(['node_modules', '.git', 'tmp']);

/**
 * Start watching `root` for top-level project folder changes.
 *
 * @param {object} opts
 * @param {string} opts.root            projectsRoot absolute path
 * @param {function():object} opts.onChange  called (debounced) on a relevant
 *        change; should re-run discovery and return the diff
 *        { added, removed, changed }.
 * @param {function(object):void} opts.onResult  called with the diff returned
 *        by onChange (e.g. to broadcast over WS). Skipped if the diff is empty.
 * @param {number} [opts.debounceMs=750]
 * @returns {{ close: function():void }}
 */
export function startWatcher({ root, onChange, onResult, debounceMs = 750 }) {
  let watcher = null;
  let timer = null;

  const fire = () => {
    timer = null;
    let diff;
    try {
      diff = onChange();
    } catch (err) {
      console.warn('[watcher] rescan failed:', err.message);
      return;
    }
    const changed =
      diff && (diff.added?.length || diff.removed?.length || diff.changed?.length);
    if (changed && typeof onResult === 'function') onResult(diff);
  };

  const schedule = (filename) => {
    // Ignore noise from internal folders.
    if (filename && IGNORE.has(String(filename).split(/[\\/]/)[0])) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(fire, debounceMs);
  };

  try {
    // Shallow watch: events for direct children of `root`. `recursive:false`
    // is the default; we keep it explicit for clarity and to avoid deep churn.
    watcher = fs.watch(root, { persistent: true, recursive: false }, (_event, filename) => {
      schedule(filename);
    });
    watcher.on('error', (err) => {
      console.warn('[watcher] error:', err.message);
    });
    console.log(`[mission-control] watching ${root} for project changes`);
  } catch (err) {
    console.warn(`[watcher] could not watch ${root}:`, err.message);
  }

  return {
    close() {
      if (timer) clearTimeout(timer);
      timer = null;
      try {
        watcher?.close();
      } catch {
        /* ignore */
      }
    },
  };
}
