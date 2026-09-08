/**
 * Routing-distribution reporting for triage (issue #68).
 *
 * The load-bearing output is the DISTRIBUTION across the three routes, printed
 * plainly the way scripts/cross-check prints its agreement rate. #63 reached 0
 * dangerous over-claims by routing 27/27 to `manualReview`; a triage layer that
 * sends everything to `no-rule-published` is that failure in new clothing. The
 * degenerate-outcome guard makes that visible instead of letting it hide inside
 * a good-looking safety number.
 */
import type { TriageDecision, TriageRoute } from './route.ts';

export interface PerCaseRow {
  readonly programId: string;
  readonly tier: string;
  readonly decision: TriageDecision;
}

const ALL_ROUTES: readonly TriageRoute[] = ['deterministic', 'agentic', 'no-rule-published'];

export interface RoutingSummary {
  readonly total: number;
  readonly byRoute: Record<TriageRoute, number>;
  /** Decisions where the evidence was mixed and we chose extraction anyway. */
  readonly uncertain: number;
  /** Sources routed to `agentic` that also need a fact we do not ask. */
  readonly vocabularyGaps: number;
  /**
   * True when `no-rule-published` swallowed more than half the corpus -- the
   * #63-in-new-clothing smell. The surveyed corpus is ~24% Tier 4
   * (docs/eligibility-extraction.md Section 2), so anything near or above 50%
   * means the router is dropping sources that publish a rule.
   */
  readonly noRuleDegenerate: boolean;
  /** True when any single route swallowed the whole corpus. */
  readonly singleRouteDegenerate: boolean;
}

export function summariseRouting(rows: readonly PerCaseRow[]): RoutingSummary {
  const byRoute = Object.fromEntries(ALL_ROUTES.map((r) => [r, 0])) as Record<TriageRoute, number>;
  let uncertain = 0;
  let vocabularyGaps = 0;
  for (const { decision } of rows) {
    byRoute[decision.route] += 1;
    if (decision.uncertain) uncertain += 1;
    if (decision.route === 'agentic' && decision.vocabularyGap.length > 0) vocabularyGaps += 1;
  }
  const total = rows.length;
  return {
    total,
    byRoute,
    uncertain,
    vocabularyGaps,
    noRuleDegenerate: total >= 5 && byRoute['no-rule-published'] / total > 0.5,
    singleRouteDegenerate: total >= 5 && ALL_ROUTES.some((r) => byRoute[r] === total),
  };
}

const BADGE: Record<TriageRoute, string> = {
  deterministic: 'DETERMIN ',
  agentic: 'AGENTIC  ',
  'no-rule-published': 'NO-RULE  ',
};

export function renderRouting(rows: readonly PerCaseRow[]): { text: string; summary: RoutingSummary } {
  const summary = summariseRouting(rows);
  const L: string[] = [];

  L.push('--- Per record ---');
  for (const r of rows) {
    const d = r.decision;
    const flags = [
      d.uncertain ? 'uncertain->extract' : '',
      d.vocabularyGap.length ? `vocab-gap:${d.vocabularyGap.map((g) => g.fact).join('+')}` : '',
      d.classifierNote ? 'classifier-consulted' : '',
    ].filter(Boolean).join(' ');
    L.push(`  ${BADGE[d.route]} ${r.programId.padEnd(32)} [${r.tier}]${flags ? '  ' + flags : ''}`);
  }
  L.push('');

  L.push('--- Routing distribution ---');
  for (const route of ALL_ROUTES) {
    L.push(`  ${route.padEnd(20)} ${summary.byRoute[route]} / ${summary.total}`);
  }
  L.push(`  (of which mixed-evidence, routed to extraction deliberately: ${summary.uncertain})`);
  if (summary.vocabularyGaps > 0) {
    L.push(`  (of the agentic route, ${summary.vocabularyGaps} also need a fact the interview does not ask -- candidate questions, see docs/data-authoring.md)`);
  }
  L.push('');

  if (summary.noRuleDegenerate || summary.singleRouteDegenerate) {
    L.push('!!! DEGENERATE-OUTCOME WARNING !!!');
    if (summary.noRuleDegenerate) {
      L.push('  More than half the corpus routed to no-rule-published. The surveyed corpus is ~24% Tier 4');
      L.push('  (docs/eligibility-extraction.md Section 2), so this means the router is dropping sources that');
      L.push('  publish a rule -- #63 (27/27 to manualReview) in new clothing. A 0-dangerous number here is');
      L.push('  meaningless.');
    }
    if (summary.singleRouteDegenerate) {
      L.push('  One route swallowed the entire corpus. Triage is not discriminating.');
    }
    L.push('');
  } else {
    L.push('  No degenerate outcome: all three routes are populated and no-rule-published is a minority.');
    L.push('');
  }

  return { text: L.join('\n'), summary };
}
