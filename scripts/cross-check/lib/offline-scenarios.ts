/**
 * End-to-end offline scenarios for the #84 cross-check pipeline. Each is a
 * fixture-backed case with a `verify` that returns failure strings (empty ===
 * pass). Shared verbatim between the Node test suite
 * (lib/__tests__/scenarios.test.ts) and the CLI --self-test, so "both paths are
 * proven before a token is spent" is the SAME code path in both.
 *
 * NO network. NO model. The deterministic side is the real parser run against
 * committed Tier-3 fixtures; the agentic side and the exclusion probe are
 * scripted. This proves the plumbing -- the referee, the both-directions
 * dangerous check, the fall-through to Path B, and the mechanical span check --
 * not model behaviour.
 *
 * The four scenarios #84 requires, explicitly:
 *   1. an agreeing pair                          -> high confidence
 *   2. a pair diverging in the dangerous direction -> route to human (high)
 *   3. a parser abstention falling through to Path B
 *   4. Path B naming an excluded person (span verified) -> route to human
 */
import { incomeAtOrBelow, allOf, atLeast, atMost, livesIn } from '../../../src/domain/criteria.ts';
import { MissingApiKeyError } from '../../program-benchmark/lib/extractor.ts';
import { corpusFor, runDeterministic, fixtureSourceText, type CorpusEntry } from './corpus.ts';
import type { MethodOutcome } from './methods.ts';
import { crossCheck, type RouteDecision } from './route.ts';
import { liveExclusionProbe } from './live-probe.ts';
import type { ProbeAnswer, ProbeAsker, ProbeQuestion } from './exclusion-probe.ts';

export interface OfflineScenario {
  readonly name: string;
  run(): Promise<{ decision?: RouteDecision; failures: string[] }>;
}

function entry(programId: string): CorpusEntry {
  const e = corpusFor(programId);
  if (!e) throw new Error(`offline-scenarios: no corpus entry for ${programId}`);
  return e;
}

/** A probe asker that records that it was consulted. */
function spyAsker(answer: ProbeAnswer): ProbeAsker & { calls: ProbeQuestion[] } {
  const calls: ProbeQuestion[] = [];
  const fn = (async (q: ProbeQuestion) => {
    calls.push(q);
    return answer;
  }) as ProbeAsker & { calls: ProbeQuestion[] };
  fn.calls = calls;
  return fn;
}

const wheapEntry = () => entry('wheap-energy-assistance');
const foodshareEntry = () => entry('foodshare-snap-wi');

/** 1. Two methods produce the same rule -> high confidence. */
const agreeing: OfflineScenario = {
  name: 'agreeing pair: deterministic parser and (scripted) agentic emit the same rule -> high confidence',
  async run() {
    const deterministic = runDeterministic(wheapEntry()).outcome;
    const failures: string[] = [];
    if (deterministic.decision !== 'extract') {
      failures.push(`expected the parser to extract from the WHEAP fixture, got ${deterministic.decision}`);
      return { failures };
    }
    // The agentic method lands on the identical income rule.
    const agentic: MethodOutcome = { decision: 'extract', criterion: incomeAtOrBelow('wi-smi', 100) };
    const decision = await crossCheck({ deterministic, agentic });
    if (decision.route !== 'high-confidence') failures.push(`expected high-confidence, got ${decision.route}`);
    if (decision.basis !== 'methods-agree') failures.push(`expected basis methods-agree, got ${decision.basis}`);
    if (decision.agreement.verdict !== 'equivalent') failures.push(`expected referee verdict equivalent, got ${decision.agreement.verdict}`);
    return { decision, failures };
  },
};

/** 2. The two methods diverge and one is narrower -> route to human, high priority. */
const divergingDangerous: OfflineScenario = {
  name: 'diverging pair (agentic rule narrower): the dangerous direction routes to human/high',
  async run() {
    const deterministic = runDeterministic(wheapEntry()).outcome; // incomeAtOrBelow(wi-smi, 100)
    const failures: string[] = [];
    if (deterministic.decision !== 'extract') {
      failures.push('parser did not extract from the WHEAP fixture');
      return { failures };
    }
    // The classic wheap-smi near-miss: 60% double-applies the percentage and
    // excludes households between 60% and 100% of SMI.
    const agentic: MethodOutcome = { decision: 'extract', criterion: incomeAtOrBelow('wi-smi', 60) };
    const decision = await crossCheck({ deterministic, agentic });
    if (decision.route !== 'human' || decision.priority !== 'high') {
      failures.push(`expected human/high, got ${decision.route}/${decision.priority}`);
    }
    if (decision.basis !== 'methods-diverge-dangerous') failures.push(`expected basis methods-diverge-dangerous, got ${decision.basis}`);
    if (!decision.agreement.agenticNarrower) failures.push('expected the referee to flag the agentic rule as the narrower one');

    // The other way round: the SAME divergence is caught when the narrower rule
    // is the deterministic one (issue #84: "either way").
    const flipped = await crossCheck({
      deterministic: { decision: 'extract', criterion: incomeAtOrBelow('wi-smi', 60) },
      agentic: { decision: 'extract', criterion: incomeAtOrBelow('wi-smi', 100) },
    });
    if (flipped.basis !== 'methods-diverge-dangerous') failures.push(`flipped: expected methods-diverge-dangerous, got ${flipped.basis}`);
    if (!flipped.agreement.deterministicNarrower) failures.push('flipped: expected the deterministic rule flagged as narrower');
    return { decision, failures };
  },
};

/** 3. The parser abstains -> Path A cannot fire -> the exclusion probe is consulted. */
const abstainFallsToProbe: OfflineScenario = {
  name: 'parser abstention: Path A has nothing to compare, so Path B (the exclusion probe) is consulted',
  async run() {
    const e = foodshareEntry();
    const deterministic = runDeterministic(e).outcome;
    const failures: string[] = [];
    if (deterministic.decision !== 'abstain') failures.push(`expected the parser to abstain on the FoodShare landing page, got ${deterministic.decision}`);

    const agentic: MethodOutcome = { decision: 'extract', criterion: allOf(livesIn.wisconsin, incomeAtOrBelow('fpl', 200)) };
    const ask = spyAsker({ excludedPerson: null, quotedSpan: null });
    const decision = await crossCheck({
      deterministic,
      agentic,
      probe: { ask, question: { sourceName: 'Wisconsin DHS — FoodShare', sourceText: fixtureSourceText(e) } },
    });
    if (ask.calls.length !== 1) failures.push(`expected the probe to be consulted exactly once, got ${ask.calls.length}`);
    if (ask.calls[0] && ask.calls[0].rule !== agentic.criterion) failures.push('probe was not handed the agentic rule');
    if (decision.basis !== 'probe-clear') failures.push(`expected basis probe-clear, got ${decision.basis}`);
    if (decision.route !== 'high-confidence') failures.push(`expected high-confidence after a clear probe, got ${decision.route}`);
    return { decision, failures };
  },
};

/** 4. The probe names a concrete excluded person and its span checks out -> human. */
const probeNamesExcluded: OfflineScenario = {
  name: 'exclusion probe names someone the source calls eligible, span verified -> route to human/high',
  async run() {
    const e = foodshareEntry();
    const deterministic = runDeterministic(e).outcome;
    const sourceText = fixtureSourceText(e);
    const failures: string[] = [];

    // A retired person on a fixed income: the FoodShare page lists them as someone
    // it helps, but a bare 200% FPL income rule can still rule them out.
    const answer: ProbeAnswer = {
      excludedPerson: 'A retired Wisconsin resident living on a small fixed income above 200% FPL',
      quotedSpan: 'Live on a small or fixed income.',
      rationale: 'The page lists fixed-income retirees among those it helps; the income ceiling can still exclude them.',
    };
    const ask = spyAsker(answer);
    const agentic: MethodOutcome = { decision: 'extract', criterion: allOf(livesIn.wisconsin, incomeAtOrBelow('fpl', 200)) };
    const decision = await crossCheck({
      deterministic,
      agentic,
      probe: { ask, question: { sourceName: 'Wisconsin DHS — FoodShare', sourceText } },
    });
    if (decision.route !== 'human' || decision.priority !== 'high') {
      failures.push(`expected human/high, got ${decision.route}/${decision.priority}`);
    }
    if (decision.basis !== 'probe-named-excluded') failures.push(`expected basis probe-named-excluded, got ${decision.basis}`);
    if (!decision.probe?.spanVerified) failures.push('expected the probe span to verify against the FoodShare fixture');
    return { decision, failures };
  },
};

/** 5. The probe names someone but its span is fabricated -> weak signal, human/low. */
const probeSpanFabricated: OfflineScenario = {
  name: 'exclusion probe names someone but quotes a span not in the source -> discarded, human/low',
  async run() {
    const e = foodshareEntry();
    const deterministic = runDeterministic(e).outcome;
    const failures: string[] = [];
    const ask = spyAsker({
      excludedPerson: 'Someone earning 400% of the poverty level',
      quotedSpan: 'anyone earning up to 400% of the federal poverty level is welcome to apply',
    });
    const agentic: MethodOutcome = { decision: 'extract', criterion: allOf(livesIn.wisconsin, incomeAtOrBelow('fpl', 200)) };
    const decision = await crossCheck({
      deterministic,
      agentic,
      probe: { ask, question: { sourceName: 'Wisconsin DHS — FoodShare', sourceText: fixtureSourceText(e) } },
    });
    if (decision.basis !== 'probe-weak-signal') failures.push(`expected basis probe-weak-signal, got ${decision.basis}`);
    if (decision.route !== 'human' || decision.priority !== 'low') failures.push(`expected human/low, got ${decision.route}/${decision.priority}`);
    if (decision.probe?.spanVerified) failures.push('a fabricated span must not verify');
    return { decision, failures };
  },
};

/** 6. Both methods abstain -> corroborated abstention, high confidence. */
const bothAbstain: OfflineScenario = {
  name: 'both methods abstain: the abstention is corroborated -> high confidence',
  async run() {
    const deterministic = runDeterministic(foodshareEntry()).outcome;
    const agentic: MethodOutcome = { decision: 'abstain', reason: 'no eligibility rule is published on this page' };
    const decision = await crossCheck({ deterministic, agentic });
    const failures: string[] = [];
    if (decision.basis !== 'methods-agree-abstain') failures.push(`expected basis methods-agree-abstain, got ${decision.basis}`);
    if (decision.route !== 'high-confidence') failures.push(`expected high-confidence, got ${decision.route}`);
    return { decision, failures };
  },
};

/** 7. Referee cannot decide (un-modellable leaf) -> human/low, not silently trusted. */
const undecided: OfflineScenario = {
  name: 'referee undecided (two bounds on one fact): not provably safe -> human/low',
  async run() {
    const decision = await crossCheck({
      deterministic: { decision: 'extract', criterion: allOf(livesIn.wisconsin, atLeast('householdSize', 2)) },
      agentic: { decision: 'extract', criterion: allOf(livesIn.wisconsin, atMost('householdSize', 5)) },
    });
    const failures: string[] = [];
    if (decision.agreement.verdict !== 'undecided') failures.push(`expected referee verdict undecided, got ${decision.agreement.verdict}`);
    if (decision.basis !== 'methods-undecided') failures.push(`expected basis methods-undecided, got ${decision.basis}`);
    if (decision.route !== 'human' || decision.priority !== 'low') failures.push(`expected human/low, got ${decision.route}/${decision.priority}`);
    return { decision, failures };
  },
};

/** 8. Path B with no cross-check available and no probe -> never auto-trusted. */
const noProbeAvailable: OfflineScenario = {
  name: 'parser abstains, agentic emits a rule, no probe available -> human/low (probe-skipped), never trusted',
  async run() {
    const deterministic = runDeterministic(foodshareEntry()).outcome;
    const agentic: MethodOutcome = { decision: 'extract', criterion: incomeAtOrBelow('fpl', 200) };
    const decision = await crossCheck({ deterministic, agentic });
    const failures: string[] = [];
    if (decision.basis !== 'probe-skipped') failures.push(`expected basis probe-skipped, got ${decision.basis}`);
    if (decision.route !== 'human') failures.push(`expected human, got ${decision.route}`);
    return { decision, failures };
  },
};

/** 9. The live probe asker with no key throws MissingApiKeyError (SKIPPED wiring). */
const liveProbeNoKey: OfflineScenario = {
  name: 'live exclusion probe with no ANTHROPIC_API_KEY throws MissingApiKeyError (SKIPPED, not fabricated)',
  async run() {
    const ask = liveExclusionProbe();
    const failures: string[] = [];
    try {
      await ask({ sourceName: 'x', sourceText: 'y', rule: incomeAtOrBelow('fpl', 100) });
      failures.push('expected MissingApiKeyError, got a result');
    } catch (err) {
      if (!(err instanceof MissingApiKeyError)) failures.push(`expected MissingApiKeyError, got ${String(err)}`);
    }
    return { failures };
  },
};

export const OFFLINE_SCENARIOS: readonly OfflineScenario[] = [
  agreeing,
  divergingDangerous,
  abstainFallsToProbe,
  probeNamesExcluded,
  probeSpanFabricated,
  bothAbstain,
  undecided,
  noProbeAvailable,
  liveProbeNoKey,
];
