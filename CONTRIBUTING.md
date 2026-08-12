# Contributing to Mission Control

Thanks for looking. This is a small, local-first tool — contributions are
welcome, and so are bug reports that just say "it didn't detect my project".

## The most valuable contribution

**Tell us about a project it failed to detect, or launched wrongly.** Discovery
is the heart of this tool and it can only be as good as the variety of project
layouts it has seen. Open a
[Project not detected](https://github.com/JoniMartin27/launchpad/issues/new?template=project-not-detected.yml)
issue with your project's manifest and folder layout — that is enough to fix it.

## Getting set up

```sh
git clone https://github.com/JoniMartin27/launchpad
cd launchpad
npm install
npm run dev        # Fastify API/WS on :7777, Vite web on :5180 with HMR
```

Mission Control scans the **parent** of its own folder. To point it somewhere
else while developing:

```sh
MISSION_CONTROL_PROJECTS_ROOT=/path/to/some/projects MISSION_CONTROL_PORT=7788 npm run dev
```

Both env vars matter in practice: `:7777` is a popular port, and you probably
don't want the dashboard scanning your real workspace while you test discovery.

## Before you open a pull request

```sh
npm test           # server suite (node:test) — must be green
npm run build      # tsc -b + vite build — must be green
```

CI runs both on `{ubuntu, windows} × node {20, 22}`. Process control is
platform-specific here, so a change to launching or killing **must** be green on
Windows *and* Linux.

## House rules

- **A test that cannot fail is not a test.** When you fix a bug, break the fix
  on purpose and confirm your new test goes red. Several tests in this repo were
  written that way and say so in a comment.
- **No hardcoded project names.** Discovery classifies by manifests, lockfiles
  and on-disk markers — never by folder name. If a fix only works for the
  project in front of you, it is not the fix.
- **Never launch what you cannot cleanly stop.** Docker Compose is detected but
  deliberately not launchable, because a process-tree kill would not reclaim its
  containers and the Stop button would be lying. Prefer that kind of honest
  refusal over a feature that half works.
- **Loopback only.** The server binds `127.0.0.1` and rejects non-loopback
  remote addresses. Do not add a bind address option, an auth layer, or a
  "just for my LAN" escape hatch — see [SECURITY.md](SECURITY.md).
- Keep the code commented the way the surrounding code is: explain *why*, and
  cite the real case that motivated the behaviour.

## Where things live

| Path | Role |
|---|---|
| `server/src/discovery.js` | Scans the root, classifies projects, resolves unique ports. |
| `server/src/frameworks.js` | Per-type table: dev command and how the port is injected. |
| `server/src/launcher.js` | Spawn, log streaming, readiness, cross-platform tree-kill. |
| `server/src/catalog.js` | Runtime state; assembles the API's project model. |
| `web/src/` | Vite + React dashboard. `SPEC.md` is the frozen server↔client contract. |

`SPEC.md` documents the REST/WS contract and `DESIGN.md` the UI system. If you
change the wire format, change `SPEC.md` in the same PR.
