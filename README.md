# 🛰️ Mission Control

![License](https://img.shields.io/github/license/JoniMartin27/launchpad)

> One folder, a dozen repos, one screen — no port collisions.

Point Mission Control at the folder where you keep your projects and press start.
It auto-detects every dev project, infers how to launch each one from its *own*
files, and runs them all at once on collision-free ports — with live logs, git
status, and health in a single view. No `cd` rituals, no port-clash detective
work, no stray `node` holding port 5173 from yesterday.

<p align="center">
  <img src="docs/demo.gif" alt="Mission Control — launch two projects on collision-free ports and watch live logs in the detail drawer" width="900">
</p>

> 🔒 **Local-only by design.** Binds **`127.0.0.1`** (HTTP + WebSocket), never
> `0.0.0.0`. No accounts, no telemetry, no phone-home.

Part of [Fervon](https://fervon.dev) — a small studio of local-first developer tools.

> ⭐ **If Mission Control saves you a single `cd` + port-clash hunt, [give it a star](https://github.com/JoniMartin27/launchpad) — it's the fastest way to help it grow.** Got a project it can't auto-detect, or an idea? [Open an issue](https://github.com/JoniMartin27/launchpad/issues).

## Why

If you keep a dozen projects in one folder, you know the dance: `cd` into each
one, remember its dev command, discover two of them both want port 5173, kill
the stray `node` that's still holding a port from yesterday. Mission Control
replaces all of that with one screen.

## Features

- **Zero-config auto-detection, polyglot** — scans your projects folder and
  infers each project's type and dev command from its own files:
  - **JS/TS** — Vite (React / Vue / Svelte / SvelteKit / Solid / Preact), Next,
    Nuxt, Remix, Astro, Electron, Express / Fastify / Koa / hapi / Hono / NestJS,
    static sites, Telegram & Discord bots, CLIs, workspace monorepos, and
    `backend/`+`frontend/` splits.
  - **Python** — FastAPI, Django, Flask. **Go** (`go.mod`), **Rust** (`Cargo.toml`),
    **Deno** (`deno.json` tasks). Docker Compose stacks are detected and
    labelled (not launched — see below).
- **Uses your package manager** — the dev and install commands follow the
  project's lockfile: `pnpm dev` for `pnpm-lock.yaml`, `yarn` / `bun run` / `npm run`
  likewise. Mission Control never runs `npm install` inside a pnpm workspace.
- **Launch many at once, never a port clash** — every project gets a unique port
  in a configurable range (default `4000–4099`), injected at launch (`PORT` env +
  the right CLI flag per framework). Run five at the same time, all isolated.
- **Live logs** streamed over WebSocket (ANSI-clean), with filter / follow / clear.
- **Git at a glance** — branch, dirty count, ahead/behind, last commit.
- **Health** — npm/PyPI published version + GitHub CI status (via `gh`), cached.
- **Friendly failures** — missing `node_modules`? A one-click **Install** button.
  Missing env/token? A clear hint instead of a red wall.
- **Live re-scan** — drop a new project folder in and it animates into the grid
  (filesystem watcher), no restart.
- **Clean process control** — start/stop with full process-tree kill on Windows
  (`taskkill /T /F`), so nothing is left holding a port.

## Quick start

Mission Control is meant to live **inside** the folder it manages:

```
~/code/                     ← your projects root
├── project-a/
├── project-b/
└── mission-control/        ← clone here
```

```sh
git clone https://github.com/JoniMartin27/launchpad
cd launchpad
npm install
npm run build      # build the web UI
npm start          # serve UI + API + WS on http://127.0.0.1:7777
```

Open <http://127.0.0.1:7777>. On first run it scans the parent folder, seeds a
local `config.json`, and shows your projects. That's it.

> **Different projects folder?** Set `MISSION_CONTROL_PROJECTS_ROOT=/path/to/code`
> (env var) or edit `settings.projectsRoot` in `config.json`.
>
> **Port 7777 already taken?** Set `MISSION_CONTROL_PORT=7788`. The env var wins
> over `settings.dashboardPort`.

Mission Control excludes **itself** from the scan (by path, so the clone folder
can be called anything), and never launches what it cannot cleanly stop: Docker
Compose stacks are shown and labelled but have no Start button, because
`docker compose up` leaves containers that a process-tree kill would not reclaim.

### Dev mode (hot reload)

```sh
npm run dev        # Fastify (:7777) + Vite (:5180) with HMR
```

### Tests

```sh
npm test           # server suite — 77 tests via node:test
```

## How it works

| Module | Role |
|---|---|
| `server/src/discovery.js` | Scans the projects root, classifies each project generically (no hardcoded names), resolves unique ports. |
| `server/src/launcher.js`  | Spawns the dev command with the port injected, streams logs, tree-kills on stop. |
| `server/src/frameworks.js`| Per-framework table: how to inject the port (env var + CLI flag). |
| `server/src/watcher.js`   | Debounced `fs.watch` on the root → live add/remove of projects. |
| `server/src/git.js` · `metrics.js` | Git status and npm/PyPI/CI health, cached and non-blocking. |

See [`SPEC.md`](SPEC.md) for the full REST + WebSocket contract and
[`DESIGN.md`](DESIGN.md) for the UI design system.

## Configuration

Discovery is **hybrid**: an automatic filesystem scan, unioned with per-project
overrides in `config.json` (machine-local, git-ignored — see
[`config.example.json`](config.example.json)). Edit it by hand or from the
dashboard. Per project you can override:

| Field | Meaning |
|---|---|
| `port` | Pin the assigned port |
| `name` | Display name |
| `command` | Override the dev command |
| `portFlag` / `portEnv` | How the port is passed (e.g. `--port`, `PORT`) |
| `env` | Extra environment variables (`${PORT}` is substituted) |
| `hidden` / `runnable` | Hide a card / mark it non-launchable |
| `cwd` | Working directory |

Global settings live under `settings` (`projectsRoot`, `dashboardPort`,
`portRange`, `metricsTtlSec`, `readyRegex`, `autoScan`).

## Requirements

- **Node 20+** (CI runs on Node 20 and 22). Optional, per ecosystem you actually
  use: `git` and the GitHub `gh` CLI for the git/CI panels; `uv` for Python
  (FastAPI / Django / Flask); `go`, `cargo`, `deno`, `pnpm`, `yarn`, `bun` for
  those projects. All degrade gracefully if absent — a missing toolchain shows
  up as a friendly *needs-env* card, not a crash.
- Built and tested on **Windows**; the launch/port logic is Windows-aware
  (process-tree kill, dual-stack readiness probe).

## Security posture

Single-user, loopback-only. Every request is checked for a loopback remote
address; the socket binds `127.0.0.1` exclusively. It launches processes you
already have on disk with commands derived from those projects — treat it like
running `npm run dev` yourself. See `SPEC.md` §9.

## License

MIT
