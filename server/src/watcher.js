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
import { SIGNATURE_FILES } from './discovery.js';

// Names whose appearance/disappearance should never trigger a rescan.
const IGNORE = new Set(['node_modules', '.git', 'tmp']);

// Inside a project folder, only these files can change what we detect. Anything
// else churning in there (build output, logs, an editor's temp files) is noise.
const MANIFESTS = new Set(SIGNATURE_FILES);

// One `fs.watch` per project is one inotify instance on Linux, and the default
// `fs.inotify.max_user_instances` is 128 — shared with every other program on
// the machine. Past this many projects we stop adding manifest watchers and say
// so, rather than failing with ENOSPC halfway through.
const DEFAULT_MAX_PROJECT_WATCHERS = 64;

/** Child directory names of `dir`, ignoring dotfolders and internal folders. */
function listChildDirs(dir) {
  try {
    return new Set(
      fs
        .readdirSync(dir, { withFileTypes: true })
        .filter((e) => e.isDirectory() && !e.name.startsWith('.') && !IGNORE.has(e.name))
        .map((e) => e.name)
    );
  } catch {
    return new Set();
  }
}

/** Do two sets hold the same members? */
function sameSet(a, b) {
  if (a.size !== b.size) return false;
  for (const v of a) if (!b.has(v)) return false;
  return true;
}

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
export function startWatcher({
  root,
  onChange,
  onResult,
  debounceMs = 750,
  depth = 1,
  maxProjectWatchers = DEFAULT_MAX_PROJECT_WATCHERS,
  onWarning,
}) {
  /** @type {import('node:fs').FSWatcher[]} structural watchers (root + containers) */
  const watchers = [];
  /** @type {Map<string, import('node:fs').FSWatcher>} project dir → manifest watcher */
  const projectWatchers = new Map();
  let cappedAt = 0;
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
    // Windows reports a *change* event on the parent for churn inside a child
    // folder, so a single `npm install` in one project used to fire the root
    // watcher over and over — each one a full rescan. What we actually care
    // about here is structural: did a folder appear or disappear? So we keep a
    // snapshot of the child names and only act when the set really changes.
    let entries = listChildDirs(dir);
    try {
      const w = fs.watch(dir, { persistent: true, recursive: false }, (_event, filename) => {
        const next = listChildDirs(dir);
        if (sameSet(entries, next)) return; // content churn, not a new project
        entries = next;
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

  /**
   * Watch a project folder for MANIFEST changes only.
   *
   * The structural watchers above see folders appear and disappear, but not a
   * `package.json` being edited inside one — so adding a dev script to an
   * existing project stayed invisible until someone pressed Rescan. Watching
   * each project shallowly fixes that; filtering to the manifest list is what
   * keeps it from firing on every build artifact and editor temp file.
   * @param {string} dir
   */
  const watchProject = (dir) => {
    if (projectWatchers.has(dir)) return;
    if (projectWatchers.size >= maxProjectWatchers) {
      cappedAt = maxProjectWatchers;
      return;
    }
    try {
      const w = fs.watch(dir, { persistent: true, recursive: false }, (_event, filename) => {
        if (!filename) return;
        // `filename` is relative to `dir`; only a manifest at its root counts.
        const name = String(filename).split(/[\\/]/)[0];
        if (!MANIFESTS.has(name)) return;
        schedule(null); // already filtered — don't re-check against IGNORE
      });
      w.on('error', () => {
        // A project folder can vanish mid-watch; drop it and move on.
        try {
          w.close();
        } catch {
          /* ignore */
        }
        projectWatchers.delete(dir);
      });
      projectWatchers.set(dir, w);
    } catch {
      // Out of inotify instances, permissions, a folder that just disappeared:
      // manifest watching is a nicety, never a reason to fail.
    }
  };

  return {
    /**
     * Reconcile the per-project manifest watchers with the current catalog.
     * Called after every discovery so new projects get watched and removed ones
     * release their handle.
     * @param {string[]} dirs  absolute project directories
     */
    setProjectDirs(dirs) {
      const wanted = new Set(dirs.map((d) => path.resolve(d)));
      for (const [dir, w] of projectWatchers) {
        if (wanted.has(dir)) continue;
        try {
          w.close();
        } catch {
          /* ignore */
        }
        projectWatchers.delete(dir);
      }
      cappedAt = 0;
      for (const dir of wanted) watchProject(dir);
      if (cappedAt && typeof onWarning === 'function') {
        onWarning(
          `watching manifests in only ${cappedAt} of ${wanted.size} projects (the rest still update on Rescan). ` +
            'Raise settings.maxProjectWatchers if your OS allows more file watchers.'
        );
      }
      return projectWatchers.size;
    },

    /** How many project folders are being watched (tests/diagnostics). */
    projectWatcherCount() {
      return projectWatchers.size;
    },

    close() {
      if (timer) clearTimeout(timer);
      timer = null;
      for (const w of [...watchers, ...projectWatchers.values()]) {
        try {
          w.close();
        } catch {
          /* ignore */
        }
      }
      watchers.length = 0;
      projectWatchers.clear();
    },
  };
}
