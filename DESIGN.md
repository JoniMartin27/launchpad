# Mission Control — Definitive Design Spec

*Local developer dashboard. Dark-theme-first (the only theme that ships v1). This document is the single source of truth: every token, component state, motion rule, and responsive breakpoint is specified to be implemented without ambiguity.*

**Direction:** Concept C "Playroom" — chunky, tactile, candy-colored cards you want to press — disciplined by Concept B's restfulness (calm is the resting state, personality is the reward on interaction) and completed by Concept A's power-user rigor (keyboard-complete, telemetry-suppressing to-do states, peripheral activity confirmation).

---

## 0. North Star (the test for every decision)

> *Does this make the resting dashboard calmer, OR make a state change more obvious?* If neither, cut it.

1. **Legible at a glance** — read 12 projects in under two seconds, peripherally.
2. **Friendly, not cute** — warmth from craft (geometry, shadows, copy, weighted motion), never mascots or emoji-spam.
3. **Quiet until it matters** — color and motion are a budget; spend on what changed.

Playroom's resting state is **calm and borderless-feeling** (elevation + space do the separating, per Concept B). Tactility, springs, and personality copy are the **reward on interaction**, not ambient noise.

---

## 1. Design Tokens — CSS Custom Properties

All tokens live in `:root`. This is the complete set. Accent is a **single-variable swap** (`--accent` + 2 derivatives) — changing the brand color must touch only those three lines.

```css
:root {
  /* ---------- Neutral ramp: "Slate" (blue-leaning near-black) ---------- */
  --slate-0: #0B0D10;  /* app background (deepest)              */
  --slate-1: #101316;  /* card background                       */
  --slate-2: #161A1F;  /* raised card / hover surface / drawer inner panel */
  --slate-3: #1E232A;  /* popover, modal, input                 */
  --slate-4: #272D35;  /* borders (solid contexts only)         */
  --slate-5: #3A424D;  /* hairline dividers on light surfaces   */
  --slate-6: #5A636F;  /* disabled text, faint icons, idle dot  */
  --slate-7: #8A929E;  /* secondary text, paths, captions       */
  --slate-8: #B6BDC7;  /* primary body text                     */
  --slate-9: #EDF0F4;  /* headings, high-emphasis               */

  /* ---------- Borders are ALPHA (sit correctly on any elevation) ------- */
  --border-rest:  rgba(255,255,255,0.06);
  --border-hover: rgba(255,255,255,0.10);
  --border-focus: rgba(255,255,255,0.14);

  /* ---------- Accent: "Aurora" (cyan-teal — NOT status-green) ---------- */
  --accent:          #2DD4BF;  /* primary CTA, focus ring, sparkline, links, logo blip */
  --accent-bright:   #5EEAD4;  /* hover on accent, active glow          */
  --accent-contrast: #04201E;  /* text/icon ON accent fills             */
  --accent-muted:    #1C7A82;  /* hover of accent-bordered elements     */
  --accent-subtle:   #0E2A2E;  /* accent-tinted fills (selected bg)     */
  --accent-ring:     rgba(45,212,191,0.14); /* command-field active border, glow */

  /* ---------- Status: color + (paired with) shape + motion ------------- */
  /* Each status owns a base, a -dim edge color, and a -glow shadow color. */
  --status-idle:      #5A636F;  --status-idle-dim:  rgba(90,99,111,0.55);  --status-idle-glow: rgba(90,99,111,0.0);
  --status-warn:      #F5B544;  --status-warn-dim:  rgba(245,181,68,0.65); --status-warn-glow: rgba(245,181,68,0.30);
  --status-ok:        #34D399;  --status-ok-dim:    rgba(52,211,153,0.60); --status-ok-glow:   rgba(52,211,153,0.32);
  --status-err:       #F87171;  --status-err-dim:   rgba(248,113,113,0.70);--status-err-glow:  rgba(248,113,113,0.35);
  --status-info:      #60A5FA;  --status-info-dim:  rgba(96,165,250,0.60); --status-info-glow: rgba(96,165,250,0.28);

  /* ---------- Project-TYPE hues (badge + corner-whisper ONLY) ---------- */
  /* Verified for deuteranopia/protanopia separation — see §11. Type never */
  /* carries state meaning, so a missed type-hue is cosmetic, not unsafe.   */
  --type-web:   #A78BFA;  /* violet — Web / Frontend     */
  --type-api:   #38BDF8;  /* sky    — API / Backend      */
  --type-worker:#FB923C;  /* orange — Worker / Job       */
  --type-db:    #FB7185;  /* rose   — Database           */
  --type-cli:   #A3E635;  /* lime   — CLI / Tool         */
  --type-docs:  #2A9D8F;  /* teal-dim — Docs / Site (distinct from --accent) */

  /* ---------- Spacing scale (4px base) -------------------------------- */
  --sp-1: 4px;   --sp-2: 8px;   --sp-3: 12px;  --sp-4: 16px;
  --sp-5: 24px;  --sp-6: 32px;  --sp-7: 48px;  --sp-8: 64px;
  /* Gutters: page 32px; grid gutter bumped to 24px (B's restfulness).    */

  /* ---------- Radii (nested-radius math honored: inner = outer − pad) -- */
  --radius-sm: 8px;   /* chips, pills, metric chips, input               */
  --radius-md: 10px;  /* buttons, popovers, inner drawer panels          */
  --radius-lg: 14px;  /* cards, drawer (left corners), modals            */
  --radius-full: 999px;

  /* ---------- Shadows (soft, layered — physical "key" elevation) ------ */
  --shadow-rest:  0 1px 2px rgba(0,0,0,0.40), 0 8px 24px rgba(0,0,0,0.25);
  --shadow-hover: 0 2px 4px rgba(0,0,0,0.45), 0 14px 36px rgba(0,0,0,0.34);
  --shadow-low:   0 1px 2px rgba(0,0,0,0.35); /* stopped cards sit lower  */
  --shadow-drawer:0 8px 16px rgba(0,0,0,0.45), 0 32px 80px rgba(0,0,0,0.50);
  --shadow-toast: 0 4px 8px rgba(0,0,0,0.40), 0 20px 48px rgba(0,0,0,0.45);

  /* ---------- Typography ---------------------------------------------- */
  --font-ui:   'Inter', -apple-system, system-ui, sans-serif;
  --font-mono: 'JetBrains Mono', 'SF Mono', ui-monospace, monospace;
  --fs-display: 22px; --lh-display: 28px; --fw-display: 600; /* drawer title */
  --fs-title:   16px; --lh-title:   22px; --fw-title:   600; /* card title   */
  --fs-body:    14px; --lh-body:    20px; --fw-body:    400;
  --fs-label:   13px; --lh-label:   18px; --fw-label:   500; /* status label */
  --fs-caption: 12px; --lh-caption: 16px; --fw-caption: 400; /* path, meta   */
  --fs-mono:  12.5px; --lh-mono:    18px;                    /* logs, metrics*/
  --num: "tnum" 1, "lnum" 1;  /* tabular + lining numerals everywhere numeric */

  /* ---------- Motion: easing + durations ------------------------------ */
  --ease-spring:  cubic-bezier(.34, 1.56, .64, 1); /* signature overshoot-settle (card hover) */
  --ease-drawer:  cubic-bezier(.34, 1.40, .64, 1); /* softer overshoot (drawer/large surfaces) */
  --ease-out:     cubic-bezier(.22, 1,   .36, 1);  /* standard decel (fades, slides)  */
  --ease-press:   cubic-bezier(.4, 0, 1, 1);       /* fast in (key press dip)         */
  --dur-press:    90ms;   /* :active dip                 */
  --dur-fast:     120ms;  /* log line in, tick cross-fade*/
  --dur-base:     160ms;  /* drawer cross-fade contents  */
  --dur-hover:    220ms;  /* card lift                   */
  --dur-drawer:   320ms;  /* drawer slide-in             */
  --dur-spark:    400ms;  /* sparkline draw              */
  --stagger:      30ms;   /* per-card cascade on load    */

  /* ---------- Z-index ------------------------------------------------- */
  --z-topbar: 100; --z-drawer-scrim: 200; --z-drawer: 210; --z-toast: 300; --z-cmdk: 400;
}
```

### 1.1 Atmosphere (Concept B graft — zero motion cost)

A barely-perceptible **top-center radial vignette** for studio depth, painted on `--slate-0`:

```css
body {
  background:
    radial-gradient(120% 80% at 50% -10%, rgba(45,212,191,0.035), transparent 60%),
    var(--slate-0);
}
```

No animation. It gives the canvas depth and a faint accent "halo" at the top without ever competing with cards.

### 1.2 Reduced motion

`@media (prefers-reduced-motion: reduce)`: replace all springs/slides with `opacity`-only cross-fades at `--dur-fast`; disable breathing glow, ring-ping, log slide-up, sparkline draw (render final state instantly), and the load cascade. State changes still cross-fade so they remain perceptible.

---

## 2. Overall Layout

- Deep slate canvas (`--slate-0`) + atmosphere vignette (§1.1).
- Centered column, **max-width 1280px**, page gutters **32px** (`--sp-6`) so cards never touch the viewport edge.
- Vertical rhythm: top bar → activity pulse line → filter rail (`--sp-5` below bar) → grid.
- Grid: CSS `grid`, `repeat(auto-fill, minmax(320px, 1fr))`, gutter **24px** (`--sp-5`, B's restfulness bump).
- On load, cards settle into place with a **staggered 30ms cascade** (`opacity 0→1` + `translateY(6px)→0`, `--ease-out`), capped so the last visible card lands by ~360ms.

---

## 3. Top Bar

Sticky, **64px** tall, `--slate-1`, `--border-rest` hairline bottom border, **12px backdrop blur**, `--z-topbar`. Horizontal padding `--sp-6`.

**Left cluster:**
- Brand mark — rounded-square logo tile (`28px`, `--radius-md`, `--accent` fill). Inside it, a mission-control **"blip"**: a 2px `--accent-contrast` dot that pings (scale 1→2.2, opacity 1→0 ring) every **~8s**. Wordmark "Mission Control", `--font-ui` 600, `--slate-9`.
- **Live tally pill** (`--slate-2`, `--radius-full`, `--border-rest`, mono tabular numerals): `● 4 running · ◐ 1 starting · ○ 3 stopped`. Dots use status colors. Counts cross-fade single digits on change (§9), never relayout.

**Center — command field ("ghost until focused", Concept B graft):**
- Rest: transparent fill, `--border-rest`, placeholder `Jump to a project…   ⌘K` in `--slate-6`. Width `min(420px, 36vw)`.
- Focus: fill rises to `--slate-3`, border becomes `--accent-ring`, width grows **+4px** each side, with a `--ease-spring` settle. A faint `--accent-ring` outer glow.
- `⌘K` / `Ctrl+K` from anywhere opens the full **command palette** overlay (`--z-cmdk`): fuzzy project search + actions (Start/Stop/Open/Restart). Type-to-filter; `↑↓` navigate; `↵` execute; `Esc` close.

**Right cluster:**
- **View toggle** (Grid / List) — segmented pill, `--slate-2` track, a sliding **`--slate-3` puck** that springs (`--ease-spring`, `--dur-base`) between segments; active label `--slate-9`, inactive `--slate-7`.
- **"+ New"** primary button — `--accent` fill, `--accent-contrast` text, `--radius-md`. Opens add-project flow (§8).
- Avatar / settings cog (`--slate-7`, hover `--slate-9`).

### 3.1 Activity pulse line (Concept A graft)

A **1px** line directly under the top bar, full content width. At rest it is `--border-rest`. Whenever *any* project's state changes (or new logs/metrics arrive system-wide), a soft `--accent` highlight **sweeps left→right once** (`700ms`, `--ease-out`, opacity peak ~0.5) then fades. Purely peripheral: look-away confirmation that *something* changed, without forcing attention to which card. Suppressed under reduced-motion (replaced by a 1-frame opacity blink).

### 3.2 Filter rail

Row below the pulse line. **Type chips** (one per project type present): pill, `--slate-2`, `--border-rest`, type glyph + label. Toggle behavior — active chip fills with its type color at **16%** and gains a **1px tinted ring** in that type color. A **`Sort: recently active`** ghost dropdown (`--slate-7`, no fill, chevron) sits at the rail's right edge (options: recently active, name A–Z, status, uptime).

---

## 4. The Project Card

The hero object. `--slate-1` fill, `--radius-lg`, `--border-rest` hairline, `--shadow-rest` (sits *above* the canvas like a physical key). Internal padding `--sp-4`. The **left edge owns status** (2px); the **top-right owns type** (badge + faint corner glow). Two non-overlapping channels — status and type can never be confused.

### 4.1 Anatomy

```
┌────────────────────────────────────┐  ← 2px status-dim LEFT edge
│ ● Running · :3000        [API ·sky] │  ← status row + type badge ; ⌘3 hint top-left on focus
│                                     │
│ dynafeet-web                        │  ← card-title, fade-truncated
│ ~/proyects/dynafeet-web             │  ← path, --slate-7 mono caption
│                                     │
│ ┌─────────┐ ┌─────────┐             │  ← metric chips (mono, tabular)
│ │ CPU 12% │ │ MEM 340M│  ↑ 2h 14m   │
│ └─────────┘ └─────────┘             │
│                                     │
│  [ ⏻ Stop ]   [ ↗ Open ]   [ ⋯ ]   │  ← action row
└────────────────────────────────────┘
```

- **Status row:** dot (8px; 10px for error) + label in `--fs-label`. Dot encodes **color + shape + motion** together (never color alone — accessibility). Label e.g. `Running · :3000`.
- **Type badge** (top-right): small pill, type color @ 18% fill + tinted text + glyph. Plus a **2px corner glow** bleeding from the top-right radius, very faint (type color @ ~10%).
- **Title:** `--fs-title`, `--slate-9`, single line, fade-truncate (mask, not ellipsis).
- **Path:** `--font-mono`, `--fs-caption`, `--slate-7`, fade-truncate.
- **Metric chips:** `--slate-2`, `--radius-sm`, mono tabular. `CPU 12%`, `MEM 340M`. Uptime `↑ 2h 14m` to the right.
- **Action row:** primary action (state-morphing) + `↗ Open` + `⋯` overflow.

### 4.2 Interaction

- **Whole card is one focus target** (Concept A graft). Tab moves card-to-card; a visible **`--border-focus` ring + 2px `--accent-ring` outer glow** marks focus. `↵` opens the drawer; `S` toggles start/stop on the focused card.
- **⌘1–⌘9 index hints** (Concept A graft): the first 9 cards show a faint mono index badge in the **top-left** corner; `⌘<n>` / `Ctrl+<n>` jumps focus to that card. Hints render at `--slate-6`, only appear on `:focus-within` of the grid or while `⌘`/`Ctrl` is held.
- **Hover:** lifts `translateY(-3px)`, shadow → `--shadow-hover`, hairline → `--border-hover`. `--dur-hover` on `--ease-spring` — the signature overshoot-and-settle.
- **Press (`:active`):** dips to `translateY(-1px)`, `--dur-press` on `--ease-press` — a real key press.
- **Primary action morphs by state** (see table). Buttons spring subtly on hover (`scale 1.02`, `--dur-fast`).

### 4.3 Card states (complete)

| State | Left edge | Dot / glyph + motion | Card treatment | Telemetry | Copy / primary button |
|---|---|---|---|---|---|
| **Stopped** | `--status-idle-dim` | hollow ring ○, no motion | slightly desaturated; `--shadow-low` (sits lower) | metric chips **shown but dimmed/zeroed** | `Stopped` · **▶ Start** (accent-tinted) |
| **Starting** | `--status-warn-dim` | dashed ring ◐, gentle **1.6s** pulse | metric chips show **skeleton shimmer** | live telemetry pending | `Starting…` · button shows inline spinner |
| **Running** | `--status-ok-dim` | solid dot ●, **3s** breathing glow + ambient **ring-ping every 8s** | full color, `--shadow-rest`, live chips | live | `Running · :3000` · **⏻ Stop** (neutral; red text on hover) |
| **Error / Crashed** | `--status-err-dim` | dot+notch ⊗, **two quick pulses then rest** | left edge briefly flares then settles; thin red wash in top 2px | telemetry replaced by error copy | `Crashed · exit 1` · **↻ Restart** |
| **Needs-install** | `--status-info-dim` | dot with rotating arc ◜ if installing, else hollow | card becomes a **to-do, not a gauge** | **telemetry SUPPRESSED** (Concept A graft) — no metric chips at all | dashed-outline "ghost" CTA spans the action row · **⬇ Install** |
| **Needs-env** | `--status-warn-dim` | hollow ring + small **key line-icon** | soft amber banner strip under the path | **telemetry SUPPRESSED** — no metric chips | `Missing .env — 2 vars` · **Set up env** |

**Telemetry-suppression rule (Concept A, adopted wholesale):** for `needs-install` and `needs-env`, the card stops pretending to be a gauge. Metric chips and uptime are **removed entirely** (not zeroed), and the action area becomes a single clear to-do CTA. A card that can't run has nothing to measure — showing `CPU 0%` would be noise. (Stopped is different: it *can* run, so it keeps dimmed chips as a memory of last values.)

### 4.4 Personality copy (state-driven, deterministic — never random per render)

The reward-on-interaction warmth. One fixed line per state/condition, so the same card always reads the same way:

- **Error**, in the vacated metric area: *"It tapped out. exit 1 — want to bring it back?"*
- **Needs-env**: *"Almost there — it just needs a couple of secrets."*
- **Long-stopped (>7 days)**: a faint *"Resting peacefully."* under the path.
- **Running, fresh start (<60s):** *"Up and warming up."* (auto-clears after 60s.)

Copy is calm and human, never a joke that wears out. No randomization.

---

## 5. The Detail Drawer

Right-side drawer, **520px** wide, `--slate-1`, `--radius-lg` on **left corners only**, `--shadow-drawer`. Scrim: `black @ 40%` + 8px blur, `--z-drawer-scrim`. Drawer at `--z-drawer`.

- **Open:** springs in over `--dur-drawer` on `--ease-drawer` from `translateX(24px) + opacity 0`.
- **Close:** `✕`, scrim click, or `Esc`. Reverses at `--dur-base`, `--ease-out`.
- **Switching projects while open:** the **shell stays put**; contents **cross-fade `--dur-base`** (Concept: "a persistent instrument you're retuning"). Sparklines/logs re-seed without re-animating the frame.

**Header:** big status dot (12px, same shape+motion language) + project name (`--fs-display`), type badge, live `Running · :3000` line, close `✕`, and a scaled-up primary action button (state-morphing, identical logic to card).

**Three stacked inner panels** (`--slate-2`, `--radius-md`, nested-radius honored; gap `--sp-4`):

### 5.1 Live logs
Mono stream (`--font-mono`, `--fs-mono`) on `--slate-0`. Auto-scrolling. New lines **fade + slide-up `--dur-fast`**. Error lines get a **red left-tick** (`--status-err`). Top **fade-mask** so old lines dissolve rather than hard-clip. Controls: a `Wrap` pill-toggle and a `▢ Follow` switch (springs). For `needs-install` / `needs-env` projects this panel shows the install/setup output instead of runtime logs.

### 5.2 Git
Current **branch pill** (`--accent`-tinted), `↑2 ↓0` ahead/behind (mono), last commit message (fade-truncated) + relative time ("3h ago"), and a row of recent commits as tiny stacked rows.

### 5.3 Metrics
CPU & MEM as **mini sparklines** (60s rolling). Large tabular current value. Uptime + restart count. Sparklines **draw left→right on open** (`--dur-spark`), 1.5px `--accent` stroke with a soft area-gradient fade beneath. Current-value digits **cross-fade on tick** (§9), never relayout. Suppressed entirely for telemetry-suppressed states (§4.3).

---

## 6. Log Viewer (shared spec)

Used in the drawer and the optional full-screen log view. `--slate-0` ground, `--font-mono` `--fs-mono`/`--lh-mono`. Behaviors:
- **Follow** on by default; scrolling up disengages Follow and shows a `↓ Jump to latest` floating pill.
- **Wrap** toggle (off = horizontal scroll, on = soft-wrap with hanging indent).
- **Level ticks:** error → `--status-err` left-tick; warn → `--status-warn` left-tick; info/debug → none.
- New-line animation: `opacity 0→1` + `translateY(4px)→0`, `--dur-fast`, `--ease-out`. Batched if >20 lines/frame (animate the batch, not each line).
- Top fade-mask `~24px`; bottom is hard (latest line crisp).
- Empty: *"Quiet in here. Logs will show up the moment it has something to say."*

---

## 7. Empty / Onboarding States

### 7.1 First run — no projects detected
Centered card on canvas: the logo tile (with its blip), heading *"Nothing running yet."*, body *"Mission Control watches your project folders and lights them up here. Point it at a folder to begin."*, and a primary **`+ Add a folder`** button. Below, a one-line hint: *"Or drop a project folder anywhere on this window."* (window-wide drag-drop target; on drag-over the whole canvas gains a `--accent-ring` inset ring).

### 7.2 Filtered-to-empty
When filters exclude everything: *"No projects match these filters."* + a **`Clear filters`** ghost button. (Distinct copy from first-run so the user knows it's a filter, not an empty system.)

### 7.3 Scanning
While discovering projects on launch: skeleton cards (3–6) with the metric-chip shimmer, and the tally pill reading `◐ scanning…`. Resolves card-by-card into the staggered cascade as each project is identified.

---

## 8. Toast / Notification — newly auto-detected projects

Mission Control auto-detects new project folders. When one appears:

- A **toast** slides up from bottom-right (`--slate-3`, `--radius-md`, `--shadow-toast`, `--z-toast`, max-width 360px). Spring in `--dur-base` on `--ease-spring` from `translateY(12px)+opacity 0`.
- Content: type glyph + *"Found a new project — **whatsapp-voice-bot**"*, secondary line `~/proyects/whatsapp-voice-bot · API`, and two actions: **`Add`** (accent text button) and **`Ignore`** (ghost). 
- The matching new card simultaneously **cascades into the grid** with a brief `--accent-ring` highlight ring that fades over `--dur-drawer`, so the toast and the card are visually linked.
- Auto-dismiss after **6s** (pauses on hover); stack vertically, newest on top, max 3 visible (older collapse into a `+N more` row).
- The activity pulse line (§3.1) sweeps in sync.
- Other toast uses (same component): action results — *"Restarted dynafeet-web"*, errors — *"Couldn't start api — port 3000 in use"* (error toast uses `--status-err` left-tick).

---

## 9. Numeric Updates — the "system is alive" rule (Concept A graft)

- **Single-digit cross-fade on tick:** any live numeric (CPU%, MEM, uptime seconds, tally counts) updates by cross-fading **only the digits that changed** (`opacity` swap, `--dur-fast`), **never a layout jump**. Tabular numerals (`--num`) guarantee fixed width.
- A small **live mono clock** sits in the top bar's right cluster (before the cog), ticking once a second — a steady heartbeat confirming the system is alive even when every project is calm.

---

## 10. Motion Spec (summary of what animates, how)

| Element | Property | Duration | Easing |
|---|---|---|---|
| Card hover lift | `translateY`, shadow, border | `--dur-hover` (220ms) | `--ease-spring` |
| Card press | `translateY` dip | `--dur-press` (90ms) | `--ease-press` |
| Card load cascade | opacity + `translateY` | per-card +`--stagger` (30ms) | `--ease-out` |
| Running dot | breathing glow | 3s loop | ease-in-out |
| Running ring-ping | scale + opacity ring | every 8s | `--ease-out` |
| Starting dot/card | pulse / shimmer | 1.6s loop | ease-in-out |
| Error dot | two pulses then rest | ~600ms once | `--ease-out` |
| Drawer open | `translateX` + opacity | `--dur-drawer` (320ms) | `--ease-drawer` |
| Drawer content swap | cross-fade | `--dur-base` (160ms) | `--ease-out` |
| Sparkline draw | stroke-dashoffset | `--dur-spark` (400ms) | `--ease-out` |
| Log line in | opacity + `translateY` | `--dur-fast` (120ms) | `--ease-out` |
| Numeric tick | digit cross-fade | `--dur-fast` (120ms) | linear |
| View-toggle puck | `translateX` | `--dur-base` (160ms) | `--ease-spring` |
| Command field focus | width + border + glow | `--dur-base` (160ms) | `--ease-spring` |
| Activity pulse sweep | gradient position + opacity | 700ms once | `--ease-out` |
| Toast in | `translateY` + opacity | `--dur-base` (160ms) | `--ease-spring` |
| Logo blip | scale + opacity ring | every ~8s | `--ease-out` |

**Motion budget:** at rest, the only ambient motion is the running-dot breathing/ping, the logo blip, and the clock. Everything else fires on change or interaction. If a screen of all-stopped projects is open, the dashboard is essentially still.

---

## 11. Accessibility & Color-Blindness Rigor (Concept B graft, applied to Playroom)

- **Status never relies on color alone** — every status pairs **color + shape + motion** (○ ◐ ● ⊗ ◜ + distinct motion). Verified legible in grayscale.
- **Type-hue check (deuteranopia & protanopia sim):** the six type hues were chosen for separation under both simulations. Critical adjustment: **Docs** moved from `#2DD4BF` (which collides with `--accent` and sits near `--type-api` sky under deuteranopia) to a deeper teal `#2A9D8F`. Because **type is cosmetic, never state-bearing**, a type-hue that's hard to distinguish is at worst a missed decoration — it can never cause a wrong action. Type badges *also* carry a glyph + text label, so hue is the third redundant channel, not the only one.
- **Focus:** every interactive element has a visible `--border-focus` + `--accent-ring` focus ring; the whole card is a single focus target (§4.2). Full keyboard path: Tab (cards), ⌘K (palette), ⌘1–9 (jump), ↵ (open drawer), S (start/stop), Esc (close).
- **Contrast:** body text `--slate-8` on `--slate-1` ≥ 7:1; `--accent-contrast` on `--accent` ≥ 7:1; status dots backed by their `-dim` edge for non-text legibility.
- **Reduced motion:** §1.2.

---

## 12. Responsive Behavior

| Breakpoint | Layout |
|---|---|
| **≥ 1024px** (desktop, primary) | Centered 1280px column, 32px gutters, grid `auto-fill minmax(320px,1fr)` @ 24px gutter. Drawer 520px overlay. |
| **640–1023px** (tablet / narrow window) | Page gutters drop to `--sp-5` (24px); grid `minmax(280px,1fr)`. Drawer becomes **full-width to 480px max**, still right-anchored. Top-bar command field collapses to an icon that opens the palette. |
| **< 640px** (rare — narrow window) | Single-column stack, page gutters `--sp-4` (16px). Cards full-width. Drawer becomes a **bottom sheet** (slides up `translateY`, `--radius-lg` top corners, 90vh). View toggle hidden (List implied). Tally pill collapses to `●4 ◐1 ○3`. |

- **List view** (toggle): each project is a single full-width row — status dot + name + path + inline metrics + actions on the right. Same status/type channels (status = left edge tick, type = small badge before name). Denser; for users tracking many projects.
- Cards reflow with the auto-fill grid; the staggered cascade respects whatever count fits.

---

## 13. Component Inventory (build checklist)

TopBar · BrandBlip · TallyPill · CommandField · CommandPalette · ViewToggle · NewButton · LiveClock · ActivityPulseLine · FilterRail · TypeChip · SortDropdown · ProjectCard (+ all 6 states) · StatusDot · TypeBadge · MetricChip · CardActionRow · IndexHint · DetailDrawer · DrawerHeader · LogViewer · GitPanel · MetricsPanel · Sparkline · Toast · ToastStack · EmptyState (first-run / filtered / scanning) · DragDropTarget · SkeletonCard.

---

*End of spec. Tokens in §1 are authoritative; every component references them by variable, never by literal hex.*
