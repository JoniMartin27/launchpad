// ports.js
// ---------------------------------------------------------------------------
// Port helpers: check whether a TCP port is free (on a given host) and
// allocate the first free port in the configured range. See SPEC §0, §2.2.
// ---------------------------------------------------------------------------

import net from 'node:net';

/**
 * Returns true if `port` is free to bind on `host`.
 * We attempt to *listen*; if it succeeds the port is free.
 * @param {number} port
 * @param {string} [host='127.0.0.1']
 * @returns {Promise<boolean>}
 */
export function isPortFree(port, host = '127.0.0.1') {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.once('error', (err) => {
      // EADDRINUSE / EACCES ⇒ not free.
      srv.close(() => {});
      resolve(false);
      void err;
    });
    srv.once('listening', () => {
      srv.close(() => resolve(true));
    });
    try {
      srv.listen(port, host);
    } catch {
      resolve(false);
    }
  });
}

/**
 * Free on BOTH loopback and wildcard? SPEC §2.2 step 3 wants both checked so
 * we don't collide with a server bound to 0.0.0.0.
 * @param {number} port
 * @returns {Promise<boolean>}
 */
export async function isPortFreeStrict(port) {
  // Ask first whether anything is actually SERVING there, on either stack.
  // The bind checks below are IPv4-only, so a server listening on `::` — which
  // is what `serve` does, and Vite by default on Windows — was invisible to
  // them: the guard said "free", the project was launched onto an occupied
  // port, and the card reported `running` on a port serving someone else.
  //
  // The connect probe is used rather than more bind checks on purpose: binding
  // `::1` on a machine with IPv6 disabled fails with EADDRNOTAVAIL, which would
  // read as "in use" and refuse every launch. A connection that cannot be made
  // simply means nobody is there.
  if (await isPortInUse(port)) return false;

  const a = await isPortFree(port, '127.0.0.1');
  if (!a) return false;
  const b = await isPortFree(port, '0.0.0.0');
  return b;
}

/**
 * Try to open a TCP connection to host:port. Resolves true if something accepts
 * the connection (i.e. a server is listening there), false otherwise.
 * @param {number} port
 * @param {string} host
 * @param {number} [timeoutMs=800]
 * @returns {Promise<boolean>}
 */
function canConnect(port, host, timeoutMs = 800) {
  return new Promise((resolve) => {
    const sock = new net.Socket();
    let settled = false;
    const done = (val) => {
      if (settled) return;
      settled = true;
      sock.destroy();
      resolve(val);
    };
    sock.setTimeout(timeoutMs);
    sock.once('connect', () => done(true));
    sock.once('timeout', () => done(false));
    sock.once('error', () => done(false));
    try {
      sock.connect(port, host);
    } catch {
      done(false);
    }
  });
}

/**
 * Is something currently SERVING on `port` on either the IPv4 (127.0.0.1) or
 * IPv6 (::1) loopback? We probe by *connecting*, not by trying to bind: a bind
 * probe gives false negatives on Windows when the target server is bound to a
 * specific interface (e.g. `serve` / Vite), so the readiness heuristic never
 * flips starting → running. A successful connect is a direct, reliable signal
 * that a server answers on the assigned port. (static-serve / Vite fix.)
 *
 * @param {number} port
 * @returns {Promise<boolean>}
 */
export async function isPortInUse(port) {
  const [v4, v6] = await Promise.all([
    canConnect(port, '127.0.0.1'),
    canConnect(port, '::1'),
  ]);
  return v4 || v6;
}

/**
 * Allocate the first free port in [start, end], skipping any in `taken`.
 * @param {Object} opts
 * @param {number} opts.start
 * @param {number} opts.end
 * @param {Set<number>} [opts.taken]  ports already reserved by other projects
 * @returns {Promise<number|null>}  null if none free
 */
export async function allocatePort({ start, end, taken = new Set() }) {
  for (let p = start; p <= end; p++) {
    if (taken.has(p)) continue;
    // eslint-disable-next-line no-await-in-loop
    if (await isPortFreeStrictSafe(p)) return p;
  }
  return null;
}

// Wrapper that never throws (network stack edge cases).
async function isPortFreeStrictSafe(p) {
  try {
    return await isPortFreeStrict(p);
  } catch {
    return false;
  }
}
