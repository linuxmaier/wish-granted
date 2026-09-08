import type { CaseScore } from './score.ts';
import type { BenchmarkRun } from './run.ts';

/**
 * Rendering a benchmark run. The six dimensions are reported in six separate
 * blocks and NEVER combined into one score (docs/program-benchmark.md).
 *
 * Three conditions block on a live run: an over-claim finding, an under-claim
 * finding, or a yield below MIN_USABLE_RULE_RATE. Why all three, and why
 * over-claim ranks worse: docs/standing-decisions.md, "The two harms".
 *
 * SKIPPED is reported honestly: when every case is `skipped-no-key`, the
 * summary says "No numbers were measured" and nothing is presented as a result.
 */

/**
 * Minimum share of scored records that must come back with a real rule (not a
 * whole-record abstention) before a live run counts as a measurement rather
 * than a refusal.
 *
 * Deliberately a low bar -- not a quality target, but the floor below which the
 * harm counts stop meaning anything. Raise it as the pipeline improves; do not
 * lower it to make a run pass.
 */
export const MIN_USABLE_RULE_RATE = 0.25;

export interface RenderedReport {
  readonly text: string;
  /**
   * True when a live run hit any blocking condition: an over-claim, an
   * under-claim, or a degenerate yield. All three block; the specific reasons
   * are in `blockingReasons`.
   */
  readonly blocking: boolean;
  /** Human-readable blocking conditions, empty when the run is not blocking. */
  readonly blockingReasons: readonly string[];
  /** True when nothing was measured (all cases skipped / not wired). */
  readonly nothingMeasured: boolean;
}

interface Tally {
  scored: number;
  skippedNoKey: number;
  notWired: number;
  extractorError: number;
  gateFailed: number;
  extractorAbstained: number;
}

function tally(scores: readonly CaseScore[]): Tally {
  const t: Tally = { scored: 0, skippedNoKey: 0, notWired: 0, extractorError: 0, gateFailed: 0, extractorAbstained: 0 };
  for (const s of scores) {
    if (s.outcome === 'scored') t.scored += 1;
    else if (s.outcome === 'skipped-no-key') t.skippedNoKey += 1;
    else if (s.outcome === 'not-wired') t.notWired += 1;
    else if (s.outcome === 'extractor-error') t.extractorError += 1;
    else if (s.outcome === 'gate-failed') t.gateFailed += 1;
    else if (s.outcome === 'extractor-abstained') t.extractorAbstained += 1;
  }
  return t;
}

export function renderReport(run: BenchmarkRun): RenderedReport {
  const L: string[] = [];
  const scoredCases = run.scores.filter((s) => s.kind === 'scored');
  const abstentionOnly = run.scores.filter((s) => s.kind === 'abstention-only');
  const t = tally(run.scores);

  L.push('=================== Program-level extraction benchmark ===================');
  L.push(`Extractor: ${run.extractorLabel}`);
  L.push(`Ground truth: ${scoredCases.length} verified records scored, ${abstentionOnly.length} abstention-only (unverified, #45), ${run.partition.excluded.length} excluded.`);
  for (const e of run.partition.excluded) L.push(`  excluded: ${e.programId} -- ${e.reason}`);
  L.push(
    run.hasApiKey
      ? 'Mode: an API key is present in the environment.'
      : 'Mode: no ANTHROPIC_API_KEY -- cases needing the model report SKIPPED (not a fabricated result).',
  );
  L.push('');

  // Per-case line.
  L.push('--- Per case ---');
  for (const s of run.scores) {
    L.push(`  ${badge(s)}  ${s.programId.padEnd(34)} ${caseLine(s)}`);
  }
  L.push('');

  const measured = run.scores.some(
    (s) => s.outcome === 'scored' || s.outcome === 'extractor-abstained' || s.outcome === 'gate-failed',
  );

  if (!measured) {
    L.push('--- Result ---');
    if (t.skippedNoKey === run.scores.length) {
      L.push('SKIPPED: every case skipped for lack of ANTHROPIC_API_KEY. No numbers were measured.');
    } else if (t.notWired > 0) {
      L.push('NOT WIRED: no extraction pipeline is attached to the benchmark yet (#67 / #68 build those).');
      L.push('The harness ran end to end and scored nothing, by design.');
    } else {
      L.push('Nothing was scored (all cases errored or were skipped). No numbers were measured.');
    }
    return { text: L.join('\n'), blocking: false, blockingReasons: [], nothingMeasured: true };
  }

  // ---- Dimension 6: coverage and yield (reported first; it frames the rest) ----
  const coverage = run.scores.filter((s) => s.coverage).length;
  const scoredForYield = scoredCases.filter(
    (s) => s.outcome === 'scored' || s.outcome === 'extractor-abstained',
  );
  const withRule = scoredForYield.filter((s) => s.outcome === 'scored').length;
  const ruleRate = scoredForYield.length > 0 ? withRule / scoredForYield.length : 0;
  L.push('--- 1/6  Coverage and yield ---');
  L.push(`  ${coverage} / ${run.scores.length} programs produced usable output (a gate-valid record or an honest abstention).`);
  L.push(`  ${withRule} / ${scoredForYield.length} scored records came back with an actual rule (yield ${(ruleRate * 100).toFixed(0)}%).`);
  L.push(`  gate failures: ${t.gateFailed}   extractor errors: ${t.extractorError}   skipped (no key): ${t.skippedNoKey}`);
  L.push('  Yield is reported first: the harm counts below are only meaningful in proportion to it.');
  L.push('');

  // ---- Dimension 1: eligibility correctness ----
  const elig = scoredCases.filter((s) => s.outcome === 'scored' || s.outcome === 'extractor-abstained');
  const equivalent = elig.filter((s) => s.eligibility === 'equivalent').length;
  const divergent = elig.filter((s) => s.eligibility === 'divergent').length;
  const undecided = elig.filter((s) => s.eligibility === 'undecided').length;
  const candidateAbstained = elig.filter((s) => s.eligibility === 'candidate-abstained').length;
  L.push('--- 2/6  Eligibility correctness (semantic Criterion equivalence) ---');
  L.push(`  equivalent:        ${equivalent} / ${elig.length}`);
  L.push(`  divergent:         ${divergent}`);
  L.push(`  undecided:         ${undecided}   (canonical forms differ; the model check could not decide -- see docs)`);
  L.push(`  candidate abstained on the whole record: ${candidateAbstained}`);
  const methodCounts = new Map<string, number>();
  for (const s of elig) {
    if (s.equivalence) methodCounts.set(s.equivalence.method, (methodCounts.get(s.equivalence.method) ?? 0) + 1);
  }
  if (methodCounts.size) {
    L.push(`  how equivalence was judged: ${[...methodCounts].map(([m, n]) => `${m}=${n}`).join(', ')}`);
  }
  L.push('');

  // ---- Dimension 2: over-claim (the worse harm; its own block, never averaged) ----
  const overClaimCases = scoredCases.filter((s) => s.overClaim.length > 0);
  L.push('--- 3/6  OVER-CLAIM: told someone they qualify when they do not  (never averaged) ---');
  L.push(`  ${overClaimCases.length} / ${scoredCases.length} scored records carry at least one over-claim finding.`);
  for (const s of overClaimCases) {
    for (const f of s.overClaim) {
      L.push(`  [${s.programId}] (${f.source}) ${f.message}`);
      for (const w of f.witnesses ?? []) L.push(`      e.g. ${w.profile}  -> verified: ${w.verified}, candidate: eligible`);
    }
  }
  if (overClaimCases.length === 0) L.push('  none detected. (Not the same as "provably safe" -- see the limitations in docs.)');
  L.push('');

  // ---- Dimension 3: under-claim, the mirror (its own block, never averaged) ----
  const dangerousCases = scoredCases.filter((s) => s.dangerous.length > 0);
  L.push('--- 4/6  UNDER-CLAIM: ruled out someone who qualifies  (never averaged) ---');
  L.push(`  ${dangerousCases.length} / ${scoredCases.length} scored records carry at least one under-claim finding.`);
  for (const s of dangerousCases) {
    for (const f of s.dangerous) {
      L.push(`  [${s.programId}] (${f.source}) ${f.message}`);
      for (const w of f.witnesses ?? []) L.push(`      e.g. ${w.profile}  -> verified: ${w.verified}, candidate: ruled out`);
    }
  }
  if (dangerousCases.length === 0) L.push('  none detected. (Not the same as "provably safe" -- see the limitations in docs.)');
  L.push('');

  // ---- Dimension 3: correct abstention ----
  const withAbstention = scoredCases.filter((s) => s.abstention);
  const abst = {
    correct: withAbstention.filter((s) => s.abstention!.verdict === 'correct').length,
    partial: withAbstention.filter((s) => s.abstention!.verdict === 'partial').length,
    missing: withAbstention.filter((s) => s.abstention!.verdict === 'missing').length,
    spurious: withAbstention.filter((s) => s.abstention!.verdict === 'spurious').length,
    na: withAbstention.filter((s) => s.abstention!.verdict === 'not-applicable').length,
  };
  const abstentionExpected = withAbstention.filter((s) => s.abstention!.verifiedManualReviewCount > 0).length;
  L.push('--- 5/6  Correct abstention (manualReview where the verified record has one) ---');
  L.push(`  records where an abstention was expected: ${abstentionExpected}`);
  L.push(`  correct: ${abst.correct}   partial: ${abst.partial}   missing: ${abst.missing}`);
  L.push(`  spurious (abstained where a rule was decidable -- over-cautious, not dangerous): ${abst.spurious}`);
  L.push('');
  L.push(`  abstention-only cases (unverified ground truth, scored only here): ${abstentionOnly.length}`);
  for (const s of abstentionOnly) {
    L.push(`    ${s.programId}: ${s.abstention ? s.abstention.verdict : s.outcome}`);
  }
  L.push('');

  // ---- Dimension 4: descriptive accuracy ----
  L.push('--- 6/6  Descriptive accuracy (lower stakes; #14) ---');
  const fields = ['name', 'administeredBy', 'howToApply.phone', 'howToApply.url', 'summary', 'benefit', 'requiredDocuments'];
  for (const field of fields) {
    const results = scoredCases.flatMap((s) => s.descriptive.filter((d) => d.field === field));
    const c = {
      match: results.filter((r) => r.verdict === 'match').length,
      near: results.filter((r) => r.verdict === 'near').length,
      miss: results.filter((r) => r.verdict === 'miss').length,
      notScored: results.filter((r) => r.verdict === 'not-scored').length,
    };
    L.push(`  ${field.padEnd(20)} match ${c.match}  near ${c.near}  miss ${c.miss}  not-scored ${c.notScored}`);
  }
  L.push('');

  // ---- Summary line ----
  L.push('--- Result ---');
  const blockingReasons: string[] = [];
  if (run.hasApiKey) {
    if (overClaimCases.length > 0) {
      blockingReasons.push(
        `${overClaimCases.length} scored record(s) OVER-CLAIM: they tell someone they qualify when the verified ` +
          'record does not. The worse of the two harms -- a wasted trip, and the trust that pays for every later ' +
          'suggestion. Fix or abstain.',
      );
    }
    if (dangerousCases.length > 0) {
      blockingReasons.push(
        `${dangerousCases.length} scored record(s) UNDER-CLAIM: they rule out someone the verified record accepts. ` +
          'Help the person never hears about. Fix or widen.',
      );
    }
    if (scoredForYield.length > 0 && ruleRate < MIN_USABLE_RULE_RATE) {
      blockingReasons.push(
        `DEGENERATE YIELD: only ${withRule} / ${scoredForYield.length} scored records (${(ruleRate * 100).toFixed(0)}%) ` +
          `produced a rule, below the ${(MIN_USABLE_RULE_RATE * 100).toFixed(0)}% floor. A run that abstains its way to ` +
          'zero harms has not been measured -- it has declined to answer. Do not lower the floor to make this pass.',
      );
    }
  }
  const blocking = blockingReasons.length > 0;
  if (blocking) {
    L.push('BLOCKING:');
    for (const r of blockingReasons) L.push(`  - ${r}`);
    L.push('These are blocking results, not percentages.');
  } else {
    L.push('Measured. Report the six dimensions separately; do not blend them.');
    L.push('Read over-claim and under-claim as a pair, and both in proportion to yield.');
  }
  return { text: L.join('\n'), blocking, blockingReasons, nothingMeasured: false };
}

function badge(s: CaseScore): string {
  switch (s.outcome) {
    case 'scored':
      if (s.overClaim.length > 0) return 'OVER   ';
      if (s.dangerous.length > 0) return 'UNDER  ';
      if (s.kind === 'abstention-only') return s.abstention?.verdict === 'correct' ? 'ABST-OK' : 'ABST-? ';
      return s.eligibility === 'equivalent' ? 'OK     ' : s.eligibility === 'undecided' ? 'UNDEC  ' : 'DIVERGE';
    case 'skipped-no-key':
      return 'SKIP   ';
    case 'not-wired':
      return 'NOWIRE ';
    case 'extractor-error':
      return 'ERROR  ';
    case 'gate-failed':
      return 'GATE   ';
    case 'extractor-abstained':
      return 'ABSTAIN';
  }
}

function caseLine(s: CaseScore): string {
  switch (s.outcome) {
    case 'scored': {
      const bits = [`eligibility=${s.eligibility}`];
      if (s.abstention && s.abstention.verdict !== 'not-applicable') bits.push(`abstention=${s.abstention.verdict}`);
      if (s.overClaim.length) bits.push(`over-claim=${s.overClaim.length}`);
      if (s.dangerous.length) bits.push(`under-claim=${s.dangerous.length}`);
      return bits.join('  ');
    }
    case 'extractor-abstained':
      return `whole-record abstention: ${truncate(s.outcomeDetail ?? '')}`;
    case 'gate-failed':
      return `schema gate: ${truncate(s.outcomeDetail ?? '')}`;
    case 'extractor-error':
      return `error: ${truncate(s.outcomeDetail ?? '')}`;
    case 'skipped-no-key':
      return '(no ANTHROPIC_API_KEY)';
    case 'not-wired':
      return '(no pipeline wired -- #67 / #68)';
  }
}

function truncate(s: string, n = 80): string {
  return s.length > n ? `${s.slice(0, n)}...` : s;
}
