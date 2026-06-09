// warmer.js
// ---------------------------------------------------------------------------
// Background metrics warmer (SPEC P0 — CI badge race). Without this, the CI
// badge only ever populates when something (a drawer open) happens to warm the
// metrics cache, so it appeared transiently and inconsistently. The warmer
// proactively fetches metrics for every project at boot and on an interval, so
// cards show a STABLE ci/registry state from first paint.
//
// Throttling: projects are warmed sequentially with a small gap so we don't
// fire N concurrent `gh run list` calls (GitHub rate limits). The warm pass
// only refetches entries whose TTL has expired (getMetrics handles that), so
// the interval is cheap once warm.
// ---------------------------------------------------------------------------

import { getMetrics } from './metrics.js';

/**
 * Start the background warmer.
 *
 * @param {object} opts
 * @param {object} opts.catalog          catalog instance
 * @param {object} opts.settings         config.settings (metricsTtlSec)
 * @param {function():void} [opts.onPass] called after each full warm pass
 *        (e.g. to broadcast a catalog refresh so warm CI badges appear live).
 * @param {number} [opts.gapMs=400]      delay between per-project fetches
 * @param {number} [opts.intervalMs]     re-warm interval (default: ttl*1000)
 * @returns {{ close: function():void }}
 */
export function startWarmer({ catalog, settings, onPass, gapMs = 400, intervalMs }) {
  const ttlSec = settings.metricsTtlSec || 60;
  const period = intervalMs || ttlSec * 1000;
  let stopped = false;
  let timer = null;

  const warmOne = (project) =>
    getMetrics(project, {
      ttlSec,
      fresh: false,
      isOwnedByUs: async (port) => catalog.portOwnedByUs(port),
    }).catch(() => null); // never throw out of the warmer

  async function pass() {
    const projects = catalog.allBase();
    for (const p of projects) {
      if (stopped) return;
      // Skip hidden projects to save on network calls.
      if (p.hidden) continue;
      // eslint-disable-next-line no-await-in-loop
      await warmOne(p);
      // eslint-disable-next-line no-await-in-loop
      await sleep(gapMs);
    }
    if (!stopped && typeof onPass === 'function') {
      try {
        onPass();
      } catch {
        /* ignore */
      }
    }
  }

  // Kick off the first pass without blocking boot.
  pass();
  timer = setInterval(() => {
    pass();
  }, period);
  if (timer.unref) timer.unref();

  return {
    close() {
      stopped = true;
      if (timer) clearInterval(timer);
      timer = null;
    },
  };
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
