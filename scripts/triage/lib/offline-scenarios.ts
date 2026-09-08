/**
 * End-to-end offline scenarios for triage (issue #68). Each is a fixture-backed
 * case with a `run` that returns failure strings (empty === pass). Shared
 * verbatim between the Node test suite (lib/__tests__/scenarios.test.ts) and the
 * CLI --self-test, so "all three routes are proven before a token is spent" is
 * the SAME code path in both.
 *
 * NO network. NO model. The deterministic side is the real Tier-3 parser run
 * against committed fixtures (real captures for the mapped records, reconstructed
 * Tier-4 fixtures for the community-org records -- see
 * lib/__tests__/fixtures/SOURCES.md). The optional live classifier is scripted.
 *
 * The routes #68 requires, explicitly:
 *   1. deterministic     -- parser produced a scoped rule
 *   2. agentic (present) -- parser found an eligibility figure it could not scope
 *   3. agentic (mixed)   -- parser found nothing, but the source states a condition
 *   4. no-rule-published -- the source declines to state a rule
 *   5. the degenerate-outcome guard fires when no-rule-published swallows the corpus
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import {
  TIER3_SOURCES,
  TIER3_HELDOUT,
  TIER3_HELDOUT2,
  extractFromHtml,
  extractFromEcfr,
  type Tier3Source,
} from '../../tier3-extract/index.mjs';
import { normalize } from '../../check-sources/lib/normalize.ts';
import { MissingApiKeyError } from '../../program-benchmark/lib/extractor.ts';
import { triage, type ParserOutcome, type TriageDecision } from './route.ts';
import { summariseRouting, type PerCaseRow } from './report.ts';
import { liveSourceClassifier } from './classify-source.ts';
import { parserOutcomeFor, sourceTextFor } from './corpus.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_ROOT = path.join(__dirname, '..', '..', '..', 'tests', 'fixtures');
const SPLIT_DIR: Record<string, string> = {
  tuning: path.join(FIXTURE_ROOT, 'tier3'),
  heldout: path.join(FIXTURE_ROOT, 'tier3-heldout'),
  heldout2: path.join(FIXTURE_ROOT, 'tier3-heldout2'),
};
const SPLITS: Record<string, readonly Tier3Source[]> = {
  tuning: TIER3_SOURCES,
  heldout: TIER3_HELDOUT,
  heldout2: TIER3_HELDOUT2,
};

/** Run the real Tier-3 parser against a committed fixture, by source id. */
function runTier3(id: string): { parser: ParserOutcome; sourceText: string } {
  for (const [split, sources] of Object.entries(SPLITS)) {
    const src = sources.find((s) => s.id === id);
    if (!src) continue;
    const text = readFileSync(path.join(SPLIT_DIR[split]!, src.file), 'utf8');
    const raw = src.kind === 'ecfr' ? extractFromEcfr(text, src) : extractFromHtml(text, src);
    return {
      parser: { decision: raw.decision, code: raw.code, reason: raw.reason },
      sourceText: src.kind === 'ecfr' ? text.replace(/<[^>]+>/g, ' ') : normalize(text),
    };
  }
  throw new Error(`offline-scenarios: no Tier-3 source with id "${id}"`);
}

export interface OfflineScenario {
  readonly name: string;
  run(): Promise<{ decision?: TriageDecision; failures: string[] }>;
}

const deterministicRoute: OfflineScenario = {
  name: 'deterministic: the parser extracts a scoped rule from the WHEAP fixture -> route deterministic',
  async run() {
    const { parser, sourceText } = runTier3('energy-assistance');
    const failures: string[] = [];
    if (parser.decision !== 'extract') failures.push(`expected the parser to extract, got ${parser.decision} (${parser.code})`);
    const d = triage({ parser, sourceText });
    if (d.route !== 'deterministic') failures.push(`expected route deterministic, got ${d.route}`);
    return { decision: d, failures };
  },
};

const agenticFromPresentCode: OfflineScenario = {
  name: 'agentic (rule present): the parser finds a cost-sharing tier it cannot scope (SeniorCare) -> route agentic, not uncertain',
  async run() {
    const { parser, sourceText } = runTier3('seniorcare-fpl');
    const failures: string[] = [];
    if (parser.decision !== 'abstain') failures.push(`expected the parser to abstain on SeniorCare, got ${parser.decision}`);
    const d = triage({ parser, sourceText });
    if (d.route !== 'agentic') failures.push(`expected route agentic, got ${d.route}`);
    if (d.uncertain) failures.push('a rule the parser explicitly located should not be "uncertain"');
    return { decision: d, failures };
  },
};

const agenticFromMixedEvidence: OfflineScenario = {
  name: 'agentic (mixed): the FoodShare landing page states "low-income" but the parser finds no figure -> route agentic, uncertain',
  async run() {
    const { parser, sourceText } = runTier3('foodshare-index');
    const failures: string[] = [];
    if (parser.decision !== 'abstain') failures.push(`expected the parser to abstain on the FoodShare landing page, got ${parser.decision}`);
    const d = triage({ parser, sourceText });
    if (d.route !== 'agentic') failures.push(`expected route agentic, got ${d.route}`);
    if (!d.uncertain) failures.push('a landing page with only a "low-income" signal should be marked uncertain->extract');
    return { decision: d, failures };
  },
};

const noRulePublished: OfflineScenario = {
  name: 'no-rule-published: the Tenant Resource Center screening page declines to state a rule -> route no-rule-published',
  async run() {
    const parser = parserOutcomeFor('dane-eviction-prevention');
    const sourceText = sourceTextFor('dane-eviction-prevention');
    const failures: string[] = [];
    if (!sourceText) failures.push('reconstructed TRC fixture did not load');
    const d = triage({ parser, sourceText });
    if (d.route !== 'no-rule-published') failures.push(`expected route no-rule-published, got ${d.route} (${d.reason})`);
    if (d.evidence.length === 0) failures.push('a no-rule-published decision must quote its evidence');
    return { decision: d, failures };
  },
};

const noRuleRescuedByClassifier: OfflineScenario = {
  name: 'no-rule-published is vetoed when a live classifier reads a rule in the same page -> route agentic (rescued)',
  async run() {
    const parser = parserOutcomeFor('dane-eviction-prevention');
    const sourceText = sourceTextFor('dane-eviction-prevention');
    const d = triage({
      parser,
      sourceText,
      classification: { statesEligibilityRule: true, confidenceScore: 55, evidenceQuote: 'Income limits ... are not published here' },
    });
    const failures: string[] = [];
    if (d.route !== 'agentic') failures.push(`expected the classifier to rescue this to agentic, got ${d.route}`);
    if (!d.uncertain) failures.push('a classifier-rescued source should be marked uncertain');
    if (!d.classifierNote) failures.push('the classifier consultation should be noted');
    return { decision: d, failures };
  },
};

const classifierCannotPushToNoRule: OfflineScenario = {
  name: 'a live classifier saying "no rule" cannot move a source with a RULE-PRESENT signal off the agentic route',
  async run() {
    const { parser, sourceText } = runTier3('foodshare-index');
    const d = triage({
      parser,
      sourceText,
      classification: { statesEligibilityRule: false, confidenceScore: 90, evidenceQuote: 'We help people of all ages' },
    });
    const failures: string[] = [];
    if (d.route !== 'agentic') {
      failures.push(`the classifier must not be able to force no-rule-published here; got ${d.route}`);
    }
    return { decision: d, failures };
  },
};

const vocabularyGap: OfflineScenario = {
  name: 'vocabulary gap: MAPP is gated on a reserved fact (hasDisability) -> route agentic, vocabularyGap names the fact',
  async run() {
    const { parser, sourceText } = runTier3('ho-mapp');
    const failures: string[] = [];
    const d = triage({ parser, sourceText });
    if (d.route !== 'agentic') failures.push(`expected route agentic, got ${d.route}`);
    if (!d.vocabularyGap.some((g) => g.fact === 'hasDisability')) {
      failures.push(`expected a hasDisability vocabulary gap, got [${d.vocabularyGap.map((g) => g.fact).join(', ')}]`);
    }
    return { decision: d, failures };
  },
};

const ageIsNotAVocabularyGap: OfflineScenario = {
  name: 'age is an askable band now (#89): a source gated only on age is not flagged as a vocabulary gap',
  async run() {
    const parser: ParserOutcome = {
      decision: 'abstain',
      code: 'UNDECIDABLE_COCONDITION',
      reason: '250% of fpl is gated by an age band (40-64) -- ages 40 to 64',
    };
    const d = triage({ parser, sourceText: 'Meet income requirements (at or below 250% of the federal poverty level). Must be ages 40 to 64.' });
    const failures: string[] = [];
    if (d.route !== 'agentic') failures.push(`expected route agentic, got ${d.route}`);
    if (d.vocabularyGap.length > 0) failures.push(`age must not be a vocabulary gap, got [${d.vocabularyGap.map((g) => g.fact).join(', ')}]`);
    return { decision: d, failures };
  },
};

const degenerateGuardFires: OfflineScenario = {
  name: 'degenerate-outcome guard: a router that sends everything to no-rule-published is flagged',
  async run() {
    const rows: PerCaseRow[] = Array.from({ length: 8 }, (_, i) => ({
      programId: `p${i}`,
      tier: 'reconstructed',
      decision: {
        route: 'no-rule-published',
        reason: 'x',
        evidence: [],
        parser: { decision: 'abstain', code: 'NO_RULE_STATED', reason: 'x' },
        signals: { rulePresent: [], noRule: [] },
        vocabularyGap: [],
        uncertain: false,
      },
    }));
    const summary = summariseRouting(rows);
    const failures: string[] = [];
    if (!summary.noRuleDegenerate) failures.push('expected noRuleDegenerate to be true');
    if (!summary.singleRouteDegenerate) failures.push('expected singleRouteDegenerate to be true');
    return { failures };
  },
};

const realCorpusIsNotDegenerate: OfflineScenario = {
  name: 'the real offline corpus populates all three routes and no-rule-published stays a minority (not degenerate)',
  async run() {
    const rows: PerCaseRow[] = [];
    // Deferred require to avoid a cycle at module load.
    for (const id of OFFLINE_MEASURABLE_IDS) {
      rows.push({ programId: id, tier: 'x', decision: triage({ parser: parserOutcomeFor(id), sourceText: sourceTextFor(id) }) });
    }
    const summary = summariseRouting(rows);
    const failures: string[] = [];
    if (summary.byRoute.deterministic === 0) failures.push('expected some deterministic routes');
    if (summary.byRoute.agentic === 0) failures.push('expected some agentic routes');
    if (summary.byRoute['no-rule-published'] === 0) failures.push('expected some no-rule-published routes');
    if (summary.noRuleDegenerate) failures.push('the real corpus must not trip the degenerate guard');
    return { failures };
  },
};

const liveClassifierNoKey: OfflineScenario = {
  name: 'the live source classifier with no ANTHROPIC_API_KEY throws MissingApiKeyError (SKIPPED, not fabricated)',
  async run() {
    const failures: string[] = [];
    const classifier = liveSourceClassifier();
    try {
      await classifier({ sourceName: 'x', sourceText: 'y' });
      failures.push('expected MissingApiKeyError, got a result');
    } catch (err) {
      if (!(err instanceof MissingApiKeyError)) failures.push(`expected MissingApiKeyError, got ${String(err)}`);
    }
    return { failures };
  },
};

/** Program ids that have an offline source (mapped or reconstructed). */
export const OFFLINE_MEASURABLE_IDS: readonly string[] = [
  'wheap-energy-assistance',
  'wheap-crisis-assistance',
  'wisconsin-shares-child-care',
  'wic-wisconsin',
  'school-meals-wi',
  'lifeline-phone-internet',
  'badgercare-plus',
  'foodshare-snap-wi',
  'sun-bucks-wi',
  'wisconsin-weatherization',
  'dane-eviction-prevention',
  'dane-joining-forces-for-families',
  'wi-211',
  'second-harvest-southern-wi',
];

export const OFFLINE_SCENARIOS: readonly OfflineScenario[] = [
  deterministicRoute,
  agenticFromPresentCode,
  agenticFromMixedEvidence,
  noRulePublished,
  noRuleRescuedByClassifier,
  classifierCannotPushToNoRule,
  vocabularyGap,
  ageIsNotAVocabularyGap,
  degenerateGuardFires,
  realCorpusIsNotDegenerate,
  liveClassifierNoKey,
];
