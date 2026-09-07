/**
 * Rendering for the #84 cross-check. The load-bearing line is the AGREEMENT
 * RATE: if Path A routes nearly everything to a human because the two methods
 * rarely agree, the design has reduced to classify-first and a 0-dangerous count
 * would be meaningless. That number is printed plainly, not buried.
 */
import type { RouteDecision, RoutingSummary } from './route.ts';
import { summariseRouting } from './route.ts';

export interface PerCaseRow {
  readonly programId: string;
  readonly decision: RouteDecision;
}

const BADGE: Record<RouteDecision['basis'], string> = {
  'methods-agree': 'AGREE   ',
  'methods-agree-abstain': 'AGREE-AB',
  'methods-diverge-dangerous': 'DANGER  ',
  'methods-diverge-safe': 'DIVERGE ',
  'methods-undecided': 'UNDEC   ',
  'probe-named-excluded': 'PROBE-HIT',
  'probe-weak-signal': 'PROBE-?  ',
  'probe-clear': 'PROBE-OK ',
  'probe-skipped': 'NO-PROBE ',
  'agentic-abstained-parser-did-not': 'A-ABSTN  ',
};

export function renderRouting(rows: readonly PerCaseRow[]): { text: string; summary: RoutingSummary } {
  const summary = summariseRouting(rows.map((r) => r.decision));
  const L: string[] = [];

  L.push('--- Per case ---');
  for (const r of rows) {
    const d = r.decision;
    const target = d.route === 'human' ? `human/${d.priority}` : 'high-confidence';
    L.push(`  ${BADGE[d.basis]}  ${r.programId.padEnd(30)} -> ${target}`);
  }
  L.push('');

  L.push('--- Cross-method agreement (Path A) ---');
  if (summary.agreementRate === null) {
    L.push('  comparable cases (both methods emitted a rule): 0');
    L.push('  AGREEMENT RATE: n/a -- Path A never had two rules to compare. The design is running entirely on Path B.');
  } else {
    L.push(`  comparable cases (both methods emitted a rule): ${summary.comparable}`);
    L.push(`  of those, the referee proved equivalent:        ${summary.agreed}`);
    L.push(`  AGREEMENT RATE: ${(summary.agreementRate * 100).toFixed(0)}%  (${summary.agreed}/${summary.comparable})`);
  }
  L.push('');

  L.push('--- Routing ---');
  L.push(`  high confidence:        ${summary.toHighConfidence} / ${summary.total}`);
  L.push(`  to a human reviewer:    ${summary.toHuman} / ${summary.total}   (of which high priority: ${summary.humanHighPriority})`);
  for (const [basis, n] of Object.entries(summary.byBasis)) {
    if (n > 0) L.push(`    ${basis.padEnd(34)} ${n}`);
  }
  L.push('');

  if (summary.routeEverythingWarning) {
    L.push('!!! DEGENERATE-OUTCOME WARNING !!!');
    L.push('  Almost every case routed to a human. A 0-dangerous result here means nothing -- it is');
    L.push('  classify-first in new clothing (issue #84). The two methods are not agreeing often enough');
    L.push('  for Path A to be a useful signal; the design is effectively just Path B plus a divergence flag.');
    L.push('');
  }

  return { text: L.join('\n'), summary };
}
