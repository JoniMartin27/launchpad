// Programmatic demo recorder for Mission Control.
// Drives the REAL dashboard (served by `npm start` on 127.0.0.1:7777) with
// Playwright and records a video that ffmpeg later turns into docs/demo.gif.
// Everything shown is real: real project cards from a real folder scan, real
// dev servers launched on their assigned ports, real streamed logs.
//
// Playwright is NOT a dependency of this repo. Run it with playwright resolved
// from a sibling project that already has it, e.g.:
//   NODE_PATH=../inferbench/node_modules node scripts/record-demo.mjs
import { chromium } from "playwright";

const OUT_DIR = process.env.MC_OUT_DIR || "C:/tmp/mc-rec";
const BASE = process.env.MC_BASE || "http://127.0.0.1:7777";
const W = 1440, H = 920;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Click the Start button inside the card whose text contains `name`.
async function startCard(page, name) {
  await page.evaluate((name) => {
    const cards = [...document.querySelectorAll("[class*=card], article, li, button")];
    const card = cards.find(
      (c) => c.textContent.includes(name) &&
        [...c.querySelectorAll("button")].some((b) => /start/i.test(b.textContent)),
    );
    if (!card) return;
    const btn = [...card.querySelectorAll("button")].find((b) => /start/i.test(b.textContent));
    btn && btn.click();
  }, name);
}

// Open the detail drawer for a running card.
async function openCard(page, name) {
  await page.evaluate((name) => {
    const cards = [...document.querySelectorAll("[class*=card], article, li")];
    const card = cards.find((c) => c.textContent.includes(name) && /running/i.test(c.textContent));
    if (!card) return;
    const nm = [...card.querySelectorAll("*")].find((e) => e.textContent.trim() === name);
    (nm || card).click();
  }, name);
}

async function closeDrawer(page) {
  await page.evaluate(() => {
    const btn = [...document.querySelectorAll("button")].find((b) => /^(✕|×|close)$/i.test(b.textContent.trim()));
    if (btn) btn.click();
    else document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  });
}

async function main() {
  const browser = await chromium.launch({ args: ["--force-color-profile=srgb"] });
  const context = await browser.newContext({
    viewport: { width: W, height: H },
    deviceScaleFactor: 1,
    recordVideo: { dir: OUT_DIR, size: { width: W, height: H } },
  });
  const page = await context.newPage();
  await page.goto(BASE, { waitUntil: "networkidle" });

  // Wait for the grid to render real cards.
  await page.getByText(/Mission Control/i).first().waitFor({ timeout: 30000 });
  await page.getByText(/dynafeet-web/i).first().waitFor({ timeout: 30000 });
  await sleep(2200);

  // ---- Scene 1: launch the first project → it flips to Running ----
  await startCard(page, "dynafeet-web");
  await sleep(4200); // boot + flip to Running :4009 (green), tally ticks to 1

  // ---- Scene 2: launch a SECOND project at once → no port clash ----
  await startCard(page, "regenta-landing");
  await sleep(4200); // both Running on their own ports; tally → 2 running

  // ---- Scene 3: open the detail drawer → live logs + git + metrics ----
  await openCard(page, "dynafeet-web");
  await sleep(5200); // dwell on streaming logs / git / metrics panels

  await closeDrawer(page);
  await sleep(1400);

  await sleep(500);
  await context.close(); // flush video
  const video = page.video();
  const path = video ? await video.path() : null;
  await browser.close();
  console.log("VIDEO_PATH=" + path);
}

main().catch((e) => { console.error("REC_ERROR", e); process.exit(1); });
