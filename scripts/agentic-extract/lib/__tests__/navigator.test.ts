import { test } from 'node:test';
import assert from 'node:assert/strict';

import { Navigator, recoveryCandidates } from '../navigator.ts';
import { createFixtureFetcher } from '../fetcher.ts';

test('recoveryCandidates probes the directory index and sibling pages, same host', () => {
  const cands = recoveryCandidates('https://www.dhs.wisconsin.gov/badgercareplus/income-limits.htm');
  assert.ok(cands.includes('https://www.dhs.wisconsin.gov/badgercareplus/index.htm'));
  assert.ok(cands.includes('https://www.dhs.wisconsin.gov/badgercareplus/'));
  assert.ok(cands.every((u) => u.startsWith('https://www.dhs.wisconsin.gov/')));
});

test('open() recovers a 404 by finding the live sibling page itself', async () => {
  const { fetcher } = createFixtureFetcher({
    'https://x.gov/p/income-limits.htm': { status: 404 },
    'https://x.gov/p/': { status: 404 },
    'https://x.gov/p/index.htm': { body: '<main><h1>Live</h1><p>real eligibility copy here</p></main>' },
  });
  const nav = new Navigator(fetcher);
  const r = await nav.open('https://x.gov/p/income-limits.htm');
  assert.ok(r.ok);
  assert.equal(r.page.finalUrl, 'https://x.gov/p/index.htm');
  assert.equal(r.page.recovered, true);
  assert.match(r.page.structured, /real eligibility copy/);
});

test('open() reports gone when nothing recovers it, with the list it tried', async () => {
  const { fetcher } = createFixtureFetcher({ 'https://x.gov/p/dead.htm': { status: 404 } });
  const nav = new Navigator(fetcher);
  const r = await nav.open('https://x.gov/p/dead.htm');
  assert.equal(r.ok, false);
  if (!r.ok) {
    assert.equal(r.reason, 'gone');
    assert.ok((r.triedRecovery ?? []).length > 0);
  }
});

test('open() flags a host redirect as moved-host but still returns the body', async () => {
  const { fetcher } = createFixtureFetcher({
    'https://old.gov/p': { body: '<main><p>moved body</p></main>', finalUrl: 'https://new.gov/p' },
  });
  const nav = new Navigator(fetcher);
  const r = await nav.open('https://old.gov/p');
  assert.equal(r.ok, false);
  if (!r.ok) {
    assert.equal(r.reason, 'moved-host');
    assert.equal(r.movedTo, 'https://new.gov/p');
    assert.match(r.page?.structured ?? '', /moved body/);
  }
});

test('the page store keys pages by their final URL for later provenance matching', async () => {
  const { fetcher } = createFixtureFetcher({
    'https://x.gov/a': { body: '<main><p>alpha copy</p></main>' },
  });
  const nav = new Navigator(fetcher);
  await nav.open('https://x.gov/a');
  assert.ok(nav.store().has('https://x.gov/a'));
  assert.match(nav.store().get('https://x.gov/a')?.flat ?? '', /alpha copy/);
});
