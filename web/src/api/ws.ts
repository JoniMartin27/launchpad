// WebSocket connection manager (SPEC §3).
// Single multiplexed socket to ws://<origin>/ws. Auto-reconnect with jittered
// backoff (250ms → 4s). Re-sends subscribe for the active project on reconnect.
// Status messages for ALL projects always flow (no subscription needed).

import type { WsServerMessage, WsClientMessage } from '../types';

type MessageHandler = (msg: WsServerMessage) => void;
type StateHandler = (connected: boolean) => void;

const MIN_BACKOFF = 250;
const MAX_BACKOFF = 4000;
const PING_INTERVAL = 20000;

export class WsManager {
  private url: string;
  private ws: WebSocket | null = null;
  private backoff = MIN_BACKOFF;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private closedByUser = false;

  // Projects we want logs for. Re-sent on every (re)connect.
  private subscriptions = new Set<string>();

  private messageHandlers = new Set<MessageHandler>();
  private stateHandlers = new Set<StateHandler>();

  constructor(path = '/ws') {
    // Connect to our own origin; Vite proxies /ws to the backend in dev.
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    this.url = `${proto}//${window.location.host}${path}`;
  }

  // ---- public API ----

  connect(): void {
    this.closedByUser = false;
    this.open();
  }

  close(): void {
    this.closedByUser = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.ws?.close();
    this.ws = null;
  }

  onMessage(h: MessageHandler): () => void {
    this.messageHandlers.add(h);
    return () => this.messageHandlers.delete(h);
  }

  onStateChange(h: StateHandler): () => void {
    this.stateHandlers.add(h);
    return () => this.stateHandlers.delete(h);
  }

  /** Subscribe to a project's live log stream (triggers a log.replay). */
  subscribe(projectId: string): void {
    this.subscriptions.add(projectId);
    this.send({ type: 'subscribe', projectId });
  }

  unsubscribe(projectId: string): void {
    this.subscriptions.delete(projectId);
    this.send({ type: 'unsubscribe', projectId });
  }

  // ---- internals ----

  private open(): void {
    try {
      this.ws = new WebSocket(this.url);
    } catch {
      this.scheduleReconnect();
      return;
    }

    this.ws.onopen = () => {
      this.backoff = MIN_BACKOFF;
      this.emitState(true);
      // Re-subscribe everything the UI still cares about.
      for (const id of this.subscriptions) this.send({ type: 'subscribe', projectId: id });
      // Keepalive ping loop.
      if (this.pingTimer) clearInterval(this.pingTimer);
      this.pingTimer = setInterval(() => this.send({ type: 'ping' }), PING_INTERVAL);
    };

    this.ws.onmessage = (ev) => {
      let msg: WsServerMessage;
      try {
        msg = JSON.parse(ev.data as string);
      } catch {
        return; // ignore malformed frames
      }
      for (const h of this.messageHandlers) h(msg);
    };

    this.ws.onclose = () => {
      this.emitState(false);
      if (this.pingTimer) clearInterval(this.pingTimer);
      if (!this.closedByUser) this.scheduleReconnect();
    };

    this.ws.onerror = () => {
      // onclose will follow and drive reconnection.
      this.ws?.close();
    };
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    // Jitter to avoid thundering reconnects.
    const jitter = Math.random() * this.backoff * 0.3;
    const delay = this.backoff + jitter;
    this.reconnectTimer = setTimeout(() => this.open(), delay);
    this.backoff = Math.min(this.backoff * 2, MAX_BACKOFF);
  }

  private send(msg: WsClientMessage): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }

  private emitState(connected: boolean): void {
    for (const h of this.stateHandlers) h(connected);
  }
}

// Singleton — the whole dashboard shares one socket.
export const ws = new WsManager();
