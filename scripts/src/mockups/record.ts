/**
 * Recording helper: drives a headless Chromium through a scripted flow and
 * captures viewport-only video (no browser chrome), then converts the raw
 * .webm Playwright produces into a web-optimised .mp4 with ffmpeg.
 *
 * A fake cursor is injected so clicks read clearly on camera — Playwright's
 * real pointer is invisible in recordings.
 */
import { spawn } from "node:child_process";
import { mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import * as path from "node:path";
import { chromium, type Page } from "playwright";
import { STORAGE_STATE, VIDEO_OUT_DIR, WEB_URL, WORK_DIR } from "./env";

const RAW_DIR = path.join(WORK_DIR, "raw");

export type Viewport = { width: number; height: number };

export const PHONE: Viewport = { width: 400, height: 860 };
export const DESKTOP: Viewport = { width: 1440, height: 900 };

export type RecordOptions = {
  /** Output basename, e.g. "videoBookingFlow" -> videoBookingFlow.mp4 */
  name: string;
  viewport: Viewport;
  /** Reuse the saved demo login (storage-state.json). */
  authed?: boolean;
  /**
   * The scripted interaction. Call `ctx.markReady()` the moment the first
   * screen has finished loading — everything captured before that point is
   * auto-trimmed, so initial load spinners never make the final mp4.
   */
  action: (page: Page, ctx: { markReady: () => void }) => Promise<void>;
  /** Fallback trim (seconds) if the flow never calls markReady(). */
  trimStart?: number;
};

/** Injected into every page so pointer actions are visible on camera. */
const CURSOR_SCRIPT = `
  (() => {
    if (window.__pwCursor) return;
    window.__pwCursor = true;
    const dot = document.createElement('div');
    dot.style.cssText =
      'position:fixed;top:0;left:0;width:22px;height:22px;z-index:2147483647;' +
      'margin:-11px 0 0 -11px;border-radius:50%;pointer-events:none;' +
      'background:rgba(0,0,0,0.35);border:2px solid #fff;' +
      'box-shadow:0 2px 8px rgba(0,0,0,0.35);transition:transform .08s ease;' +
      'transform:translate(-100px,-100px);';
    const add = () => document.body && document.body.appendChild(dot);
    if (document.body) add(); else addEventListener('DOMContentLoaded', add);
    addEventListener('mousemove', (e) => {
      dot.style.transform = 'translate(' + e.clientX + 'px,' + e.clientY + 'px)';
    }, true);
    addEventListener('mousedown', () => { dot.style.background = 'rgba(66,163,36,0.55)'; }, true);
    addEventListener('mouseup', () => { dot.style.background = 'rgba(0,0,0,0.35)'; }, true);
  })();
`;

// ── On-camera UI helpers: unhurried, human-looking motion ────────────────────

export const ui = {
  /** Pause (ms). Give the viewer a beat to read. */
  wait: (page: Page, ms: number) => page.waitForTimeout(ms),

  /** Glide the cursor to an element's centre, then a short beat. */
  async moveTo(page: Page, selector: string, opts: { timeout?: number } = {}) {
    const el = page.locator(selector).first();
    await el.waitFor({ state: "visible", timeout: opts.timeout ?? 15000 });
    await el.scrollIntoViewIfNeeded();
    const box = await el.boundingBox();
    if (!box) throw new Error(`No bounding box for ${selector}`);
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 25 });
    await page.waitForTimeout(250);
    return el;
  },

  /** Move to, then click, with a small settle afterwards. */
  async click(page: Page, selector: string, opts: { settle?: number } = {}) {
    const el = await ui.moveTo(page, selector);
    await el.click();
    await page.waitForTimeout(opts.settle ?? 600);
  },

  /** Type into a field character-by-character so it reads as real input. */
  async type(page: Page, selector: string, text: string) {
    await ui.moveTo(page, selector);
    const el = page.locator(selector).first();
    await el.click();
    await el.pressSequentially(text, { delay: 55 });
    await page.waitForTimeout(300);
  },

  /**
   * Smoothly bring an element into view using the browser's native smooth
   * scroll (handles whatever scroll container it lives in). Use this instead of
   * a click's instant scrollIntoViewIfNeeded when the scroll itself should be
   * seen on camera.
   */
  async smoothTo(page: Page, selector: string, block: "center" | "start" | "end" = "center") {
    const el = page.locator(selector).first();
    await el.waitFor({ state: "visible", timeout: 15000 });
    await el.evaluate(
      (node: any, b) => node.scrollIntoView({ behavior: "smooth", block: b }),
      block,
    );
    await page.waitForTimeout(750);
  },

  /**
   * Buttery wheel scroll by delta px using an ease-in-out curve, so the motion
   * accelerates and settles rather than ticking linearly. ~duration ms total.
   */
  async scroll(page: Page, delta: number, duration = 1100) {
    const frame = 16;
    const steps = Math.max(12, Math.round(duration / frame));
    const easeInOut = (t: number) =>
      t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;

    let prev = 0;
    for (let i = 1; i <= steps; i++) {
      const eased = easeInOut(i / steps) * delta;
      await page.mouse.wheel(0, eased - prev);
      prev = eased;
      await page.waitForTimeout(frame);
    }
    await page.waitForTimeout(350);
  },
};

/**
 * Force a react-query refetch from outside the app, via the dev-only
 * window.__mockupQueryClient hook (App.tsx). Used by the WhatsApp flows to
 * reveal messages/drafts on a scripted schedule instead of waiting on the
 * app's slow polling intervals.
 */
export async function forceRefetch(page: Page, keyIncludes: string) {
  await page.evaluate((needle) => {
    const qc = (globalThis as { __mockupQueryClient?: any }).__mockupQueryClient;
    if (!qc) return;
    qc.invalidateQueries({
      predicate: (q: { queryKey: unknown }) => JSON.stringify(q.queryKey).includes(needle),
    });
  }, keyIncludes);
}

function newestFile(dir: string, ext: string): string {
  const files = readdirSync(dir)
    .filter((f) => f.endsWith(ext))
    .map((f) => ({ f, t: statSync(path.join(dir, f)).mtimeMs }))
    .sort((a, b) => b.t - a.t);
  if (files.length === 0) throw new Error(`No ${ext} file in ${dir}`);
  return path.join(dir, files[0]!.f);
}

function ffmpeg(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn("ffmpeg", args, { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    proc.stderr.on("data", (d) => (stderr += d.toString()));
    proc.on("error", reject);
    proc.on("close", (code) =>
      code === 0 ? resolve() : reject(new Error(`ffmpeg exited ${code}\n${stderr.slice(-800)}`)),
    );
  });
}

export async function record(opts: RecordOptions): Promise<string> {
  mkdirSync(RAW_DIR, { recursive: true });
  mkdirSync(VIDEO_OUT_DIR, { recursive: true });

  const browser = await chromium.launch({
    args: ["--force-color-profile=srgb", "--hide-scrollbars"],
  });
  const context = await browser.newContext({
    viewport: opts.viewport,
    deviceScaleFactor: 2,
    // Demo data is generated in SAST wall-clock; pin the browser to match so
    // booking times land where expected on the calendar.
    timezoneId: "Africa/Johannesburg",
    locale: "en-ZA",
    recordVideo: { dir: RAW_DIR, size: opts.viewport },
    ...(opts.authed ? { storageState: STORAGE_STATE } : {}),
  });
  // tsx/esbuild wraps functions with a __name() helper; define it in the page
  // so page.evaluate(fn) calls (see forceRefetch) don't ReferenceError.
  await context.addInitScript("globalThis.__name = globalThis.__name || function (f) { return f; };");
  await context.addInitScript(CURSOR_SCRIPT);

  const page = await context.newPage();
  const video = page.video();

  // Auto-trim: record when the flow says its first screen is ready, relative to
  // when capture began, and cut everything before it (minus a small lead-in).
  const startedAt = Date.now();
  let readyAt: number | null = null;
  const markReady = () => {
    if (readyAt === null) readyAt = Date.now();
  };

  try {
    await opts.action(page, { markReady });
  } finally {
    await context.close();
    await browser.close();
  }

  // Start a hair AFTER the ready moment: the load spinner disappears the instant
  // the content anchor appears, so trimming slightly past it guarantees the mp4
  // opens on settled content rather than a trailing spinner frame.
  const autoTrim =
    readyAt !== null ? Math.max(0, (readyAt - startedAt) / 1000 + 0.25) : opts.trimStart ?? 0;

  const rawWebm = video ? await video.path() : newestFile(RAW_DIR, ".webm");
  const outMp4 = path.join(VIDEO_OUT_DIR, `${opts.name}.mp4`);

  await ffmpeg([
    "-y",
    "-i", rawWebm,
    // -ss after -i = frame-accurate seek (input seeking lands on keyframes,
    // which are sparse in Playwright's webm and would show a stale frame).
    ...(autoTrim > 0 ? ["-ss", autoTrim.toFixed(2)] : []),
    "-c:v", "libx264",
    "-profile:v", "high",
    "-pix_fmt", "yuv420p",
    // even dimensions required by libx264
    "-vf", "scale=trunc(iw/2)*2:trunc(ih/2)*2",
    "-movflags", "+faststart",
    "-an",
    "-crf", "20",
    outMp4,
  ]);

  rmSync(rawWebm, { force: true });
  return outMp4;
}

/** Convenience for flows that always start at a given app path. */
export async function goto(page: Page, appPath: string) {
  // domcontentloaded, not networkidle: authed pages poll (react-query intervals)
  // and never reach idle. Flows wait on a real content anchor after this.
  await page.goto(`${WEB_URL}${appPath}`, { waitUntil: "domcontentloaded" });
}
