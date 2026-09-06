// No shebang -- invoked as `node scripts/tier3-extract/index.mjs` via an npm
// script, same as scripts/extract-income-tables.mjs (see that file's note).
/**
 * Tier-3 deterministic-parse spike -- issue #62, experiment 3.
 *
 * "Has anyone ever tried to parse Tier 3 sources deterministically -- or did we
 * just assume they need an LLM?" This runs a real, dependency-free,
 * structure-preserving parser against the real Tier-3 corpus and reports a
 * measured hit rate, in the style of docs/eligibility-extraction.md Section 3's
 * "4/4 attempted HTML income-table sources".
 *
 *   node scripts/tier3-extract/index.mjs             # measure against fixtures
 *   node scripts/tier3-extract/index.mjs --verbose   # + per-source reasoning
 *   node scripts/tier3-extract/index.mjs --live       # refetch (desktop UA)
 *   node scripts/tier3-extract/index.mjs --self-test  # CI smoke: start & exit 0
 *
 * The four numbers are reported separately and never blended into an accuracy
 * figure, exactly as the LLM evals do (issue #62 rules):
 *   correct abstentions / dangerous over-claims / correct extractions / over-cautious
 * plus parse failures. A "dangerous over-claim" is an emitted rule whose
 * governing scope is missing -- scored as a failure exactly as the LLM's is.
 */

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { TIER3_SOURCES, TIER3_HELDOUT } from './sources.mjs';
import { extractFromHtml, extractFromEcfr } from './extract.mjs';

export { TIER3_SOURCES, TIER3_HELDOUT } from './sources.mjs';
export { extractFromHtml, extractFromEcfr } from './extract.mjs';

const SPLITS = { tuning: TIER3_SOURCES, heldout: TIER3_HELDOUT };

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_DIR = {
  tuning: path.join(__dirname, '..', '..', 'tests', 'fixtures', 'tier3'),
  heldout: path.join(__dirname, '..', '..', 'tests', 'fixtures', 'tier3-heldout'),
};
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

async function loadSource(src, live, split) {
  if (live) {
    const res = await fetch(src.url, {
      headers: { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml,application/xml' },
    });
    if (!res.ok) throw new Error(`${src.url} -> HTTP ${res.status}`);
    return res.text();
  }
  return readFile(path.join(FIXTURE_DIR[split], src.file), 'utf8');
}

/** Run the parser against one source and score it against its expected answer. */
export function scoreSource(src, text) {
  let result;
  try {
    result = src.kind === 'ecfr' ? extractFromEcfr(text, src) : extractFromHtml(text, src);
  } catch (err) {
    return { id: src.id, outcome: 'parse-failure', detail: String(err && err.message), result: null };
  }

  const exp = src.expected;
  if (exp.decision === 'abstain') {
    if (result.decision === 'abstain') {
      return { id: src.id, outcome: 'correct-abstention', detail: `${result.code}: ${result.reason}`, result };
    }
    return {
      id: src.id,
      outcome: 'dangerous-over-claim',
      detail: `emitted a rule where the source states none: ${JSON.stringify(result.criterion)}`,
      result,
    };
  }

  // expected extract
  if (result.decision === 'abstain') {
    return { id: src.id, outcome: 'over-cautious', detail: `${result.code}: ${result.reason}`, result };
  }
  const ok = !exp.mustMatch || exp.mustMatch(result.criterion);
  return {
    id: src.id,
    outcome: ok ? 'correct-extraction' : 'dangerous-over-claim',
    detail: ok
      ? `matched: ${JSON.stringify(result.criterion)}`
      : `emitted, but scope/number wrong: ${JSON.stringify(result.criterion)}`,
    result,
  };
}

export async function evaluate({ live = false, split = 'tuning' } = {}) {
  const rows = [];
  for (const src of SPLITS[split] ?? TIER3_SOURCES) {
    let text;
    try {
      text = await loadSource(src, live, split);
    } catch (err) {
      rows.push({ id: src.id, outcome: 'parse-failure', detail: `fetch: ${err.message}`, result: null });
      continue;
    }
    rows.push(scoreSource(src, text));
  }
  return rows;
}

const OUTCOMES = [
  'correct-abstention',
  'correct-extraction',
  'dangerous-over-claim',
  'over-cautious',
  'parse-failure',
];

function tally(rows) {
  const t = Object.fromEntries(OUTCOMES.map((o) => [o, 0]));
  for (const r of rows) t[r.outcome] = (t[r.outcome] ?? 0) + 1;
  return t;
}

const MARK = {
  'correct-abstention': 'ABSTAIN ok',
  'correct-extraction': 'EXTRACT ok',
  'dangerous-over-claim': 'DANGEROUS ',
  'over-cautious': 'over-caut ',
  'parse-failure': 'PARSE-FAIL',
};

async function reportSplit(split, { live, verbose }) {
  const rows = await evaluate({ live, split });
  const bySrc = Object.fromEntries(SPLITS[split].map((s) => [s.id, s]));

  console.log(`\n=== ${split.toUpperCase()} split (${rows.length} sources) ===`);
  for (const r of rows) {
    const s = bySrc[r.id];
    console.log(`${MARK[r.outcome]}  ${r.id.padEnd(30)} [tier ${s.tierAssigned}, want ${s.expected.decision}]`);
    if (verbose) {
      console.log(`            ${r.detail}`);
      if (r.result?.citation) console.log(`            @ ${r.result.citation}`);
      console.log();
    }
  }

  const t = tally(rows);
  const abstainN = SPLITS[split].filter((s) => s.expected.decision === 'abstain').length;
  const extractN = SPLITS[split].filter((s) => s.expected.decision === 'extract').length;
  console.log('  --- four numbers, never blended ---');
  console.log(`  correct abstentions : ${t['correct-abstention']} / ${abstainN}`);
  console.log(`  correct extractions : ${t['correct-extraction']} / ${extractN}`);
  console.log(`  DANGEROUS over-claims: ${t['dangerous-over-claim']}`);
  console.log(`  over-cautious        : ${t['over-cautious']}`);
  console.log(`  parse failures       : ${t['parse-failure']}`);
  return t;
}

async function main() {
  const argv = process.argv.slice(2);
  if (argv.includes('--self-test')) {
    let total = 0;
    for (const split of Object.keys(SPLITS)) {
      const rows = await evaluate({ live: false, split });
      if (rows.length !== SPLITS[split].length) {
        console.error(`self-test: ${split} expected ${SPLITS[split].length} rows, got ${rows.length}`);
        process.exitCode = 1;
        return;
      }
      total += rows.length;
    }
    console.log(`tier3-extract self-test OK -- ${total} sources evaluated across ${Object.keys(SPLITS).length} splits`);
    return;
  }

  const live = argv.includes('--live');
  const verbose = argv.includes('--verbose');
  const only = argv.find((a) => a.startsWith('--split='))?.slice('--split='.length);
  console.log(`Tier-3 deterministic parse -- ${live ? 'LIVE refetch' : 'local fixtures'}`);

  const splits = only ? [only] : Object.keys(SPLITS);
  let dangerous = 0;
  for (const split of splits) {
    const t = await reportSplit(split, { live, verbose });
    dangerous += t['dangerous-over-claim'];
  }
  if (dangerous > 0) process.exitCode = 2;
}

const isMain =
  process.argv[1] !== undefined &&
  path.resolve(fileURLToPath(import.meta.url)) === path.resolve(process.argv[1]);
if (isMain) {
  main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}
