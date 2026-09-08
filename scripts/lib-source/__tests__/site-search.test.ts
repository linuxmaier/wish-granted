import { test } from 'node:test';
import assert from 'node:assert/strict';

import { siteSearch, extractHrefs, formatSearchResult } from '../site-search.ts';
import { createFixtureFetcher } from '../fetcher.ts';
import { parseRobots, isAllowed } from '../robots.ts';
import * as F from '../fixtures-offline.ts';

const fx = () => createFixtureFetcher(F.offlineFixtures('2026-09-06'));

test('finds the FoodShare income-limits page the entry page does not visibly link to', async () => {
  const { fetcher } = fx();
  const res = await siteSearch(fetcher, {
    query: 'FoodShare monthly income limits household size gross income',
    seedUrl: F.FOODSHARE_INDEX_URL,
  });
  assert.ok(res.hits.length > 0, `no hits: ${res.notes.join(' | ')}`);
  assert.equal(res.hits[0]!.url, F.FOODSHARE_FPL_URL, `top hit was ${res.hits[0]!.url}`);
  // The income-limits page must outrank the FoodShare "how to apply" page.
  const elig = res.hits.find((h) => h.url === F.FOODSHARE_ELIGIBILITY_URL);
  if (elig) assert.ok(res.hits[0]!.score > elig.score);
});

test('the entry page render does not expose the fpl.htm URL -- search is what bridges the gap', () => {
  // Raw HTML has the link; it lives in <nav>, which the model never sees.
  assert.ok(F.FOODSHARE_INDEX_HTML.includes('/foodshare/fpl.htm'));
  const navHrefs = extractHrefs(F.FOODSHARE_INDEX_HTML);
  assert.ok(navHrefs.includes('/foodshare/fpl.htm'));
});

test('the sitemap index is followed, its 403 children are tolerated, and the crawl still succeeds', async () => {
  const { fetcher, calls } = fx();
  const res = await siteSearch(fetcher, {
    query: 'FoodShare monthly income limits',
    seedUrl: F.FOODSHARE_INDEX_URL,
  });
  assert.ok(calls.some((c) => c.url === F.DHS_SITEMAP_URL), 'sitemap index not fetched');
  assert.ok(calls.some((c) => /sitemap\.xml\?page=\d+/.test(c.url)), 'child sitemaps not attempted');
  assert.equal(res.sitemapUrls, 0, 'no content URLs should come from the (blocked) paginated sitemap');
  assert.ok(res.notes.some((n) => /no usable sitemap|link crawl/.test(n)));
  assert.ok(res.hits.some((h) => h.url === F.FOODSHARE_FPL_URL));
});

test('robots.txt Disallow: /search/ is why site-search never uses the DHS search endpoint', () => {
  const robots = parseRobots(F.DHS_ROBOTS_TXT);
  assert.equal(isAllowed(robots, '/search/node?keys=foodshare'), false);
  assert.equal(isAllowed(robots, '/index.php/search/node'), false);
  // Content pages stay fetchable -- the crawl path is legitimate.
  assert.equal(isAllowed(robots, '/foodshare/fpl.htm'), true);
  assert.equal(isAllowed(robots, '/sitemap.xml'), true);
});

test('a query on a hard-denied host yields nothing (the fetcher blocks every request)', async () => {
  const { fetcher } = createFixtureFetcher({
    'https://www.findhelp.org/robots.txt': { blocked: 'hard-deny' },
    'https://www.findhelp.org/': { blocked: 'hard-deny' },
    'https://www.findhelp.org/programs/snap': { blocked: 'hard-deny' },
  });
  const res = await siteSearch(fetcher, { query: 'snap income limits', seedUrl: 'https://www.findhelp.org/programs/snap' });
  assert.equal(res.hits.length, 0);
});

test('an empty / stopword-only query returns no hits and says why', async () => {
  const { fetcher } = fx();
  const res = await siteSearch(fetcher, { query: 'the a of for', seedUrl: F.FOODSHARE_INDEX_URL });
  assert.equal(res.hits.length, 0);
  assert.match(res.notes.join(' '), /no usable search terms/);
});

test('formatSearchResult tells the model the snippets are not provenance', () => {
  const text = formatSearchResult('x', {
    hits: [{ url: 'https://h/p', title: 'T', snippet: 's', score: 9 }],
    host: 'h',
    pagesFetched: 3,
    sitemapUrls: 0,
    notes: [],
  });
  assert.match(text, /not provenance/);
  assert.match(text, /fetch_page/);
});
