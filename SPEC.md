# Mission Control — Technical Specification

> Local-only developer dashboard to discover, launch, monitor, and kill personal dev servers under `C:/Users/jonat/Desktop/proyects`. Node backend (Fastify) + WebSocket serving a Vite + React frontend. **Binds ONLY to `127.0.0.1`. Never `0.0.0.0`.**

This spec is the single source of truth. Two developers can build `server/` and `web/` in parallel against the contracts below without further coordination.

---

## 0. Invariants (read first)

| Invariant | Value |
|---|---|
| Dashboard bind host | `127.0.0.1` **only** (HTTP + WS) |
| Dashboard fixed port | `7777` |
| Project port allocation range | `4000`–`4099` (inclusive) |
| Projects root | `C:/Users/jonat/Desktop/proyects` |
| Platform | Windows 11, Node 18+ |
| Process kill | whole tree via `taskkill /PID <pid> /T /F` — on stop, on relaunch, on dashboard shutdown |
| Port-clash policy | check port free before spawn; **warn, never clobber** |
| No external CDN at runtime | all fonts/icons system or bundled |

Conflict rule: if any other section contradicts §0, §0 wins.

---

## 1. Folder Structure

```
mission-control/
├─ SPEC.md
├─ package.json                 # root: orchestrates dev (concurrently), installs workspaces
├─ config.json                  # PERSISTED hybrid-discovery config (seed + overrides) — §4
├─ .gitignore
├─ README.md
│
├─ server/
│  ├─ package.json
│  ├─ src/
│  │  ├─ index.js               # entry: builds Fastify app, binds 127.0.0.1:7777, mounts WS, shutdown hooks
│  │  ├─ config.js              # load/save/validate config.json (atomic write)
│  │  ├─ discovery.js           # hybrid discovery: scan FS + merge config overrides → Project[]
│  │  ├─ catalog.js             # in-memory catalog (Map<id, ProjectState>), single source of runtime truth
│  │  ├─ launcher.js            # spawn (shell:true), port injection per framework, killTree, exit wiring
│  │  ├─ ports.js               # isPortFree(), allocatePort(), seed map resolution
│  │  ├─ ring.js                # byte-capped ring buffer per project
│  │  ├─ ws.js                  # WebSocketServer, client registry, broadcast(), replay on connect
│  │  ├─ git.js                 # git status/branch/ahead-behind via execFile('git', …)
│  │  ├─ metrics.js             # npm/PyPI latest version, gh CI status, port-in-use, cached w/ TTL
│  │  ├─ frameworks.js          # framework → { spawnCmd, args, portInjection } table — §7
│  │  └─ routes/
│  │     ├─ projects.js         # GET /api/projects, GET /api/projects/:id
│  │     ├─ lifecycle.js        # POST start / stop / restart
│  │     ├─ git.js              # GET /api/projects/:id/git
│  │     ├─ metrics.js          # GET /api/projects/:id/metrics
│  │     ├─ logs.js             # GET /api/projects/:id/logs (ring snapshot, REST fallback)
│  │     ├─ config.js           # GET/PATCH /api/config, PATCH /api/projects/:id/config
│  │     └─ system.js           # GET /api/health, POST /api/open (VS Code), POST /api/refresh
│  └─ test/                     # node:test unit tests (ports, ring, frameworks, discovery)
│
└─ web/
   ├─ package.json
   ├─ index.html
   ├─ vite.config.ts            # dev server :5180, proxy /api + /ws → 127.0.0.1:7777
   ├─ tsconfig.json
   └─ src/
      ├─ main.tsx
      ├─ App.tsx                # layout: TopBar + ProjectGrid + DetailDrawer
      ├─ styles/
      │  ├─ tokens.css          # :root variables from UX spec §1.1
      │  └─ global.css
      ├─ api/
      │  ├─ client.ts           # typed fetch wrappers for every REST endpoint
      │  └─ ws.ts               # WS connection manager, reconnect, message dispatch
      ├─ store/
      │  └─ useProjects.ts      # state: projects[], statuses, logs (per-project ring mirror)
      ├─ types.ts               # Project, ProjectStatus, WsMessage … (mirror of §5)
      └─ components/
         ├─ TopBar.tsx
         ├─ ProjectGrid.tsx
         ├─ ProjectCard.tsx
         ├─ DetailDrawer.tsx
         ├─ LogConsole.tsx
         ├─ StatusDot.tsx
         ├─ CiBadge.tsx
         └─ PortBadge.tsx
```

`config.json` lives at the **repo root** (sibling of `package.json`), not inside `server/`, so it is easy to find and edit by hand.

---

## 2. REST API

Base URL: `http://127.0.0.1:7777`. All bodies are JSON (`Content-Type: application/json`). All responses are JSON.

### 2.1 Conventions

- **Success**: HTTP 2xx, body is the resource or `{ "ok": true, … }`.
- **Error envelope** (any non-2xx):
  ```json
  { "error": { "code": "PORT_IN_USE", "message": "Port 4003 is already in use by a foreign process.", "details": { "port": 4003 } } }
  ```
- Error codes: `NOT_FOUND`, `PORT_IN_USE`, `ALREADY_RUNNING`, `NOT_RUNNING`, `NOT_RUNNABLE`, `NO_PORT_AVAILABLE`, `SPAWN_FAILED`, `BAD_REQUEST`, `CONFIG_INVALID`, `TOOL_MISSING` (e.g. git/gh absent).
- IDs are the stable `id` strings from the catalog (e.g. `lookspan`, `agent-os`). Subprojects use the dotted/hyphen ids from the discovered catalog (e.g. `inferbench-backend`).
- All endpoints are loopback-only; the server rejects any request whose `req.socket.remoteAddress` is non-loopback with HTTP 403 (defense in depth).

### 2.2 Endpoints

#### `GET /api/projects`
List all projects (post-discovery, merged with config, excluding `hidden:true`). Returns the **full frontend Project model** (§5) including live runtime fields. Cheap fields only — does NOT block on git/metrics network calls (those have their own endpoints; cached values are inlined if already warm).

Response `200`:
```json
{
  "projects": [ { /* Project — see §5 */ } ],
  "generatedAt": "2026-06-08T10:00:00.000Z"
}
```
Query params:
- `?includeHidden=true` — include `hidden` projects (for the config editor).

#### `GET /api/projects/:id`
Single project, full model. `404 NOT_FOUND` if unknown.

#### `POST /api/projects/:id/start`
Allocate/confirm port, check it is free, inject port, spawn `npm run dev` (or framework command), wire logs + exit.

Request body (all optional — overrides for this launch only, NOT persisted):
```json
{ "port": 4003, "command": "npm run dev", "extraEnv": { "FOO": "bar" } }
```
Behavior:
1. If already running → `409 ALREADY_RUNNING` (body includes current `pid`, `assignedPort`).
2. Resolve port: body `port` → config `port` → seed map (`suggestedPort`) → first free in `4000–4099`. If none free → `409 NO_PORT_AVAILABLE`.
3. `isPortFree(port, '127.0.0.1')` AND `isPortFree(port, '0.0.0.0')`. If taken by a **foreign** process → `409 PORT_IN_USE` (warn, do not clobber).
4. Spawn (see §7). On spawn error → `500 SPAWN_FAILED`.
5. If `runnable:false` (CLI bots, static-only with no server, e.g. quick-capture, whatsapp-voice-bot) and no command resolvable → `422 NOT_RUNNABLE`.

Response `202`:
```json
{ "ok": true, "id": "lookspan", "status": "starting", "pid": 12345, "assignedPort": 4003, "command": "npm run dev", "startedAt": "2026-06-08T10:01:00.000Z" }
```
> Status transitions `starting → running` happen asynchronously and are pushed over WS (§3). The REST call returns immediately with `starting`.

#### `POST /api/projects/:id/stop`
Kill the whole process tree (`taskkill /T /F`).
- Not running → `409 NOT_RUNNING`.
Response `200`:
```json
{ "ok": true, "id": "lookspan", "status": "stopping" }
```
Final `stopped` status is pushed over WS when the process `exit` fires.

#### `POST /api/projects/:id/restart`
Convenience = stop (await tree kill + port free) then start with the same resolved params. Response identical to `start` (`202`, `status:"starting"`). `409 NOT_RUNNING` is NOT raised — restart works from stopped too.

#### `GET /api/projects/:id/git`
Live git status (not cached-stale; ~1s execFile). `200`:
```json
{
  "id": "lookspan",
  "isRepo": true,
  "branch": "main",
  "ahead": 1,
  "behind": 0,
  "dirty": true,
  "staged": 2,
  "unstaged": 3,
  "untracked": 1,
  "lastCommit": { "hash": "9774700", "subject": "fix ci flake", "relative": "2 days ago" },
  "remoteUrl": "https://github.com/JoniMartin27/lookspan.git"
}
```
If not a git repo → `200` with `{ "isRepo": false }`. If git binary missing → `503 TOOL_MISSING`.

#### `GET /api/projects/:id/metrics`
Health metrics. Cached with TTL (default 60s; `?fresh=true` forces refetch). Network/`gh`/registry calls live here so the grid stays fast. `200`:
```json
{
  "id": "lookspan",
  "fetchedAt": "2026-06-08T10:00:00.000Z",
  "registry": {
    "kind": "npm",
    "name": "lookspan",
    "latestVersion": "0.4.1",
    "ok": true
  },
  "ci": {
    "available": true,
    "status": "passing",
    "conclusion": "success",
    "workflow": "CI",
    "runUrl": "https://github.com/JoniMartin27/lookspan/actions/runs/123",
    "ranAt": "2026-06-07T22:00:00.000Z"
  },
  "port": { "assignedPort": 4003, "inUse": true, "ownedByUs": true }
}
```
- `registry.kind`: `"npm" | "pypi" | "none"`. On lookup failure → `ok:false, error:"…"` (still `200`).
- `ci.status`: `"passing" | "failing" | "none" | "unknown"`. `available:false` when `gh` not installed/authed or no repo → `ci.status:"none"`.
- Metrics never 5xx for missing optional tools; they degrade gracefully inside the body.

#### `GET /api/projects/:id/logs`
REST snapshot of the ring buffer (fallback / initial paint without WS). `200`:
```json
{ "id": "lookspan", "lines": ["VITE v5 ready in 612 ms\n", "Local: http://localhost:4003\n"], "running": true, "droppedBytes": 0 }
```
`?tail=200` limits to last N entries.

#### `GET /api/config`
Returns the parsed `config.json` (raw persisted overrides + seed map). For the config editor UI.
```json
{ "config": { /* config.json — see §4 */ }, "path": "C:/Users/jonat/Desktop/proyects/mission-control/config.json" }
```

#### `PATCH /api/config`
Replace top-level settings (not per-project). Body is a partial of the `settings` object (§4). Validates, atomic-writes, returns full config. `422 CONFIG_INVALID` on bad shape.

#### `PATCH /api/projects/:id/config`
Upsert a per-project override block. Body (all optional):
```json
{ "name": "Lookspan", "command": "npm run dev", "port": 4003, "hidden": false, "env": { "LOOKSPAN_PORT": "${PORT}" } }
```
Merges into `config.json.projects[id]`, atomic-writes, re-runs discovery merge, returns updated Project (§5). Changing `port` while running does NOT relaunch (takes effect next start); response includes `"requiresRestart": true` if the project is currently running and the port/command changed.

#### `POST /api/refresh`
Force re-run discovery (rescan FS) + invalidate all metrics caches. `200 { "ok": true, "projects": [ … ] }`.

#### `GET /api/health`
Dashboard liveness. `200 { "ok": true, "version": "1.0.0", "uptimeSec": 123, "runningCount": 2, "boundHost": "127.0.0.1", "port": 7777 }`.

#### `POST /api/open`
Open a project in VS Code (minor optional feature). Body `{ "id": "lookspan" }`. Runs `code <path>` via `execFile`. `200 { "ok": true }`. If `code` not on PATH → `503 TOOL_MISSING` (UI hides/greys the button). **Never** opens anything outside the projects root (path is validated against the catalog).

---

## 3. WebSocket Protocol

### 3.1 Connection

- **Single multiplexed socket** for the whole dashboard: `ws://127.0.0.1:7777/ws`.
  - In Vite dev, the frontend connects to its own origin and Vite proxies `/ws` to `127.0.0.1:7777` (§6).
- Server shares the Fastify HTTP server with the `ws` `WebSocketServer({ server, path: '/ws' })` so it inherits the loopback bind.
- The client subscribes/unsubscribes to per-project log streams over the same socket (avoids N sockets). Status changes for ALL projects are always pushed (no subscription needed) so the grid updates live.

### 3.2 Message envelope

Every message (both directions) is a JSON object with a `type` discriminator and a monotonic-ish `ts` (ISO string) on server→client messages.

#### Client → Server

```json
{ "type": "subscribe",   "projectId": "lookspan" }   // start receiving log + replay for this project
{ "type": "unsubscribe", "projectId": "lookspan" }   // stop receiving its logs
{ "type": "ping" }                                    // keepalive; server replies { "type": "pong" }
```
On `subscribe`, server immediately sends one `log.replay` with the current ring contents, then live `log` messages.

#### Server → Client

```json
// Full ring replay (sent once right after subscribe)
{ "type": "log.replay", "ts": "…", "projectId": "lookspan", "lines": ["…\n", "…\n"], "droppedBytes": 0 }

// Live log chunk (raw stdout/stderr bytes decoded utf8; may be a partial line)
{ "type": "log", "ts": "…", "projectId": "lookspan", "stream": "stdout", "data": "VITE ready in 612 ms\n" }

// Status change for a project (pushed to ALL clients, no subscription required)
{ "type": "status", "ts": "…", "projectId": "lookspan",
  "status": "running", "pid": 12345, "assignedPort": 4003,
  "exitCode": null, "reason": null }

// Non-fatal warnings surfaced to the UI as toasts (e.g. port clash on start attempt)
{ "type": "warning", "ts": "…", "projectId": "lookspan", "code": "PORT_IN_USE", "message": "Port 4003 in use by a foreign process; not launched." }

// Keepalive
{ "type": "pong", "ts": "…" }
```

### 3.3 Status state machine

`stopped → starting → running → stopping → stopped`
plus terminal `error` (spawn failed, or process exited non-zero before reaching `running`).

| Status | Set when | Pushed via |
|---|---|---|
| `starting` | POST /start accepted, child spawned | `status` |
| `running` | readiness heuristic met (see below) | `status` |
| `stopping` | POST /stop accepted, taskkill issued | `status` |
| `stopped` | child `exit` event fires (clean) | `status` (`exitCode` set) |
| `error` | spawn error, OR exit non-zero while `starting` | `status` (`reason` set) |

**Readiness heuristic (`starting → running`)**: whichever fires first —
1. The assigned port becomes bound by our child (poll `isPortFree` every 400ms; not-free ⇒ likely up), OR
2. a log line matches a ready regex (`/ready in|listening on|Local:\s+http|started server|compiled|running at/i`), OR
3. a 2.5s grace timer elapses with the child still alive (for portless CLIs like quick-capture).
If the child exits during `starting` → `error`.

### 3.4 Reconnect

Client auto-reconnects with backoff (250ms → 4s, jittered). On reconnect it re-sends `subscribe` for the currently-open drawer project. Server keeps rings alive independent of connections, so no log loss across reconnects (bounded by ring size).

---

## 4. `config.json` Schema

Hybrid discovery = **auto-scan ∪ this file**. The file is the seed port map + per-project overrides + global settings. Missing file ⇒ server generates it from the discovered catalog on first run (seed below). Atomic write (`config.json.tmp` → rename).

```jsonc
{
  "$schemaVersion": 1,
  "settings": {
    "projectsRoot": "C:/Users/jonat/Desktop/proyects",
    "dashboardPort": 7777,
    "portRange": { "start": 4000, "end": 4099 },
    "ringBytes": 262144,            // 256 KB per-project ring cap
    "metricsTtlSec": 60,
    "autoScan": true,               // false ⇒ only projects listed below are shown
    "readyRegex": "ready in|listening on|Local:\\s+http|started server|compiled|running at"
  },

  // Per-project overrides. Key = project id. Any field omitted ⇒ inherit from discovery.
  "projects": {
    "agent-os":         { "port": 4000, "name": "AGENT-OS / Regenta", "command": "npm run dev" },
    "agent-os-public":  { "port": 4001 },
    "inferbench":       { "port": 4002, "command": "npm run dev" },
    "lookspan":         { "port": 4003, "env": { "LOOKSPAN_PORT": "${PORT}" } },
    "pregon":           { "port": 4004, "command": "next dev", "portFlag": "-p" },
    "pato-patrick":     { "port": 4005 },
    "prompt-tycoon":    { "port": 4006 },
    "quick-capture":    { "port": 4007, "hidden": false, "runnable": true },
    "whatsapp-voice-bot": { "port": 4008, "hidden": true },
    "dynafeet-web":     { "port": 4009 },
    "regenta-landing":  { "port": 4010 }
  }
}
```

### Per-project override fields

| Field | Type | Meaning |
|---|---|---|
| `port` | int (4000–4099) | Assigned port. Authoritative seed; injected at launch. Must be unique across projects (validator rejects dupes → `CONFIG_INVALID`). |
| `name` | string | Display name override. |
| `command` | string | Dev command override (e.g. `"npm run dev"`, `"next dev"`). Parsed shell-style into `cmd + args`. |
| `portFlag` | string | CLI flag used to inject the port (e.g. `-p`, `--port`, `--listen`, `-l`). If absent, framework table (§7) decides. |
| `portEnv` | string | Env var name to inject the port into (default `PORT`; e.g. `LOOKSPAN_PORT`). |
| `env` | object<string,string> | Extra env vars. `${PORT}` is substituted with the assigned port. |
| `hidden` | boolean | Exclude from `/api/projects` (unless `?includeHidden`). |
| `runnable` | boolean | Override discovered runnability (e.g. enable a CLI bot). |
| `cwd` | string | Override working dir (default = project path; useful for monorepo subproject targeting). |

Subproject overrides use their full id as the key (e.g. `"inferbench-backend": { "port": 4011, "command": "uvicorn main:app --reload", "portFlag": "--port" }`). Subprojects are NOT auto-shown as top-level cards by default; they appear inside the parent's detail drawer and can be launched individually (each gets its own unique port from the range).

---

## 5. Frontend Project Data Model

This is exactly what `GET /api/projects` returns per element and what `web/src/types.ts` mirrors.

```ts
type RegistryKind = 'npm' | 'pypi' | 'none';
type CiStatus     = 'passing' | 'failing' | 'none' | 'unknown';
type RunStatus    = 'stopped' | 'starting' | 'running' | 'stopping' | 'error';
type TypeGroup    = 'Node' | 'Python' | 'Static' | 'Docker' | 'Other'; // top-bar filter buckets

interface Project {
  id: string;                 // stable key, e.g. "lookspan"
  name: string;               // display name (override or discovered)
  path: string;               // absolute project root
  type: string;               // raw discovered type, e.g. "monorepo", "vite-react"
  typeGroup: TypeGroup;       // bucketed for the type filter
  framework: string;          // human string, e.g. "Next.js 16.2"
  repoUrl: string | null;

  runnable: boolean;          // can we launch it?
  command: string;            // resolved dev command that WILL be run
  hidden: boolean;

  // ---- port ----
  assignedPort: number;       // from config/seed (4000–4099)
  defaultPort: number | null; // the port the project natively wants (informational)
  portStrategy: string;       // human note on how port is injected

  // ---- live runtime (from in-memory catalog) ----
  status: RunStatus;
  pid: number | null;
  startedAt: string | null;   // ISO
  exitCode: number | null;
  portInUse: boolean;         // is assignedPort currently bound?
  portOwnedByUs: boolean;     // bound by our child vs a foreign process

  // ---- last log preview (row 3 of card) ----
  lastLogLine: string | null;

  // ---- cached health (may be null until first metrics fetch) ----
  registry: { kind: RegistryKind; name: string | null; latestVersion: string | null } | null;
  ci: { status: CiStatus; workflow: string | null; runUrl: string | null } | null;
  git: { branch: string | null; dirty: boolean; ahead: number; behind: number } | null;

  // ---- subprojects (monorepos), same-ish shape, launchable individually ----
  subprojects: SubProject[];
}

interface SubProject {
  id: string;
  name: string;
  path: string;
  type: string;
  command: string;
  assignedPort: number;
  defaultPort: number | null;
  portStrategy: string;
  status: RunStatus;
  pid: number | null;
  portInUse: boolean;
}
```

`typeGroup` mapping rule (server-side):
- `Node`: any `node-*`, `vite-*`, `express-*`, `next`, `electron-*`, `vanilla-es-modules`, `monorepo` (JS).
- `Python`: `fastapi-python`, anything python.
- `Static`: `html5-static`, `astro` (when purely static).
- `Docker`: type contains `docker`.
- `Other`: fallback (e.g. `node-telegram-bot`, `node-cli` may map to `Node` — bots count as Node here; reserve `Other` for unclassifiable).

WS `status`/`log` messages mutate this model in the store; the card and drawer read from it.

---

## 6. package.json files, dependencies, scripts

### 6.1 Root `package.json`

```json
{
  "name": "mission-control",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "workspaces": ["server", "web"],
  "scripts": {
    "dev": "concurrently -k -n server,web -c green,cyan \"npm:dev:server\" \"npm:dev:web\"",
    "dev:server": "npm -w server run dev",
    "dev:web": "npm -w web run dev",
    "start": "npm -w server run start",
    "build": "npm -w web run build",
    "serve": "npm -w server run start",
    "test": "npm -w server test"
  },
  "devDependencies": {
    "concurrently": "^9.1.0"
  }
}
```

**One-command run (dev):** `npm install && npm run dev`
- `dev:server` → Fastify on `127.0.0.1:7777` with `--watch`.
- `dev:web` → Vite on `127.0.0.1:5180`, proxying `/api` + `/ws` to `:7777`.
- Open `http://127.0.0.1:5180`.

**Production-ish single-port run:** `npm run build && npm start` → server serves `web/dist` statically AND the API/WS, all on `127.0.0.1:7777` (no Vite). Use this for daily driving.

### 6.2 `server/package.json`

```json
{
  "name": "server",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "main": "src/index.js",
  "scripts": {
    "dev": "node --watch src/index.js",
    "start": "node src/index.js",
    "test": "node --test"
  },
  "dependencies": {
    "fastify": "^5.2.0",
    "@fastify/static": "^8.0.0",
    "ws": "^8.18.0"
  }
}
```
> No other runtime deps. `git`, `gh`, `npm`, `taskkill`, `code`, `python` are invoked via `node:child_process.execFile`/`spawn`. Registry lookups use the built-in global `fetch` (Node 18+). PyPI: `GET https://pypi.org/pypi/<name>/json`; npm: `GET https://registry.npmjs.org/<name>/latest`; CI: `gh run list --repo <slug> --limit 1 --json …`.

### 6.3 `web/package.json`

```json
{
  "name": "web",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc -b && vite build",
    "preview": "vite preview"
  },
  "dependencies": {
    "react": "^18.3.1",
    "react-dom": "^18.3.1"
  },
  "devDependencies": {
    "@types/react": "^18.3.12",
    "@types/react-dom": "^18.3.1",
    "@vitejs/plugin-react": "^4.3.4",
    "typescript": "^5.7.2",
    "vite": "^5.4.11"
  }
}
```
> Plain CSS only (UX spec §1.1 tokens), **no UI/icon/CSS libraries**. Glyphs are Unicode. No CDN.

### 6.4 `web/vite.config.ts`

```ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    port: 5180,
    strictPort: true,
    proxy: {
      '/api': { target: 'http://127.0.0.1:7777', changeOrigin: false },
      '/ws':  { target: 'ws://127.0.0.1:7777', ws: true }
    }
  }
});
```

---

## 7. Launcher: port injection per framework

`frameworks.js` resolves how to inject the assigned port. Resolution order: per-project `command`/`portFlag`/`portEnv`/`env` overrides (§4) → framework table → safe default (`PORT` env). Always set **both** env and flag when known (belt-and-suspenders, per tech notes). Spawn with `shell:true`, `windowsHide:true`, `cwd: project.cwd`, env `{ ...process.env, PORT, FORCE_COLOR:'1', ...resolvedEnv }`.

| type / framework | spawn | port injection |
|---|---|---|
| `vite-react`, `electron-vite-react` | `npm run dev -- --port <P>` | Vite reads `--port`; also set `PORT`. (strictPort projects: the `--port` overrides their config.) |
| `next` (pregon) | `npm run dev -- -p <P>` (or `next dev -p <P>`) | `-p` flag; also `PORT`. |
| `express-node` / `fastapi` API subprojects | command + `portEnv` env (`PORT`, `LOOKSPAN_PORT`, etc.) | env var per `portEnv`/override. |
| `fastapi-python` (uvicorn) | `uvicorn main:app --reload --port <P>` | `--port` flag. |
| `astro` | `npm run dev -- --port <P>` | `--port`; also `ASTRO_INTERFACE_PORT` env. |
| `vanilla-es-modules` / static (`serve`) | `npm run dev -- -l <P>` or `npx serve . --listen <P>` | `serve` uses `-l`/`--listen`. |
| `html5-static` | `npx serve . --listen <P>` | `--listen`. |
| `node-telegram-bot`, `node-cli`, no-HTTP | command as-is | no port; `PORT` set harmlessly; readiness = 2.5s grace timer. |
| `monorepo` (top-level `npm run dev`) | `npm run dev -- --port <P>` + `PORT` | concurrently-run children; the assigned port targets the primary web app. For per-service control, launch subprojects individually. |

**Kill**: store `child.pid` at spawn; on stop/relaunch/shutdown call `taskkill /PID <pid> /T /F` (`execFile`). Clear `pid` on `exit`; never kill a stale pid (Windows recycles pids) — only `taskkill` while `running`. Dashboard shutdown (`SIGINT`/`process.on('exit')`) iterates all tracked pids and tree-kills them.

---

## 8. Discovery algorithm (hybrid)

1. If `settings.autoScan`, read immediate child dirs of `projectsRoot`. For each, detect `package.json` / framework markers → build a base Project (mirrors the discovered catalog shape: type, framework, devCommand, defaultPort, portEnvStrategy, repoUrl, subprojects).
2. Load `config.json`. For every project id, deep-merge the override block over the discovered base (override wins). Projects present in `config.projects` but not on disk are dropped (warn). If `autoScan:false`, only `config.projects` entries are shown.
3. Resolve `assignedPort` per §7 precedence; validate uniqueness across the range; on collision, the lower-id keeps it and the other gets the next free port (and a `warning`).
4. Emit `Project[]`. Seed `config.json` on first run if absent, writing the port map in §4 (which matches the catalog's `suggestedPort` values 4000–4010).

---

## 9. Security posture

- HTTP + WS bind `127.0.0.1` explicitly (host arg is load-bearing). WS inherits via `{ server }`.
- Reject non-loopback `remoteAddress` (403) as defense in depth.
- No project/user string is ever placed in the **command position** of a shelled spawn; args pass as arrays. Paths validated against the catalog (no arbitrary path traversal in `/api/open`).
- This process can spawn/kill arbitrary dev servers — treat as privileged; loopback-only is the primary control. No auth token in v1 (single-user localhost); add a shared-secret header only if ever proxied.

---

## 10. Build order for parallel work

- **Backend dev** owns: §1 `server/`, §2 REST, §3 WS server side, §4 config IO, §7 launcher, §8 discovery. Ship against contracts in §2/§3/§5 — frontend can mock these.
- **Frontend dev** owns: §1 `web/`, §3 WS client, §5 types, §6.3/§6.4, UX spec (TopBar/Grid/Card/Drawer/LogConsole). Develop against a static `GET /api/projects` fixture + a fake WS emitter until backend is live.
- Shared contract files frozen first: §5 `types.ts` and §2/§3 envelopes. Change them only by editing this SPEC.
