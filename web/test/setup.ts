// Test harness for the dashboard.
// ---------------------------------------------------------------------------
// The app talks to two things the browser gives it and jsdom does not: `fetch`
// (REST) and `WebSocket` (live status/logs). Both are stubbed here so a render
// test never touches a real server — and so a test can never accidentally
// start, stop or install one of the user's projects.
// ---------------------------------------------------------------------------

import { afterEach, beforeEach, vi } from 'vitest';
import { cleanup } from '@testing-library/react';

/** A minimal, inert WebSocket: it connects and then does nothing. */
class FakeWebSocket {
  static instances: FakeWebSocket[] = [];
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;

  readyState = FakeWebSocket.OPEN;
  onopen: ((ev: unknown) => void) | null = null;
  onclose: ((ev: unknown) => void) | null = null;
  onerror: ((ev: unknown) => void) | null = null;
  onmessage: ((ev: { data: string }) => void) | null = null;
  sent: string[] = [];

  constructor(public url: string) {
    FakeWebSocket.instances.push(this);
    // Open on the next tick, like a real socket would.
    setTimeout(() => this.onopen?.({}), 0);
  }

  send(data: string) {
    this.sent.push(data);
  }

  close() {
    this.readyState = FakeWebSocket.CLOSED;
    this.onclose?.({});
  }

  /** Push a server frame into the app. */
  emit(msg: unknown) {
    this.onmessage?.({ data: JSON.stringify(msg) });
  }
}

/** The API payload the stubbed `fetch` returns for GET /api/projects. */
export const apiState: {
  projects: unknown[];
  warnings: string[];
  /** What POST /api/batch/* answers, when a test cares. */
  batchResponse: unknown | null;
} = {
  projects: [],
  warnings: [],
  batchResponse: null,
};

/** Every stubbed fetch call, so tests can assert what left the browser. */
export const calls: Array<{ url: string; init?: RequestInit }> = [];

/** The calls whose URL contains `fragment`. */
export function fetchCalls(fragment: string) {
  return calls.filter((c) => c.url.includes(fragment));
}

/** The parsed JSON body of a recorded call. */
export function bodyOf(call: { init?: RequestInit }): unknown {
  const body = call.init?.body;
  return typeof body === 'string' ? JSON.parse(body) : null;
}

/** Build a project in the exact shape SPEC §5 defines. */
export function makeProject(over: Record<string, unknown> = {}) {
  return {
    id: 'demo',
    name: 'demo',
    path: '/code/demo',
    type: 'vite-react',
    typeGroup: 'Node',
    framework: 'Vite + React',
    repoUrl: null,
    packageManager: 'npm',
    runnable: true,
    command: 'npm run dev',
    hidden: false,
    assignedPort: 4000,
    defaultPort: 5173,
    portStrategy: 'flag --port <port> + env PORT',
    status: 'stopped',
    pid: null,
    startedAt: null,
    exitCode: null,
    portInUse: false,
    portOwnedByUs: false,
    needsInstall: false,
    installer: 'npm',
    installing: false,
    failureClass: null,
    failureReason: null,
    lastLogLine: null,
    registry: null,
    ci: null,
    git: null,
    subprojects: [],
    ...over,
  };
}

beforeEach(() => {
  apiState.projects = [];
  apiState.warnings = [];
  apiState.batchResponse = null;
  calls.length = 0;
  FakeWebSocket.instances.length = 0;
  vi.stubGlobal('WebSocket', FakeWebSocket as unknown as typeof WebSocket);
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(typeof input === 'string' ? input : (input as Request).url ?? input);
      calls.push({ url, init });
      if (url.includes('/api/batch/')) {
        const fallback = { ok: true, action: 'start', requested: 0, succeeded: 0, failed: 0, results: [] };
        return new Response(JSON.stringify(apiState.batchResponse ?? fallback), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      if (url.includes('/api/projects')) {
        return new Response(
          JSON.stringify({
            projects: apiState.projects,
            warnings: apiState.warnings,
            generatedAt: new Date(0).toISOString(),
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        );
      }
      // Anything else (health, metrics, git…) degrades to an empty object
      // rather than exploding the render.
      return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
    })
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

export { FakeWebSocket };
