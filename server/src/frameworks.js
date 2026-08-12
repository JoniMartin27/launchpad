// frameworks.js
// ---------------------------------------------------------------------------
// Maps a discovered project "type" / framework to:
//   - how to spawn its dev command
//   - how to inject the assigned port (CLI flag and/or env var)
//
// Resolution order (handled in launcher.js):
//   per-project override (command / portFlag / portEnv / env)  →
//   this framework table  →  safe default (PORT env only).
//
// We always set BOTH a CLI flag and the PORT env when we know the flag
// (belt-and-suspenders), because some frameworks read one and not the other.
// See SPEC §7.
// ---------------------------------------------------------------------------

/**
 * @typedef {Object} FrameworkRule
 * @property {string}   baseCommand   default dev command if the project has none
 * @property {string|null} portFlag   CLI flag to inject the port, e.g. "--port", "-p", "-l"
 * @property {string}   portEnv       env var name for the port (default "PORT")
 * @property {boolean}  needsDoubleDash  if true, the flag is passed after `--`
 *                                       (so it reaches the underlying tool, not npm)
 * @property {Object<string,string>} [extraEnv]  extra static env (value may contain ${PORT})
 * @property {boolean}  [portless]    true ⇒ no port to inject (CLI bots etc.)
 */

/** @type {Object<string, FrameworkRule>} */
export const FRAMEWORKS = {
  // --- Vite-based React/Electron front-ends -------------------------------
  'vite-react': {
    baseCommand: 'npm run dev',
    portFlag: '--port',
    portEnv: 'PORT',
    needsDoubleDash: true,
  },
  'electron-vite-react': {
    baseCommand: 'npm run dev',
    portFlag: '--port',
    portEnv: 'PORT',
    needsDoubleDash: true,
  },

  // --- Next.js (pregon) ---------------------------------------------------
  next: {
    baseCommand: 'npm run dev',
    portFlag: '-p',
    portEnv: 'PORT',
    needsDoubleDash: true,
  },

  // --- Generic Node / Express servers read PORT from env ------------------
  'express-node': {
    baseCommand: 'npm run dev',
    portFlag: null,
    portEnv: 'PORT',
    needsDoubleDash: false,
  },
  'node-server': {
    baseCommand: 'npm run dev',
    portFlag: null,
    portEnv: 'PORT',
    needsDoubleDash: false,
  },

  // --- Python / FastAPI (uvicorn) -----------------------------------------
  // `uv run uvicorn …` so the project's own venv is used: bare `uvicorn` is not
  // on PATH on this machine (it lives in backend/.venv), but `uv` is. uv resolves
  // and runs the venv's uvicorn without manual activation. (inferbench env fix.)
  'fastapi-python': {
    baseCommand: 'uv run uvicorn main:app --reload',
    portFlag: '--port',
    portEnv: 'PORT',
    needsDoubleDash: false, // direct uvicorn invocation, no npm wrapper
  },

  // --- Django: the port is a POSITIONAL `host:port` argument, not a flag ----
  'django-python': {
    baseCommand: 'uv run python manage.py runserver',
    portFlag: null,
    portArg: '127.0.0.1:${PORT}',
    portEnv: 'PORT',
    needsDoubleDash: false,
  },

  // --- Flask ---------------------------------------------------------------
  'flask-python': {
    baseCommand: 'uv run flask run',
    portFlag: '--port',
    portEnv: 'FLASK_RUN_PORT',
    needsDoubleDash: false,
  },

  // --- Plain Python (no web framework detected): label only, not launched ---
  python: {
    baseCommand: 'uv run python main.py',
    portFlag: null,
    portEnv: 'PORT',
    needsDoubleDash: false,
    portless: true,
  },

  // --- Deno ----------------------------------------------------------------
  // Deno tasks forward extra args to the task body, where a stray `--port`
  // would land in an unpredictable position; PORT env is the portable route.
  deno: {
    baseCommand: 'deno task dev',
    portFlag: null,
    portEnv: 'PORT',
    needsDoubleDash: false,
  },

  // --- Go ------------------------------------------------------------------
  'go-http': {
    baseCommand: 'go run .',
    portFlag: null,
    portEnv: 'PORT',
    needsDoubleDash: false,
  },

  // --- Rust (cargo) --------------------------------------------------------
  'rust-cargo': {
    baseCommand: 'cargo run',
    portFlag: null,
    portEnv: 'PORT',
    needsDoubleDash: false,
  },

  // --- Docker Compose: detected and labelled, never launched ---------------
  // `docker compose up` starts containers that outlive the spawned client, so a
  // process-tree kill would not stop the stack. Discovery marks these projects
  // non-runnable; this entry exists only so the card shows an honest command.
  'docker-compose': {
    baseCommand: 'docker compose up',
    portFlag: null,
    portEnv: 'PORT',
    needsDoubleDash: false,
    portless: true,
  },

  // --- Astro --------------------------------------------------------------
  astro: {
    baseCommand: 'npm run dev',
    portFlag: '--port',
    portEnv: 'PORT',
    needsDoubleDash: true,
    extraEnv: { ASTRO_INTERFACE_PORT: '${PORT}' },
  },

  // --- Vanilla ES-modules / static served by `serve` ----------------------
  'vanilla-es-modules': {
    baseCommand: 'npm run dev',
    portFlag: '-l', // `serve` listen flag
    portEnv: 'PORT',
    needsDoubleDash: true,
  },
  'html5-static': {
    // `serve -l <port>` accepts a bare port number; avoid embedding ${PORT}
    // in the command string (it is never substituted) — inject the flag instead.
    baseCommand: 'npx serve .',
    portFlag: '-l',
    portEnv: 'PORT',
    needsDoubleDash: false,
  },

  // --- Telegram bots / plain CLIs: no HTTP port ---------------------------
  'node-telegram-bot': {
    baseCommand: 'npm run dev',
    portFlag: null,
    portEnv: 'PORT',
    needsDoubleDash: false,
    portless: true,
  },
  'node-cli': {
    baseCommand: 'npm start',
    portFlag: null,
    portEnv: 'PORT',
    needsDoubleDash: false,
    portless: true,
  },

  // --- Monorepo top-level `npm run dev` -----------------------------------
  // Runs multiple children via concurrently; the assigned port targets the
  // primary web app. CAVEAT: an outer `npm run dev -- --port <P>` is SWALLOWED
  // by concurrently (it never reaches the web child), so the child boots on its
  // own default port and the assigned port serves nothing. Prefer a per-project
  // `command` that targets the web workspace directly, e.g.
  //   "npm --workspace @lookspan/dashboard run dev"  (+ portFlag "--port")
  // so the `-- --port <P>` propagates through the single npm wrapper to Vite.
  // The launcher additionally requires the assigned port to actually bind
  // before reporting "running" for monorepos (no ready-regex false-positive).
  // For per-service control, launch subprojects individually.
  monorepo: {
    baseCommand: 'npm run dev',
    portFlag: '--port',
    portEnv: 'PORT',
    needsDoubleDash: true,
  },
};

/** Fallback rule when a type is unknown but the project is still runnable. */
export const DEFAULT_RULE = {
  baseCommand: 'npm run dev',
  portFlag: null,
  portEnv: 'PORT',
  needsDoubleDash: false,
};

/**
 * Look up the framework rule for a given type, falling back to DEFAULT_RULE.
 * @param {string} type
 * @returns {FrameworkRule}
 */
export function ruleForType(type) {
  return FRAMEWORKS[type] || DEFAULT_RULE;
}

/**
 * Parse a shell-style command string into { cmd, args }.
 * Honors simple double quotes; sufficient for our trusted, config-defined
 * commands (no user-supplied strings reach the command position — SPEC §9).
 * @param {string} commandStr
 * @returns {{ cmd: string, args: string[] }}
 */
export function parseCommand(commandStr) {
  const tokens = [];
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let m;
  while ((m = re.exec(commandStr)) !== null) {
    tokens.push(m[1] ?? m[2] ?? m[3]);
  }
  const [cmd, ...args] = tokens;
  return { cmd: cmd || '', args };
}

/**
 * Build the final spawn command + args, injecting the port per the resolved
 * rule and per-project overrides.
 *
 * @param {Object} opts
 * @param {string} opts.command        resolved dev command string
 * @param {number} opts.port           assigned port
 * @param {FrameworkRule} opts.rule    framework rule
 * @param {string|null} [opts.portFlag]   per-project override flag
 * @param {boolean} [opts.portless]    treat as portless (no flag injection)
 * @returns {{ cmd: string, args: string[], usedFlag: string|null }}
 */
export function buildSpawnArgs({ command, port, rule, portFlag, portless }) {
  const { cmd, args } = parseCommand(command);

  // A portless project (bot/CLI) gets no flag injection.
  if (portless || rule.portless) {
    return { cmd, args, usedFlag: null };
  }

  const flag = portFlag !== undefined && portFlag !== null ? portFlag : rule.portFlag;
  if (!flag) {
    // Some tools take the port as a POSITIONAL argument instead of a flag
    // (Django: `manage.py runserver 127.0.0.1:8000`). `portArg` is a template
    // whose `${PORT}` is substituted and appended once.
    if (rule.portArg) {
      const positional = String(rule.portArg).replace(/\$\{PORT\}/g, String(port));
      if (!args.includes(positional)) {
        return { cmd, args: [...args, positional], usedFlag: null };
      }
    }
    // No flag known → rely on env injection only.
    return { cmd, args, usedFlag: null };
  }

  // If the command already contains the flag, don't double-inject.
  if (args.includes(flag)) {
    return { cmd, args, usedFlag: flag };
  }

  const injected = [...args];
  // The `--` separator only makes sense when the command is a package-manager
  // wrapper (npm/npx/yarn/pnpm): it tells the wrapper to pass the remaining
  // args through to the underlying script/binary. For a BARE binary (e.g.
  // `next dev`, `uvicorn …`) a `--` would be forwarded literally and rejected,
  // so we inject the flag directly with no separator. (pregon mc-bug fix.)
  // Yarn is deliberately absent: Yarn Berry forwards a literal `--` to the
  // script instead of consuming it as a separator, so adding one breaks the
  // command. `yarn dev --port <p>` already reaches the underlying tool.
  const isWrapper = /^(npm|npx|pnpm|pnpx|bun|bunx)$/.test(cmd);
  if (rule.needsDoubleDash && isWrapper) {
    // Ensure a single `--` separator so the flag reaches the underlying tool.
    if (!injected.includes('--')) injected.push('--');
  }
  injected.push(flag, String(port));
  return { cmd, args: injected, usedFlag: flag };
}

/**
 * Human-readable note describing how the port is injected (for the UI).
 * @param {FrameworkRule} rule
 * @param {string|null} usedFlag
 * @param {string} portEnv
 * @param {boolean} portless
 * @returns {string}
 */
export function portStrategyNote(rule, usedFlag, portEnv, portless) {
  if (portless || rule.portless) return 'no port (CLI / bot)';
  const parts = [];
  if (usedFlag) parts.push(`flag ${usedFlag} <port>`);
  parts.push(`env ${portEnv || 'PORT'}`);
  return parts.join(' + ');
}
