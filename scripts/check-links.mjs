/**
 * Link liveness check. Opt-in, never part of the app or the e2e suite.
 *
 * Why it lives here and not in Playwright: two tests in tests/e2e/personas.spec.ts
 * assert the interview makes *zero* network requests, and that guarantee is worth
 * more than link checking. A liveness assertion inside the browser suite would
 * either violate it or quietly weaken it, so this runs on its own.
 *
 * What it catches is real: benefits.gov was retired and 301'd to a UTM-tagged
 * USA.gov URL, and the e2e test kept passing because it only ever asserted our
 * own link text rendered -- not that the destination resolved (issue #19).
 *
 *   node scripts/check-links.mjs          # report only, always exits 0
 *   node scripts/check-links.mjs --strict # exit 1 on a dead link (not a redirect)
 *
 * A redirect is reported, never failed, even under --strict: agency sites
 * reorganise constantly and a 301 to a live page is a nudge to update a
 * record, not a broken build. A scheduled job that fails most weeks for a
 * benign reason is a job everyone learns to ignore, which is worse than not
 * having it -- see the scheduled workflow in .github/workflows/check-links.yml
 * (issue #15). Only an actually dead link (4xx/5xx/network error) fails
 * --strict.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const TIMEOUT_MS = 20_000;

/** Pulls every url: '...' literal out of a source file, with a label. */
function urlsIn(path, label) {
  const src = readFileSync(path, 'utf8');
  const found = [];
  for (const m of src.matchAll(/url:\s*'([^']+)'/g)) {
    if (m[1].startsWith('http')) found.push({ url: m[1], where: label });
  }
  return found;
}

const targets = [
  ...urlsIn(join(ROOT, 'src/data/national-resources.ts'), 'national-resources'),
  ...readdirSync(join(ROOT, 'src/data/programs'))
    .filter((f) => f.endsWith('.ts') && f !== 'index.ts')
    .flatMap((f) => urlsIn(join(ROOT, 'src/data/programs', f), f.replace(/\.ts$/, ''))),
];

// The same URL often appears as both source and howToApply; check it once.
const unique = [...new Map(targets.map((t) => [t.url, t])).values()];

console.log(`Checking ${unique.length} links from ${targets.length} references...\n`);

const results = await Promise.all(
  unique.map(async ({ url, where }) => {
    const ctl = AbortSignal.timeout(TIMEOUT_MS);
    try {
      // Some agency hosts reject HEAD; GET without following gives us the
      // redirect target, which is the thing worth reporting.
      const res = await fetch(url, { method: 'GET', redirect: 'manual', signal: ctl });
      const location = res.headers.get('location');
      return { url, where, status: res.status, location };
    } catch (err) {
      return { url, where, status: 0, error: err.message ?? String(err) };
    }
  }),
);

const dead = results.filter((r) => r.status === 0 || r.status >= 400);
const moved = results.filter((r) => r.status >= 300 && r.status < 400);
const ok = results.filter((r) => r.status >= 200 && r.status < 300);

for (const r of dead) {
  console.log(`DEAD     ${r.status || 'ERR'}  ${r.url}\n         in ${r.where}${r.error ? ` -- ${r.error}` : ''}`);
}
for (const r of moved) {
  console.log(`MOVED    ${r.status}  ${r.url}\n         in ${r.where}\n         -> ${r.location}`);
}

console.log(`\n${ok.length} ok, ${moved.length} redirected, ${dead.length} dead.`);

if (dead.length || moved.length) {
  console.log(
    '\nA redirect is not automatically a bug, but record the destination rather than\n' +
      'the redirector -- see docs/data-authoring.md. A dead link in national-resources\n' +
      'is worse than a dead link elsewhere: those are shown to people this tool cannot\n' +
      'otherwise help.',
  );
}

// Only a dead link fails --strict; a redirect is informational (see docblock).
if (process.argv.includes('--strict') && dead.length) process.exit(1);
