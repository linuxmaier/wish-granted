/**
 * Headless-Chromium rendering, as the *second* fallback after `unwrap-shell.ts`.
 *
 * ## Read this before assuming you need it
 *
 * No source in the current dataset needs this path. The three
 * `energyandhousing.wi.gov` records that motivated #76 are fixed by
 * `unwrapContentShell` alone -- their eligibility content is server-rendered and
 * a browser adds nothing (see `unwrap-shell.ts` and
 * `tests/fixtures/js-pages/SOURCES.md`). This exists as infrastructure for the
 * epic (#65): a genuinely client-rendered government page has not shown up yet,
 * but when one does, `recover.ts` will already reach for this before giving up.
 *
 * ## Design
 *
 * - **No new dependency.** `@playwright/test` is already a devDependency and CI
 *   already installs Chromium for the e2e suite. Playwright is imported
 *   dynamically so merely loading this module (self-test, typecheck, the Node
 *   test runner) never requires the browser binary.
 * - **Degrades, never throws.** Every failure mode -- Playwright not installed,
 *   Chromium binary missing, launch refused, navigation timeout -- returns
 *   `{ ok: false, reason }`. CI runs the smoke steps before `playwright install`,
 *   and on a machine with no browser this must be a clean "skipped", not a red
 *   suite (the issue is explicit about this).
 * - **Respects robots and the hard-deny list**, reusing
 *   `scripts/ingest-descriptive/lib/robots.ts` -- the same parser and
 *   `HARD_DENY_HOSTS` the plain fetchers use. A browser render is still a fetch.
 * - **Desktop-Chrome User-Agent**, the shared one from
 *   `scripts/refresh-income-tables/lib/http.ts`.
 */
import { USER_AGENT } from './http.ts';
import {
  parseRobots,
  isAllowed,
  isHardDenied,
} from './robots.ts';

export type RenderOutcome =
  | { readonly ok: true; readonly html: string; readonly finalUrl: string }
  | { readonly ok: false; readonly reason: string };

export interface BrowserRenderer {
  /** Fetch `url` in a real browser and return the settled DOM as HTML. */
  render(url: string): Promise<RenderOutcome>;
}

export interface PlaywrightRendererOptions {
  /** Milliseconds to allow for navigation + network settle. */
  readonly timeoutMs?: number;
  /** Override the robots.txt gate (tests). Defaults to a live fetch + parse. */
  readonly robotsGate?: (url: string) => Promise<{ allowed: boolean; reason: string }>;
}

const DEFAULT_TIMEOUT_MS = 45_000;

/** Minimal structural view of the slice of Playwright this module touches. */
interface PwPage {
  goto(url: string, opts: { waitUntil: 'networkidle'; timeout: number }): Promise<unknown>;
  content(): Promise<string>;
  url(): string;
}
interface PwContext {
  newPage(): Promise<PwPage>;
}
interface PwBrowser {
  newContext(opts: { userAgent: string }): Promise<PwContext>;
  close(): Promise<void>;
}
interface PwChromium {
  launch(opts?: { headless?: boolean }): Promise<PwBrowser>;
}

async function loadChromium(): Promise<PwChromium | null> {
  try {
    const mod = (await import('@playwright/test')) as unknown as { chromium?: PwChromium };
    return mod.chromium ?? null;
  } catch {
    return null;
  }
}

/** Live robots.txt gate: hard-deny list first, then the origin's robots.txt. */
async function liveRobotsGate(url: string): Promise<{ allowed: boolean; reason: string }> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { allowed: false, reason: `invalid URL: ${url}` };
  }
  if (isHardDenied(parsed.hostname)) {
    return { allowed: false, reason: `${parsed.hostname} is on the hard-deny list` };
  }
  try {
    const res = await fetch(`${parsed.origin}/robots.txt`, {
      headers: { 'User-Agent': USER_AGENT },
      signal: AbortSignal.timeout(15_000),
    });
    const text = await res.text();
    const looksLikeRobots = res.ok && !/^\s*<(?:!doctype|html)\b/i.test(text);
    const robots = looksLikeRobots ? parseRobots(text) : null;
    return isAllowed(robots, parsed.pathname)
      ? { allowed: true, reason: 'robots.txt allows it (or none published)' }
      : { allowed: false, reason: `robots.txt disallows ${parsed.pathname}` };
  } catch {
    // No reachable robots.txt is conventionally "no restriction stated".
    return { allowed: true, reason: 'no reachable robots.txt' };
  }
}

/**
 * The real renderer. Returns a renderer whose `render()` never throws: a missing
 * browser or a nav failure comes back as `{ ok: false }`.
 */
export function playwrightRenderer(opts: PlaywrightRendererOptions = {}): BrowserRenderer {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const robotsGate = opts.robotsGate ?? liveRobotsGate;

  return {
    async render(url: string): Promise<RenderOutcome> {
      const gate = await robotsGate(url);
      if (!gate.allowed) return { ok: false, reason: `blocked: ${gate.reason}` };

      const chromium = await loadChromium();
      if (!chromium) {
        return { ok: false, reason: 'Playwright is not available (cannot import @playwright/test)' };
      }

      let browser: PwBrowser | null = null;
      try {
        browser = await chromium.launch({ headless: true });
      } catch (err) {
        return {
          ok: false,
          reason: `Chromium would not launch (run "npx playwright install chromium"): ${errMsg(err)}`,
        };
      }

      try {
        const context = await browser.newContext({ userAgent: USER_AGENT });
        const page = await context.newPage();
        await page.goto(url, { waitUntil: 'networkidle', timeout: timeoutMs });
        const html = await page.content();
        return { ok: true, html, finalUrl: page.url() || url };
      } catch (err) {
        return { ok: false, reason: `render failed: ${errMsg(err)}` };
      } finally {
        await browser.close().catch(() => {});
      }
    },
  };
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Render HTML that is already in hand (no navigation) through a real browser --
 * `setContent` then read back `content()`. Used by the offline browser check to
 * prove the Playwright wiring on headless Linux with no network. Returns
 * `{ ok: false }` if the browser is unavailable.
 */
export async function renderStaticHtml(html: string, timeoutMs = 15_000): Promise<RenderOutcome> {
  const chromium = await loadChromium();
  if (!chromium) return { ok: false, reason: 'Playwright not available' };
  let browser: PwBrowser | null = null;
  try {
    browser = await chromium.launch({ headless: true });
  } catch (err) {
    return { ok: false, reason: `Chromium would not launch: ${errMsg(err)}` };
  }
  try {
    const context = await browser.newContext({ userAgent: USER_AGENT });
    const page = (await context.newPage()) as PwPage & {
      setContent(html: string, opts: { waitUntil: 'networkidle'; timeout: number }): Promise<unknown>;
    };
    await page.setContent(html, { waitUntil: 'networkidle', timeout: timeoutMs });
    return { ok: true, html: await page.content(), finalUrl: 'about:blank' };
  } catch (err) {
    return { ok: false, reason: `setContent failed: ${errMsg(err)}` };
  } finally {
    await browser.close().catch(() => {});
  }
}
