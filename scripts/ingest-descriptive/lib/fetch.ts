/**
 * The network layer for descriptive-field ingestion (#14).
 *
 * Reuses scripts/refresh-income-tables/lib/http.ts -- the shared client with a
 * desktop-Chrome User-Agent, because "WI state sites 403 naive fetchers" is a
 * spike finding, not a guess (docs/data-sources.md). It also carries the
 * response's final URL through, so a redirect to a different host reads as
 * "moved" rather than "gone".
 *
 * Before any source page is fetched, its host is checked against a hard-deny
 * list (findhelp.org, 211 Wisconsin) and its robots.txt. A `blocked` outcome is a
 * first-class result, not an error: the report names it and the pipeline moves
 * on.
 *
 * The fetcher is injected into classify/index so the classifier is testable
 * with zero network -- same pattern as scripts/check-sources.
 */
import { fetchText } from '../../refresh-income-tables/lib/http.ts';
import { errMsg } from '../../refresh-income-tables/lib/errors.ts';
import { parseRobots, isAllowed, isHardDenied, type RobotsTxt } from './robots.ts';

const TIMEOUT_MS = 30_000;

export type FetchOutcome =
  | { readonly kind: 'ok'; readonly finalUrl: string; readonly text: string }
  | { readonly kind: 'gone'; readonly finalUrl: string; readonly httpStatus: number }
  | { readonly kind: 'unreachable'; readonly finalUrl: string; readonly reason: string }
  | { readonly kind: 'blocked'; readonly finalUrl: string; readonly reason: string };

export type Fetcher = (url: string) => Promise<FetchOutcome>;

async function fetchWithTimeout(url: string): Promise<{ status: number; ok: boolean; text: string; finalUrl: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    return await fetchText(url, { signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

const robotsCache = new Map<string, RobotsTxt | null>();

async function robotsFor(origin: string): Promise<RobotsTxt | null> {
  const cached = robotsCache.get(origin);
  if (cached !== undefined) return cached;
  let parsed: RobotsTxt | null = null;
  try {
    const res = await fetchWithTimeout(`${origin}/robots.txt`);
    // A 200 that is actually an HTML error page (SharePoint on
    // energyandhousing.wi.gov does this) is not a robots.txt -- treat as absent.
    const looksLikeRobots = res.ok && !/^\s*<(?:!doctype|html)\b/i.test(res.text);
    parsed = looksLikeRobots ? parseRobots(res.text) : null;
  } catch {
    parsed = null;
  }
  robotsCache.set(origin, parsed);
  return parsed;
}

/** The real fetcher: hard-deny list, then robots.txt, then the page. */
export const liveFetcher: Fetcher = async (url) => {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { kind: 'unreachable', finalUrl: url, reason: `invalid URL: ${url}` };
  }

  if (isHardDenied(parsed.hostname)) {
    return { kind: 'blocked', finalUrl: url, reason: `${parsed.hostname} is on the hard-deny list (see lib/robots.ts)` };
  }

  const robots = await robotsFor(parsed.origin);
  if (!isAllowed(robots, parsed.pathname)) {
    return { kind: 'blocked', finalUrl: url, reason: `robots.txt disallows ${parsed.pathname} for generic agents` };
  }

  try {
    const res = await fetchWithTimeout(url);
    if (res.status === 404 || res.status === 410) {
      return { kind: 'gone', finalUrl: res.finalUrl, httpStatus: res.status };
    }
    if (!res.ok) {
      return { kind: 'unreachable', finalUrl: res.finalUrl, reason: `HTTP ${res.status}` };
    }
    return { kind: 'ok', finalUrl: res.finalUrl, text: res.text };
  } catch (err) {
    return { kind: 'unreachable', finalUrl: url, reason: errMsg(err) };
  }
};

/** Fetch each distinct URL once; several records share a `source.url`. */
export async function fetchDistinct(urls: readonly string[], fetcher: Fetcher, concurrency = 4): Promise<Map<string, FetchOutcome>> {
  const distinct = [...new Set(urls)];
  const results = new Map<string, FetchOutcome>();
  let next = 0;
  async function worker(): Promise<void> {
    while (next < distinct.length) {
      const url = distinct[next++]!;
      results.set(url, await fetcher(url));
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, distinct.length) }, worker));
  return results;
}
