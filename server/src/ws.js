// ws.js
// ---------------------------------------------------------------------------
// Single multiplexed WebSocket server (SPEC §3). Shares the Fastify HTTP
// server so it inherits the 127.0.0.1 bind. Handles:
//   - client registry + per-project log subscriptions
//   - broadcast() of status/warning to ALL clients (no subscription needed)
//   - log replay on subscribe, then live log chunks
//   - ping/pong keepalive
// ---------------------------------------------------------------------------

import { WebSocketServer } from 'ws';

function nowIso() {
  return new Date().toISOString();
}

export class WsHub {
  /**
   * @param {import('http').Server} httpServer  the Fastify underlying server
   * @param {object} catalog                    catalog.js instance (for ring replay)
   */
  constructor(httpServer, catalog) {
    this.catalog = catalog;
    /** @type {Map<import('ws').WebSocket, Set<string>>} client → subscribed projectIds */
    this.clients = new Map();

    this.wss = new WebSocketServer({ server: httpServer, path: '/ws' });
    this.wss.on('connection', (socket, req) => this._onConnection(socket, req));
  }

  _onConnection(socket, req) {
    // Defense in depth: drop non-loopback connections.
    const addr = req.socket.remoteAddress || '';
    if (!isLoopback(addr)) {
      socket.close(1008, 'loopback only');
      return;
    }

    this.clients.set(socket, new Set());

    socket.on('message', (buf) => {
      let msg;
      try {
        msg = JSON.parse(buf.toString());
      } catch {
        return; // ignore malformed frames
      }
      this._handleClientMessage(socket, msg);
    });

    socket.on('close', () => this.clients.delete(socket));
    socket.on('error', () => this.clients.delete(socket));
  }

  _handleClientMessage(socket, msg) {
    switch (msg?.type) {
      case 'subscribe': {
        const id = msg.projectId;
        if (!id) return;
        this.clients.get(socket)?.add(id);
        // Immediately replay the ring (SPEC §3.2).
        const ring = this.catalog.getRing(id);
        const running = this.catalog.isRunning(id);
        this._send(socket, {
          type: 'log.replay',
          ts: nowIso(),
          projectId: id,
          lines: ring ? ring.snapshot() : [],
          droppedBytes: ring ? ring.droppedBytes : 0,
          running,
        });
        break;
      }
      case 'unsubscribe': {
        const id = msg.projectId;
        if (id) this.clients.get(socket)?.delete(id);
        break;
      }
      case 'ping':
        this._send(socket, { type: 'pong', ts: nowIso() });
        break;
      default:
        break;
    }
  }

  _send(socket, obj) {
    if (socket.readyState === socket.OPEN) {
      socket.send(JSON.stringify(obj));
    }
  }

  /** Push a live log chunk to subscribers of `projectId`. */
  broadcastLog(projectId, stream, data) {
    const payload = JSON.stringify({
      type: 'log',
      ts: nowIso(),
      projectId,
      stream,
      data,
    });
    for (const [socket, subs] of this.clients) {
      if (subs.has(projectId) && socket.readyState === socket.OPEN) {
        socket.send(payload);
      }
    }
  }

  /** Push a status change to ALL clients (no subscription needed). */
  broadcastStatus(status) {
    const payload = JSON.stringify({ type: 'status', ts: nowIso(), ...status });
    this._broadcastAll(payload);
  }

  /**
   * Push a catalog change to ALL clients (no subscription needed) so open
   * dashboards update live when a project folder appears/disappears or its
   * discovery fields change. Carries the diff plus the fresh project list so
   * the UI can reconcile without an extra REST round-trip. (SPEC item 3.)
   *
   * @param {object} diff           { added, removed, changed }
   * @param {object[]} projects     current §5 project models
   */
  broadcastCatalog(diff, projects) {
    const payload = JSON.stringify({
      type: 'catalog',
      ts: nowIso(),
      added: diff?.added || [],
      removed: diff?.removed || [],
      changed: diff?.changed || [],
      projects: projects || [],
      // Carry the current discovery warnings so a rescan that starts (or stops)
      // producing one updates the banner without a reload.
      warnings: this.catalog?.warnings || [],
    });
    this._broadcastAll(payload);
  }

  /**
   * Push a live install/setup log chunk to subscribers of `projectId`.
   * Mirrors broadcastLog but carries `type: 'install.log'` so the UI routes it
   * to the dedicated install-output panel instead of the runtime log stream.
   */
  broadcastInstallLog(projectId, stream, data) {
    const payload = JSON.stringify({
      type: 'install.log',
      ts: nowIso(),
      projectId,
      stream,
      data,
    });
    for (const [socket, subs] of this.clients) {
      if (subs.has(projectId) && socket.readyState === socket.OPEN) {
        socket.send(payload);
      }
    }
  }

  /**
   * Push an install lifecycle event (started / done / failed) to ALL clients so
   * cards can reflect the in-flight install and clear it on completion.
   */
  broadcastInstall(projectId, status, reason = null) {
    const payload = JSON.stringify({ type: 'install', ts: nowIso(), projectId, status, reason });
    this._broadcastAll(payload);
  }

  /** Push a non-fatal warning toast to ALL clients. */
  /**
   * Tell every dashboard something happened to a project outside the normal
   * status flow.
   *
   * `level` matters as much as the text. Every one of these used to arrive as a
   * red error toast, including "bringing it back up in 2s" — which is good
   * news, and reads as a failure. The server is the only place that knows
   * whether a given code is information, a caveat or a genuine problem, so it
   * says so instead of leaving the UI to guess from a constant.
   *
   * @param {string} projectId
   * @param {string} code       machine-readable, stable
   * @param {string} message    written for a person
   * @param {'info'|'warn'|'error'} [level='error']
   */
  broadcastWarning(projectId, code, message, level = 'error') {
    const payload = JSON.stringify({ type: 'warning', ts: nowIso(), projectId, code, message, level });
    this._broadcastAll(payload);
  }

  _broadcastAll(payload) {
    for (const socket of this.clients.keys()) {
      if (socket.readyState === socket.OPEN) socket.send(payload);
    }
  }

  /** Close all sockets (dashboard shutdown). */
  close() {
    for (const socket of this.clients.keys()) {
      try {
        socket.close(1001, 'server shutdown');
      } catch {
        /* ignore */
      }
    }
    this.wss.close();
  }
}

/** True for loopback addresses (handles ::ffff:127.0.0.1 and ::1). */
export function isLoopback(addr) {
  if (!addr) return false;
  return (
    addr === '127.0.0.1' ||
    addr === '::1' ||
    addr === '::ffff:127.0.0.1' ||
    addr.startsWith('127.') ||
    addr.endsWith('127.0.0.1')
  );
}
