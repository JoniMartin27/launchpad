# Changelog

All notable changes to Mission Control are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project aims
at [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

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
