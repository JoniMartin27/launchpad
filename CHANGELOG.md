# Changelog

All notable changes to Mission Control are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project aims
at [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **Auto-restart after a crash**, opt-in per project (`autoRestart: true`). A dev
  server that dies on its own used to leave a red card and nothing else — you
  noticed minutes later, when the thing you were testing stopped answering.
  The policy is deliberately timid, because restarting badly is worse than not
  restarting at all:
  - only after a **non-zero** exit (a clean exit means "it finished");
  - never after **you** stopped it, and never for a start that never came up —
    that is a needs-install / needs-env problem, and relaunching would bury the
    diagnosis;
  - a **bounded** number of attempts (`settings.autoRestartMax`, default 3) with
    a growing wait, and it says so on the way in *and* on the way out;
  - the budget resets once the project has stayed up for a minute, so a server
    that hiccups twice a day is never eventually refused.
- `settings.portlessGraceMs`: how long a portless project (bot, CLI) must stay
  alive before it counts as running. Was a hardcoded 2.5s.
- **Crash recovery is reachable and visible.** A switch in the drawer arms it
  per project, and an armed card is marked in the grid. It was previously only
  settable by hand-editing a JSON file, which meant almost nobody would find it
  — and something that changes what a project does *without you* has no business
  being invisible.

- **A dashboard that died badly no longer strands your dev servers.** An orderly
  shutdown kills its children, but a hard kill — Task Manager, `kill -9`, a
  crash — leaves them running. The next boot showed them as *stopped*, refused
  to start them (`PORT_IN_USE: in use by a foreign process`) and offered no way
  to stop what it did not know it owned: you went hunting for the pid by hand,
  which is the chore this tool exists to abolish. Launches are now recorded in a
  small state file, and anything still alive **and still holding its port** is
  adopted back on boot, stoppable from the card as usual.
  - A live pid is *not* enough to adopt: pids get recycled, so the port is what
    proves the process is still ours. Portless projects (bots, CLIs) are
    deliberately never adopted — claiming a recycled pid would be worse than
    forgetting it.
  - Adopted cards say so: their output went to a process tree we no longer own,
    so the log panel explains that instead of looking empty.

## [1.3.0] — 2026-08-12

### Added

- **Open a project in your editor, your file manager or a terminal**, from the
  detail drawer — the `cd` the README promises to save. `POST /api/open` takes a
  `target` (`editor` / `folder` / `terminal`) and picks the right tool per
  platform. The endpoint existed but nothing in the UI ever called it, and it
  only knew about VS Code; the editor is now `settings.editorCommand`, so
  `subl`, `webstorm` or `nvim` work just as well.

### Fixed

- **A project folder could run commands.** The old open route used
  `execFile(cmd, [path], { shell: true })`, which concatenates arguments into a
  shell string *without escaping them* — Node warns about exactly this
  (DEP0190) — so a folder named `demo & whoami` executed `whoami` when opened.
  Folder names are attacker-influenceable: cloning a repository is enough to
  choose one. Every command is now spawned with `shell: false` and the path as
  its own argument, so there is no metacharacter to escape in the first place.
- Opening a folder on Windows no longer claims the tool is missing:
  `explorer.exe` exits 1 even when it worked, so only a failure to *launch* it
  counts as an error now.

### Changed

- **The package smoke test now launches a project**, not just detects one: on
  Linux, macOS and Windows it starts a project from the installed package,
  fetches what it serves, stops it and requires the port back. The POSIX
  tree-kill had unit tests but the full path — spawn a shell, which spawns a
  server, which binds a port — had never run outside Windows.
- `SECURITY.md` states where a shell is used and where it deliberately is not,
  and a test enforces it: adding `shell: true` to a new code path fails the
  suite until it is justified in that list.

## [1.2.0] — 2026-08-12

### Added

- **Stopping answers immediately.** `POST /api/projects/:id/stop` now returns
  **202** as soon as the kill is under way instead of blocking for the POSIX
  grace window (SIGTERM, up to two seconds, then SIGKILL) — a batch stop of five
  projects used to hold the response for ten. The final `stopped` still arrives
  over the WebSocket, which is where the UI reads it from anyway.
- **`npm pack` can no longer produce a tarball without the dashboard.** `files`
  ships `web/dist`, but nothing built it: the UI only made it in because
  whoever packed had built first. A `prepack` script now runs the build, so
  every tarball carries the interface. Caught by the new smoke job on its first
  run — it installed the package and got "web/dist not built".
- **The published package is smoke-tested on Linux, macOS and Windows.** A CI
  job packs the real tarball, installs it into a throwaway workspace of fake
  projects, runs the CLI and asks the running server what it found. The main
  suite proves the *source* works; nothing proved the thing people install did.
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

### Added

- **Batch start/stop and named profiles.** `POST /api/batch/start` and
  `/api/batch/stop` take `{ ids: [...] }` or `{ profile: "stack" }`, and the top
  bar gains **▶ Start N** (everything startable that is currently shown) and
  **⏻ Stop all**. Bringing up a front end, an API and a database was one click
  and one wait each. The response is per project — one that cannot start never
  aborts the rest — and a partial batch answers **207**, never a plain 200.
  Profiles live under `profiles` in the config and are listed by
  `GET /api/profiles`.

### Changed

- **Editing a manifest is picked up on its own.** Adding a `package.json` to an
  existing project, or a lockfile that changes which package manager runs it,
  used to stay invisible until somebody pressed Rescan: the watcher only saw
  folders appear and disappear at the root. Each project folder is now watched
  shallowly, filtered to the manifests that can change a classification, so
  build output and editor temp files still cost nothing. Bounded by
  `settings.maxProjectWatchers` (64), because one watcher is one inotify
  instance on Linux; past the cap the dashboard says so instead of failing.
- **Installing dependencies no longer triggers a storm of rescans on Windows.**
  Windows reports a change on the parent folder for churn inside a child, so
  every write inside any project fired the root watcher — and every one of those
  was a full rescan. It now compares the actual list of child folders and reacts
  only to a real structural change.
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
