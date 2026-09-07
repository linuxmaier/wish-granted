/**
 * The network layer for agentic extraction (#67).
 *
 * A `Fetcher` takes a URL (and optional extra headers) and returns a
 * first-class outcome -- `ok` / `gone` / `moved` / `unreachable` / `blocked` --
 * never throws for an HTTP-level problem. The agent loop and the navigator are
 * written against this interface so every test runs with a fixture fetcher and
 * zero network.
 *
 * The live fetcher reuses, rather than re-implements:
 *   - the desktop-Chrome User-Agent from scripts/refresh-income-tables/lib/http.ts
 *     (WI state sites 403 naive fetchers -- docs/data-sources.md, issue #4),
 *   - the robots.txt parser + hard-deny list from
 *     scripts/ingest-descriptive/lib/robots.ts (findhelp.org, auntbertha.com,
 *     211 Wisconsin are never fetched, per the issue).
 *
 * It adds two things scripts/ingest-descriptive/lib/fetch.ts does not need but
 * this pipeline does: per-request extra headers (the eCFR versioner API needs
 * `Accept-Encoding`), and a `moved` outcome distinct from `ok` when the final
 * URL's host changed (#7's gone/moved distinction, which the issue calls "the
 * natural input" for URL recovery).
 */
import { USER_AGENT } from '../../refresh-income-tables/lib/http.ts';
import {
  parseRobots,
  isAllowed,
  isHardDenied,
  type RobotsTxt,
} from '../../ingest-descriptive/lib/robots.ts';

export type FetchOutcome =
  | { readonly kind: 'ok'; readonly finalUrl: string; readonly status: number; readonly body: string; readonly redirected: boolean }
  | { readonly kind: 'moved'; readonly finalUrl: string; readonly status: number; readonly body: string }
  | { readonly kind: 'gone'; readonly requestedUrl: string; readonly finalUrl: string; readonly status: number }
  | { readonly kind: 'unreachable'; readonly requestedUrl: string; readonly reason: string }
  | { readonly kind: 'blocked'; readonly requestedUrl: string; readonly reason: string };

export interface FetchRequest {
  readonly url: string;
  readonly headers?: Readonly<Record<string, string>>;
}

export type Fetcher = (req: FetchRequest) => Promise<FetchOutcome>;

const TIMEOUT_MS = 30_000;

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return '';
  }
}

/**
 * The real fetcher: hard-deny list, then robots.txt, then the page. Injected
 * everywhere so nothing in the test suite can reach it.
 */
export function createLiveFetcher(): Fetcher {
  const robotsCache = new Map<string, RobotsTxt | null>();

  async function robotsFor(origin: string): Promise<RobotsTxt | null> {
    const cached = robotsCache.get(origin);
    if (cached !== undefined) return cached;
    let parsed: RobotsTxt | null = null;
    try {
      const res = await fetch(`${origin}/robots.txt`, {
        headers: { 'User-Agent': USER_AGENT },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      const text = await res.text();
      const looksLikeRobots = res.ok && !/^\s*<(?:!doctype|html)\b/i.test(text);
      parsed = looksLikeRobots ? parseRobots(text) : null;
    } catch {
      parsed = null;
    }
    robotsCache.set(origin, parsed);
    return parsed;
  }

  return async ({ url, headers }) => {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return { kind: 'unreachable', requestedUrl: url, reason: `invalid URL: ${url}` };
    }

    if (isHardDenied(parsed.hostname)) {
      return { kind: 'blocked', requestedUrl: url, reason: `${parsed.hostname} is on the hard-deny list (scripts/ingest-descriptive/lib/robots.ts)` };
    }

    const robots = await robotsFor(parsed.origin);
    if (!isAllowed(robots, parsed.pathname)) {
      return { kind: 'blocked', requestedUrl: url, reason: `robots.txt disallows ${parsed.pathname} for generic agents` };
    }

    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': USER_AGENT, Accept: '*/*', ...headers },
        signal: AbortSignal.timeout(TIMEOUT_MS),
        redirect: 'follow',
      });
      const body = await res.text();
      const finalUrl = res.url || url;
      if (res.status === 404 || res.status === 410) {
        return { kind: 'gone', requestedUrl: url, finalUrl, status: res.status };
      }
      if (!res.ok) {
        return { kind: 'unreachable', requestedUrl: url, reason: `HTTP ${res.status}` };
      }
      if (hostOf(finalUrl) !== parsed.hostname) {
        return { kind: 'moved', finalUrl, status: res.status, body };
      }
      return { kind: 'ok', finalUrl, status: res.status, body, redirected: finalUrl !== url };
    } catch (err) {
      return { kind: 'unreachable', requestedUrl: url, reason: err instanceof Error ? err.message : String(err) };
    }
  };
}

export interface FixtureEntry {
  /** HTTP status to report. 200 default. 404/410 -> `gone`. */
  readonly status?: number;
  /** Response body. */
  readonly body?: string;
  /** Final URL if this fixture represents a redirect. */
  readonly finalUrl?: string;
  /** Simulate a transport failure. */
  readonly unreachable?: string;
  /** Simulate a robots/hard-deny block. */
  readonly blocked?: string;
  /**
   * When set, this fixture is only served if the request carries every one of
   * these headers (case-insensitive name match, value substring). Used to prove
   * the eCFR versioner call sends `Accept-Encoding` -- without it the fixture
   * 406s, exactly like the live endpoint.
   */
  readonly requireHeaders?: Readonly<Record<string, string>>;
}

export interface RecordingFetcher {
  readonly fetcher: Fetcher;
  /** Every request the code under test made, in order. */
  readonly calls: { url: string; headers: Readonly<Record<string, string>> }[];
}

/**
 * A fetcher backed by an in-memory URL map. The key may be an exact URL or a
 * URL without its query string; the exact match wins. Records every call so a
 * test can assert on headers (Accept-Encoding) and on navigation order
 * (multi-page assembly).
 */
export function createFixtureFetcher(fixtures: Readonly<Record<string, FixtureEntry>>): RecordingFetcher {
  const calls: { url: string; headers: Readonly<Record<string, string>> }[] = [];

  const fetcher: Fetcher = async ({ url, headers }) => {
    const hdrs = headers ?? {};
    calls.push({ url, headers: hdrs });

    const entry = fixtures[url] ?? fixtures[url.split('?')[0]!];
    if (!entry) return { kind: 'unreachable', requestedUrl: url, reason: `no fixture for ${url}` };

    if (entry.blocked) return { kind: 'blocked', requestedUrl: url, reason: entry.blocked };
    if (entry.unreachable) return { kind: 'unreachable', requestedUrl: url, reason: entry.unreachable };

    if (entry.requireHeaders) {
      for (const [name, needle] of Object.entries(entry.requireHeaders)) {
        const got = Object.entries(hdrs).find(([k]) => k.toLowerCase() === name.toLowerCase())?.[1];
        if (!got || !got.toLowerCase().includes(needle.toLowerCase())) {
          return { kind: 'unreachable', requestedUrl: url, reason: 'HTTP 406' };
        }
      }
    }

    const status = entry.status ?? 200;
    const finalUrl = entry.finalUrl ?? url;
    const body = entry.body ?? '';
    if (status === 404 || status === 410) {
      return { kind: 'gone', requestedUrl: url, finalUrl, status };
    }
    if (status >= 400) {
      return { kind: 'unreachable', requestedUrl: url, reason: `HTTP ${status}` };
    }
    if (hostOf(finalUrl) && hostOf(finalUrl) !== hostOf(url)) {
      return { kind: 'moved', finalUrl, status, body };
    }
    return { kind: 'ok', finalUrl, status, body, redirected: finalUrl !== url };
  };

  return { fetcher, calls };
}
