import type { CaseScore } from './score.ts';
import type { BenchmarkRun } from './run.ts';

/**
 * Rendering a benchmark run. The five dimensions are reported in five separate
 * blocks and NEVER combined into one score (docs/program-benchmark.md). The
 * dangerous-wrongness count is called out on its own and, on a live run, a
 * single dangerous finding is BLOCKING -- the same contract as
 * scripts/llm-extraction/run-eval.ts.
 *
 * SKIPPED is reported honestly: when every case is `skipped-no-key`, the
 * summary says "No numbers were measured" and nothing is presented as a result.
 */

export interface RenderedReport {
  readonly text: string;
  /** True when a live run produced at least one dangerous finding. */
  readonly blocking: boolean;
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
    return { text: L.join('\n'), blocking: false, nothingMeasured: true };
  }

  // ---- Dimension 5: coverage (reported first; it frames the rest) ----
  const coverage = run.scores.filter((s) => s.coverage).length;
  L.push('--- 1/5  Coverage ---');
  L.push(`  ${coverage} / ${run.scores.length} programs produced usable output (a gate-valid record or an honest abstention).`);
  L.push(`  gate failures: ${t.gateFailed}   extractor errors: ${t.extractorError}   skipped (no key): ${t.skippedNoKey}`);
  L.push('');

  // ---- Dimension 1: eligibility correctness ----
  const elig = scoredCases.filter((s) => s.outcome === 'scored' || s.outcome === 'extractor-abstained');
  const equivalent = elig.filter((s) => s.eligibility === 'equivalent').length;
  const divergent = elig.filter((s) => s.eligibility === 'divergent').length;
  const undecided = elig.filter((s) => s.eligibility === 'undecided').length;
  const candidateAbstained = elig.filter((s) => s.eligibility === 'candidate-abstained').length;
  L.push('--- 2/5  Eligibility correctness (semantic Criterion equivalence) ---');
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

  // ---- Dimension 2: dangerous wrongness (its own block, never averaged) ----
  const dangerousCases = scoredCases.filter((s) => s.dangerous.length > 0);
  L.push('--- 3/5  DANGEROUS WRONGNESS  (never averaged into anything) ---');
  L.push(`  ${dangerousCases.length} / ${scoredCases.length} scored records carry at least one dangerous finding.`);
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
  L.push('--- 4/5  Correct abstention (manualReview where the verified record has one) ---');
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
  L.push('--- 5/5  Descriptive accuracy (lower stakes; #14) ---');
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
  const blocking = run.hasApiKey && dangerousCases.length > 0;
  if (blocking) {
    L.push(`BLOCKING: ${dangerousCases.length} scored record(s) carry a dangerous finding on a live run.`);
    L.push('A dangerous finding is a blocking result, not a percentage. Fix or abstain.');
  } else {
    L.push('Measured. Report the five dimensions separately; do not blend them.');
  }
  return { text: L.join('\n'), blocking, nothingMeasured: false };
}

function badge(s: CaseScore): string {
  switch (s.outcome) {
    case 'scored':
      if (s.dangerous.length > 0) return 'DANGER ';
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
      if (s.dangerous.length) bits.push(`dangerous=${s.dangerous.length}`);
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
