# Security policy

## Threat model, stated plainly

Mission Control is a **single-user, loopback-only developer tool**. It:

- binds **`127.0.0.1` exclusively** (HTTP and WebSocket), never `0.0.0.0`;
- rejects any request whose remote address is not loopback, as defence in depth;
- has **no accounts, no authentication, no telemetry and no outbound calls**
  other than optional version/CI badge lookups (npm, PyPI, the `gh` CLI);
- **launches processes that already exist on your disk**, with commands derived
  from those projects' own manifests.

That last point is the important one: running a project from the dashboard is
equivalent to running `npm run dev` in that folder yourself. Mission Control
gives you no protection against a project you would not otherwise trust — point
it at a projects folder you own.

### Where a shell is used, and where it deliberately is not

**Launching a project uses a shell** (`spawn(..., { shell: true })`). That is
intentional: a dev command comes from the project's own `package.json` or from
your config, and those legitimately contain things only a shell understands —
`&&`, pipes, `cross-env FOO=1 vite`. Running them without a shell would break
most real projects. The trust boundary is the same as the one above: if you can
launch the project, you could have typed its command yourself.

**Everything else does not.** Opening a project in your editor, file manager or
terminal passes the path as its own argument with `shell: false`. This used to
use a shell too, and because `shell: true` concatenates arguments *without
escaping them* (Node warns about it — DEP0190), a project folder named
`demo & whoami` ran `whoami` when opened. Folder names are attacker-influenceable
in a way dev commands are not: cloning a repository is enough to choose one, and
discovery lists whatever is in your projects folder. Fixed in
[#24](https://github.com/JoniMartin27/launchpad/pull/24).

The rule this leaves behind, for anyone adding a feature that runs something:
**a shell is acceptable only for a command the user configured, never for a
value derived from the filesystem.**

Because it is loopback-only, **anything already running as your user on your
machine can reach the API**. That is inherent to the design, not a defect.

## What counts as a vulnerability

Reports we want:

- any path that makes the server reachable off-loopback, or that bypasses the
  remote-address check;
- command or argument injection reaching a spawn from data the user did not
  write themselves (e.g. a crafted `package.json` in a scanned folder causing
  execution beyond what launching that project would do anyway);
- path traversal out of the projects root through the REST API;
- a stop/kill path that leaves processes running while reporting success — that
  is a safety bug and we treat it as one.

Not vulnerabilities: "the API has no authentication" (by design, see above), or
"it runs the dev command of a project I put in the folder" (that is the feature).

## Reporting

Please report privately via
[GitHub Security Advisories](https://github.com/JoniMartin27/launchpad/security/advisories/new).
If that is unavailable to you, open a regular issue **without** exploit details
and ask for a private channel.

Expect an acknowledgement within a week. This is a hobby-scale project
maintained by one person: there is no bounty, and the honest fix window is
"as soon as I can", not a contractual SLA.

## Supported versions

Only the tip of `main` is supported. There are no backports.
