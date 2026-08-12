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
import path from 'node:path';

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
export function startWatcher({ root, onChange, onResult, debounceMs = 750, depth = 1 }) {
  /** @type {import('node:fs').FSWatcher[]} */
  const watchers = [];
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

  /**
   * Watch one directory shallowly. `recursive: false` is deliberate: we only
   * care about folders appearing/disappearing, not about churn inside a project
   * (node_modules writes, build output) which would spam rescans. It is also
   * the only mode that behaves the same on Linux, where recursive fs.watch is
   * not supported.
   * @param {string} dir
   */
  const watchDir = (dir) => {
    try {
      const w = fs.watch(dir, { persistent: true, recursive: false }, (_event, filename) => {
        schedule(filename);
      });
      w.on('error', (err) => console.warn('[watcher] error:', err.message));
      watchers.push(w);
      return true;
    } catch (err) {
      console.warn(`[watcher] could not watch ${dir}:`, err.message);
      return false;
    }
  };

  watchDir(root);

  // With scanDepth > 1 the projects live one or more levels down, so watching
  // only the root would miss every add/remove that matters. Watch the container
  // folders too — one watcher per intermediate directory, still shallow.
  if (depth > 1) {
    const addLevel = (dir, level) => {
      if (level >= depth) return;
      let entries = [];
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const ent of entries) {
        if (!ent.isDirectory() || ent.name.startsWith('.') || IGNORE.has(ent.name)) continue;
        const child = path.join(dir, ent.name);
        watchDir(child);
        addLevel(child, level + 1);
      }
    };
    addLevel(root, 1);
  }

  console.log(
    `[mission-control] watching ${root} for project changes` +
      (watchers.length > 1 ? ` (+${watchers.length - 1} subfolders, scanDepth ${depth})` : '')
  );

  return {
    close() {
      if (timer) clearTimeout(timer);
      timer = null;
      for (const w of watchers) {
        try {
          w.close();
        } catch {
          /* ignore */
        }
      }
      watchers.length = 0;
    },
  };
}
