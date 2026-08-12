# Changelog

All notable changes to Mission Control are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project aims
at [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **Projects in subfolders are found.** `settings.scanDepth` (1–3) controls how
  many levels below the root to look. A scan that finds nothing widens the
  search on its own, explains that in a banner, and remembers the depth that
  worked. Nested projects are named after their trail (`work/api`) so two
  folders called `api` never collide; a project folder is never descended into,
  so a monorepo stays one card.
- **The frontend has tests.** Seven smoke tests mount the real dashboard in
  a headless DOM against a stubbed API and assert that it renders, shows a card, offers
  Install/Start/Stop in the right states, and surfaces the warning banner. Until
  now nothing exercised the running app: a typecheck and a bundle prove it
  compiles, and a React major bump passed CI on exactly that gap.
- **Discovery warnings are visible.** They were collected by the catalog and
  then read by nobody — no route, no WebSocket message, no UI. They now travel
  with `GET /api/projects`, `/api/refresh`, `/api/rescan` and the `catalog` WS
  broadcast, and render in a banner above the grid.

### Changed

- **Rescans no longer freeze the server on a large workspace.** Classifying a
  project reads and parses several files, and the watcher re-runs a full scan
  synchronously 750 ms after any change. Detection is now cached per project
  and validated with a cheap signature of stat() calls, invalidated by folder,
  manifest or service-subfolder changes. Measured on a synthetic workspace:
  300 projects **780 ms → 164 ms** per scan, 100 projects **197 ms → 94 ms**,
  25 projects **48 ms → 24 ms**.

### Fixed

- **The published-version badge no longer points at somebody else's package.**
  `registryTarget` held a lookup table of the author's own projects (`lookspan`
  → npm, `inferbench` → PyPI) and, for anything else Python-shaped, guessed
  `pypi/<folder-name>`. In a package other people install, that queries a
  package that is not theirs — or does not exist. It now reads the project's own
  manifest (`package.json` name, honouring `private: true`; `pyproject.toml` or
  `setup.py` name), and reports nothing when nothing is declared: a missing
  badge beats a wrong one. A per-project `registry` override covers the case a
  manifest cannot express, such as a private workspace root whose published
  package is one of its members.

### Changed

- React 19, Vite 8, TypeScript 7, `@fastify/static` 10, fastify 5.11, ws 8.21,
  concurrently 10. `npm audit`: **2 high-severity advisories → 0** (find-my-way
  HTTP/2 DoS and three fast-uri host-confusion issues, both pulled in by
  fastify).

## [1.1.0] — 2026-08-12

### Added

- **Published to npm as [`@fervon/launchpad`](https://www.npmjs.com/package/@fervon/launchpad).**
  `cd ~/code && npx @fervon/launchpad` — no clone, no build step, nothing
  installed globally. A `launchpad` CLI with `--port`, `--root`, `--config`,
  `--version` and `--help`.
- When running from an installed package, Mission Control scans the **current
  working directory** and keeps its config as `.launchpad.json` **in that
  folder**. (In a git checkout the previous behaviour is unchanged: scan the
  parent, config at the repo root.) Without this, an npx run would have scanned
  `node_modules` and written its config into a throwaway cache directory.

- **Polyglot project detection**: Django, Flask, Go, Rust and Deno projects are
  detected and launchable; Docker Compose stacks are detected and labelled but
  deliberately **not** launchable, because `docker compose up` leaves containers
  a process-tree kill cannot reclaim. ([#7](https://github.com/JoniMartin27/launchpad/pull/7))
- More JS frameworks recognised by name: SvelteKit, Nuxt, Remix, React Router,
  Solid, Preact, Hono, NestJS, Discord bots. ([#7](https://github.com/JoniMartin27/launchpad/pull/7))
- **Package-manager awareness**: dev and install commands follow the project's
  lockfile (`pnpm` / `yarn` / `bun` / `npm`) instead of always shelling out to
  npm. ([#7](https://github.com/JoniMartin27/launchpad/pull/7))
- `MISSION_CONTROL_PORT` env var to move the dashboard off `:7777`, which is a
  commonly contested port. ([#7](https://github.com/JoniMartin27/launchpad/pull/7))
- `Go` and `Rust` filter buckets in the type rail. ([#7](https://github.com/JoniMartin27/launchpad/pull/7))
- CI now runs on **Windows as well as Linux** (2 OSes × Node 20/22): process
  control is platform-specific and the Windows path was never exercised in CI.
  ([#8](https://github.com/JoniMartin27/launchpad/pull/8))
- Community docs: `CONTRIBUTING.md`, `SECURITY.md`, `CODE_OF_CONDUCT.md`, issue
  templates (including one dedicated to undetected projects) and a PR template.

### Fixed

- **The dashboard listed itself.** The skip list hardcoded the folder name
  `mission-control`, but the README tells you to clone the repo as `launchpad`
  — so every adopter got a card for the dashboard itself, complete with a Start
  button. Self-exclusion is now by resolved path.
  ([#7](https://github.com/JoniMartin27/launchpad/pull/7))
- **Stop did not stop anything on macOS/Linux.** Children were spawned without
  `detached`, so `process.kill(-pid)` had no process group to signal: only the
  shell died and the actual dev server survived, still holding its port.
  Children are now group leaders, and `killTree` sends SIGTERM to the group
  before escalating to SIGKILL. A hard exit of the dashboard kills the groups
  too. ([#8](https://github.com/JoniMartin27/launchpad/pull/8))
- **Cards claimed their port was busy for up to a minute after stopping**, because
  the 60-second metrics cache still held the probe taken while the server was
  up. Probes older than the last status change are now ignored.
  ([#8](https://github.com/JoniMartin27/launchpad/pull/8))
- A Python app that also carries a `package.json` (for Tailwind, say) is no
  longer mislabelled as a dead `node-server`. ([#7](https://github.com/JoniMartin27/launchpad/pull/7))
- CLIs (`bin`, no `dev` script) no longer reserve a port that nothing ever
  serves; they keep their Start button as portless projects.
  ([#7](https://github.com/JoniMartin27/launchpad/pull/7))
- Yarn no longer receives a `--` separator: Yarn Berry forwards it literally to
  the script instead of consuming it, which broke the command.
  ([#7](https://github.com/JoniMartin27/launchpad/pull/7))

## [1.0.0] — 2026-06-09

First public release: hybrid discovery of a projects folder, launching on
collision-free ports (4000–4099) with per-framework port injection, live logs
over WebSocket, git status, npm/PyPI/CI health, one-click dependency install,
live re-scan via a filesystem watcher, and process-tree kill on Windows.
Loopback-only by design.
