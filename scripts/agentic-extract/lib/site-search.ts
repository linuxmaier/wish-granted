/**
 * Site-scoped search for the agentic extractor (#75).
 *
 * The failing shape this exists to solve, in the words of #72's own abstention
 * for `foodshare-snap-wi`:
 *
 *   "every guessed URL 404s and is redirected back to the FoodShare index... the
 *    site's sitemap is too large to search without a working text-search tool.
 *    Without reaching the page that states the actual income-limit figures... I
 *    cannot back a compare/incomeAtOrBelow eligibility rule with a verbatim
 *    quote."
 *
 * So: the extractor knows a rule is stated *somewhere* on the source's own host,
 * but not on the page it was handed, and cannot guess the URL. This finds that
 * page.
 *
 * Design (argued in the PR): **site-scoped, no third party, no API key, zero new
 * dependencies.** Search is confined to the host of the source URL being
 * extracted. It is a two-phase crawl:
 *
 *   1. Build a URL frontier from (a) the host's sitemap, if one is reachable,
 *      and (b) the links on the seed page and the host root.
 *   2. Rank the frontier by a cheap lexical match of the query against each URL's
 *      path, fetch the best candidates (bounded), score each fetched page's
 *      TEXT against the query, and follow links one or two hops deeper when the
 *      seed page's own links do not get there.
 *
 * Why not the site's own search endpoint: dhs.wisconsin.gov (the host every
 * unsolved case is on) `Disallow: /search/` in robots.txt, and its Akamai edge
 * returns "Access Denied" for *any* URL carrying a query string -- which also
 * makes its paginated Drupal sitemap (`/sitemap.xml?page=N`) unreachable. The
 * bare `/sitemap.xml` is only an index of those blocked children. So for the
 * host that matters the sitemap yields nothing and this degrades to a link
 * crawl -- which is exactly why phase 2 follows links rather than trusting the
 * sitemap. See `__tests__/fixtures/SOURCES.md`.
 *
 * PROVENANCE IS UNTOUCHED. This returns candidate URLs and snippets only. The
 * model still calls `fetch_page` on the page it picks; that page goes through
 * the Navigator and the existing provenance gate exactly as before. Nothing
 * here is added to the provenance page store, and `lib/provenance.ts` is not
 * modified.
 *
 * robots.txt / hard-deny: every fetch below goes through the injected `Fetcher`,
 * whose live implementation already gates every request on
 * `scripts/ingest-descriptive/lib/robots.ts` (hard-deny hosts + robots.txt).
 * This module adds no second robots implementation and never bypasses it -- a
 * `blocked` outcome is simply skipped.
 */
import type { Fetcher, FetchOutcome } from './fetcher.ts';
import { flattenText } from './html-structure.ts';

export interface SearchHit {
  /** Final URL of the page (what the model should hand to fetch_page). */
  readonly url: string;
  readonly title: string;
  /** A window of page text around the first query-term hit. */
  readonly snippet: string;
  /** Relevance score; higher is better. Only > 0 hits are returned. */
  readonly score: number;
}

export interface SiteSearchResult {
  readonly hits: readonly SearchHit[];
  /** Host the search was confined to. */
  readonly host: string;
  /** Pages actually fetched (phase 2). */
  readonly pagesFetched: number;
  /** Content URLs discovered from a sitemap (0 when no usable sitemap). */
  readonly sitemapUrls: number;
  /** Candour trail: what worked, what was blocked/absent. */
  readonly notes: readonly string[];
}

export interface SiteSearchOptions {
  readonly query: string;
  /** The source URL being extracted. Defines the host scope and a crawl seed. */
  readonly seedUrl: string;
  /** Max hits to return. Default 5. */
  readonly maxResults?: number;
  /** Hard ceiling on pages fetched in phase 2. Default 25. */
  readonly maxFetches?: number;
}

const DEFAULT_MAX_RESULTS = 5;
const DEFAULT_MAX_FETCHES = 25;
/** Child sitemaps to follow from a <sitemapindex>. */
const MAX_SITEMAP_CHILDREN = 15;
/** Upper bound on the frontier, so a link-dense hub cannot make this unbounded. */
const MAX_FRONTIER = 500;
/** How many link hops from the seed page phase 2 will follow. */
const CRAWL_DEPTH = 2;
/** Stop early once this many solid hits are in hand and enough pages were seen. */
const EARLY_STOP_SCORE = 8;
const EARLY_STOP_MIN_FETCHES = 6;

const STOPWORDS = new Set([
  'the', 'a', 'an', 'of', 'for', 'to', 'in', 'on', 'and', 'or', 'is', 'are',
  'be', 'if', 'you', 'your', 'my', 'with', 'at', 'as', 'by', 'how', 'do',
  'does', 'what', 'which', 'when', 'where', 'who', 'page', 'site', 'gov',
  'www', 'htm', 'html', 'index', 'about', 'info', 'information',
]);

const ASSET_EXT =
  /\.(?:css|js|mjs|json|png|jpe?g|gif|svg|webp|avif|ico|bmp|tiff?|woff2?|ttf|otf|eot|mp4|m4v|mov|avi|wmv|mp3|wav|ogg|zip|gz|tar|rar|7z|xlsx?|pptx?|docx?|rtf|csv|xml|rss)$/i;

function queryTerms(q: string): string[] {
  return [
    ...new Set(
      q
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter((t) => t.length >= 3 && !STOPWORDS.has(t)),
    ),
  ];
}

function decodeXmlEntities(s: string): string {
  return s
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)));
}

/** Absolute, same-scheme, fragment-stripped URL -- or null if not a page URL. */
function normalizeUrl(raw: string, base: string): string | null {
  let u: URL;
  try {
    u = new URL(raw, base);
  } catch {
    return null;
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
  u.hash = '';
  if (ASSET_EXT.test(u.pathname)) return null;
  return u.toString();
}

function extractLocs(xml: string): string[] {
  const out: string[] = [];
  const re = /<loc>\s*([^<\s]+)\s*<\/loc>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) out.push(decodeXmlEntities(m[1]!));
  return out;
}

function isSitemapIndex(xml: string): boolean {
  return /<sitemapindex[\s>]/i.test(xml);
}

export function extractHrefs(html: string): string[] {
  const out: string[] = [];
  const re = /<a\b[^>]*\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const href = m[1] ?? m[2] ?? m[3];
    if (href) out.push(href);
  }
  return out;
}

function pageTitle(html: string): string {
  const m = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  if (!m) return '';
  return decodeXmlEntities(m[1]!.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
}

/** Cheap pre-fetch ordering: query terms found in the URL's own path. */
function urlPrescore(terms: readonly string[], url: string): number {
  let slug: string;
  let depth: number;
  try {
    const u = new URL(url);
    slug = decodeURIComponent(u.pathname).toLowerCase().replace(/[^a-z0-9]+/g, ' ');
    depth = u.pathname.split('/').filter(Boolean).length;
  } catch {
    return 0;
  }
  let score = 0;
  for (const term of terms) if (slug.includes(term)) score += 3;
  return score - depth * 0.1;
}

interface PageScore {
  readonly score: number;
  readonly snippet: string;
}

function scorePage(terms: readonly string[], title: string, text: string): PageScore {
  if (terms.length === 0) return { score: 0, snippet: text.slice(0, 200).trim() };
  const lcTitle = title.toLowerCase();
  const lcText = text.toLowerCase();
  let score = 0;
  let firstHit = -1;
  let present = 0;

  for (const term of terms) {
    let seen = false;
    if (lcTitle.includes(term)) {
      score += 5;
      seen = true;
    }
    const idx = lcText.indexOf(term);
    if (idx >= 0) {
      seen = true;
      if (firstHit < 0 || idx < firstHit) firstHit = idx;
      if (idx < 1200) score += 2;
      let count = 0;
      let from = 0;
      while (count < 12) {
        const at = lcText.indexOf(term, from);
        if (at < 0) break;
        count += 1;
        from = at + term.length;
      }
      score += Math.min(count, 10);
    }
    if (seen) present += 1;
  }

  // Require the page to cover at least half the query terms; a page that only
  // matches "income" for the query "foodshare monthly income limits" is noise.
  if (present / terms.length < 0.5) return { score: 0, snippet: '' };

  const start = firstHit >= 0 ? Math.max(0, firstHit - 60) : 0;
  const snippet = text.slice(start, start + 220).replace(/\s+/g, ' ').trim();
  return { score, snippet };
}

async function fetchOk(
  fetcher: Fetcher,
  url: string,
  cache: Map<string, FetchOutcome>,
): Promise<FetchOutcome> {
  const hit = cache.get(url);
  if (hit) return hit;
  let outcome: FetchOutcome;
  try {
    outcome = await fetcher({ url });
  } catch (err) {
    outcome = { kind: 'unreachable', requestedUrl: url, reason: err instanceof Error ? err.message : String(err) };
  }
  cache.set(url, outcome);
  return outcome;
}

/**
 * Search the source's own host for a page matching `query`. Returns ranked
 * candidate URLs with snippets -- the caller (the agent loop) still fetches and
 * quotes the chosen page through the normal provenance path.
 */
export async function siteSearch(fetcher: Fetcher, opts: SiteSearchOptions): Promise<SiteSearchResult> {
  const notes: string[] = [];
  let seed: URL;
  try {
    seed = new URL(opts.seedUrl);
  } catch {
    return { hits: [], host: '', pagesFetched: 0, sitemapUrls: 0, notes: ['invalid seed URL'] };
  }
  const origin = seed.origin;
  const host = seed.host;
  const terms = queryTerms(opts.query);
  const maxResults = opts.maxResults ?? DEFAULT_MAX_RESULTS;
  const maxFetches = opts.maxFetches ?? DEFAULT_MAX_FETCHES;

  if (terms.length === 0) {
    return { hits: [], host, pagesFetched: 0, sitemapUrls: 0, notes: ['query had no usable search terms'] };
  }

  const cache = new Map<string, FetchOutcome>();
  const frontier = new Map<string, number>(); // normalized url -> crawl depth
  const addToFrontier = (raw: string, depth: number, base: string): void => {
    if (frontier.size >= MAX_FRONTIER) return;
    const n = normalizeUrl(raw, base);
    if (!n) return;
    try {
      if (new URL(n).origin !== origin) return;
    } catch {
      return;
    }
    if (!frontier.has(n)) frontier.set(n, depth);
  };

  // -- Phase 1a: sitemap discovery -------------------------------------------
  let sitemapUrls = 0;
  const sitemapTargets = new Set<string>([`${origin}/sitemap.xml`]);
  const robots = await fetchOk(fetcher, `${origin}/robots.txt`, cache);
  if ((robots.kind === 'ok' || robots.kind === 'moved') && robots.body) {
    for (const m of robots.body.matchAll(/^\s*sitemap:\s*(\S+)/gim)) {
      const s = normalizeUrl(m[1]!, origin);
      if (s) sitemapTargets.add(s);
    }
  }
  const sitemapQueue = [...sitemapTargets];
  const seenSitemaps = new Set<string>();
  let sitemapFetches = 0;
  while (sitemapQueue.length > 0 && sitemapFetches < MAX_SITEMAP_CHILDREN + 4) {
    const su = sitemapQueue.shift()!;
    if (seenSitemaps.has(su)) continue;
    seenSitemaps.add(su);
    const r = await fetchOk(fetcher, su, cache);
    sitemapFetches += 1;
    if (r.kind !== 'ok' && r.kind !== 'moved') {
      notes.push(`sitemap ${su} unreachable (${r.kind}${'reason' in r ? `: ${r.reason}` : ''})`);
      continue;
    }
    const body = r.body ?? '';
    const locs = extractLocs(body);
    if (isSitemapIndex(body)) {
      for (const loc of locs.slice(0, MAX_SITEMAP_CHILDREN)) sitemapQueue.push(loc);
    } else {
      for (const loc of locs) {
        addToFrontier(loc, 0, origin);
        sitemapUrls += 1;
      }
    }
  }
  notes.push(
    sitemapUrls > 0
      ? `sitemap contributed ${sitemapUrls} URL(s)`
      : 'no usable sitemap -- searching by link crawl from the seed page',
  );

  // -- Phase 1b: link seeds (seed page + host root) --------------------------
  for (const s of [seed.toString(), `${origin}/`]) {
    const r = await fetchOk(fetcher, s, cache);
    if (r.kind === 'ok' || r.kind === 'moved') {
      addToFrontier(r.finalUrl, 0, origin);
      for (const href of extractHrefs(r.body ?? '')) addToFrontier(href, 1, r.finalUrl);
    }
  }

  if (frontier.size === 0) {
    return { hits: [], host, pagesFetched: 0, sitemapUrls, notes: [...notes, 'nothing to search: no sitemap and the seed page has no links'] };
  }

  // -- Phase 2: fetch the best candidates, score their text -----------------
  const visited = new Set<string>();
  const scored = new Map<string, SearchHit>();
  const queue = [...frontier.keys()];
  const orderTail = (from: number): void => {
    const tail = queue.slice(from);
    tail.sort((a, b) => urlPrescore(terms, b) - urlPrescore(terms, a));
    queue.splice(from, tail.length, ...tail);
  };
  orderTail(0);

  let pagesFetched = 0;
  for (let i = 0; i < queue.length && pagesFetched < maxFetches; i += 1) {
    const url = queue[i]!;
    if (visited.has(url)) continue;
    visited.add(url);
    const depth = frontier.get(url) ?? CRAWL_DEPTH;

    const r = await fetchOk(fetcher, url, cache);
    pagesFetched += 1;
    if (r.kind !== 'ok' && r.kind !== 'moved') continue;

    if (r.contentType === 'pdf') {
      // Can't cheaply read a PDF here; surface it on URL-slug evidence alone so
      // the model can decide to fetch_page it (fetch_page reads PDFs, #77).
      const s = urlPrescore(terms, r.finalUrl);
      if (s >= 3) {
        scored.set(r.finalUrl, { url: r.finalUrl, title: '(PDF document)', snippet: 'Linked PDF; fetch_page can read it.', score: s });
      }
      continue;
    }

    const body = r.body ?? '';
    const title = pageTitle(body);
    const { score, snippet } = scorePage(terms, title, flattenText(body));
    if (score > 0) {
      const prev = scored.get(r.finalUrl);
      if (!prev || score > prev.score) scored.set(r.finalUrl, { url: r.finalUrl, title, snippet, score });
    }

    if (depth < CRAWL_DEPTH) {
      let added = 0;
      for (const href of extractHrefs(body)) {
        const before = frontier.size;
        addToFrontier(href, depth + 1, r.finalUrl);
        if (frontier.size > before) {
          const n = normalizeUrl(href, r.finalUrl)!;
          if (!visited.has(n)) {
            queue.push(n);
            added += 1;
          }
        }
      }
      if (added > 0) orderTail(i + 1);
    }

    const solid = [...scored.values()].filter((h) => h.score >= EARLY_STOP_SCORE);
    if (solid.length >= maxResults && pagesFetched >= EARLY_STOP_MIN_FETCHES) break;
  }

  const hits = [...scored.values()].sort((a, b) => b.score - a.score).slice(0, maxResults);
  if (hits.length === 0) notes.push(`fetched ${pagesFetched} page(s); none matched the query terms`);
  return { hits, host, pagesFetched, sitemapUrls, notes };
}

/** Render a result set for a tool_result string the model reads. */
export function formatSearchResult(query: string, res: SiteSearchResult): string {
  const header =
    `Site-scoped search of ${res.host} for "${query}" ` +
    `(this search covers only ${res.host}; ${res.pagesFetched} page(s) examined).`;
  if (res.hits.length === 0) {
    return [
      header,
      '',
      'No page on this site matched. Try different or fewer terms, or abstain if',
      'the governing text is not on this host.',
      res.notes.length > 0 ? `\nnotes: ${res.notes.join(' | ')}` : '',
    ].join('\n');
  }
  const lines = res.hits.map(
    (h, i) => `${i + 1}. ${h.url}\n   ${h.title || '(untitled)'}\n   ...${h.snippet}...`,
  );
  return [
    header,
    '',
    'Fetch the page you want with fetch_page to read it and quote it verbatim --',
    'these snippets are not provenance.',
    '',
    ...lines,
  ].join('\n');
}
