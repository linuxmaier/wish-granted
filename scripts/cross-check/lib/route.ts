/**
 * The routing decision for issue #84: combine Path A (cross-method agreement)
 * and Path B (exclusion probe) into one verdict per source.
 *
 * "Route to a human" here means "do not fast-track -- a reviewer should scrutinise
 * this before it ships". Every eligibility change already gets mandatory human
 * review (#1/#14/epic #65); this decides *priority*, and which cases we have an
 * independent reason to trust.
 *
 * ## The failure mode this design must expose, not hide (issue #84)
 *
 * If Path A routes nearly everything to a human because the two methods rarely
 * agree, that is classify-first again in new clothing -- a 0-dangerous number
 * bought by never committing. `summariseRouting` reports the agreement rate
 * explicitly so that outcome is visible.
 */
import type { AgreementResult } from './agreement.ts';
import { crossMethodAgreement } from './agreement.ts';
import type { MethodOutcome } from './methods.ts';
import { isExtract } from './methods.ts';
import { runExclusionProbe, type ProbeAsker, type ProbeResult, type ProbeQuestion } from './exclusion-probe.ts';

export type RouteTarget = 'high-confidence' | 'human';
export type RoutePriority = 'high' | 'low';

/** How the verdict was reached -- the interesting axis for the report. */
export type RouteBasis =
  | 'methods-agree' // Path A: both methods emitted the same rule
  | 'methods-agree-abstain' // Path A: both methods independently found no rule
  | 'methods-diverge-dangerous' // Path A: divergent, dangerous direction
  | 'methods-diverge-safe' // Path A: divergent, over-inclusive only
  | 'methods-undecided' // Path A: referee could not decide
  | 'probe-named-excluded' // Path B: fresh probe named a source-verified excluded person
  | 'probe-weak-signal' // Path B: probe named someone but the span did not check out
  | 'probe-clear' // Path B: fresh probe found nobody wrongly excluded
  | 'probe-skipped' // Path B needed but no probe was available (e.g. no API key)
  | 'agentic-abstained-parser-did-not'; // parser emitted a rule the agentic method declined

export interface RouteDecision {
  readonly route: RouteTarget;
  readonly priority?: RoutePriority;
  readonly basis: RouteBasis;
  readonly reason: string;
  readonly agreement: AgreementResult;
  readonly probe?: ProbeResult;
}

export interface CrossCheckInput {
  readonly deterministic: MethodOutcome;
  readonly agentic: MethodOutcome;
  /**
   * The exclusion probe. Consulted ONLY when Path A cannot fire because the
   * deterministic parser abstained while the agentic method emitted a rule.
   * Omit it (no API key, offline) and that case routes to a human as
   * `probe-skipped` -- never silently trusted.
   */
  readonly probe?: {
    readonly ask: ProbeAsker;
    readonly question: Omit<ProbeQuestion, 'rule'>;
  };
}

export async function crossCheck(input: CrossCheckInput): Promise<RouteDecision> {
  const agreement = crossMethodAgreement(input.deterministic, input.agentic);

  // ---- Path A: both methods have an opinion ----
  if (agreement.comparable) {
    switch (agreement.verdict) {
      case 'equivalent':
        return {
          route: 'high-confidence',
          basis: 'methods-agree',
          reason:
            'Two independent methods -- a deterministic parser and an LLM with source access -- ' +
            'produced the same rule. Neither method\'s known failure mode fired.',
          agreement,
        };
      case 'divergent-dangerous':
        return {
          route: 'human',
          priority: 'high',
          basis: 'methods-diverge-dangerous',
          reason:
            'The two methods disagree in the dangerous direction -- one of them dropped a governing ' +
            'branch. We do not need to know which; a reviewer must.',
          agreement,
        };
      case 'undecided':
        return {
          route: 'human',
          priority: 'low',
          basis: 'methods-undecided',
          reason: 'The two methods differ and the referee could not prove them equivalent. Not provably safe.',
          agreement,
        };
      case 'divergent-safe':
        return {
          route: 'human',
          priority: 'low',
          basis: 'methods-diverge-safe',
          reason: 'The two methods differ, but only in the over-inclusive direction (a reviewer confirms, no one is turned away).',
          agreement,
        };
    }
  }

  // ---- Both abstained: an agreement, of a kind ----
  if (input.deterministic.decision === 'abstain' && input.agentic.decision === 'abstain') {
    return {
      route: 'high-confidence',
      basis: 'methods-agree-abstain',
      reason: 'Both independent methods found no decidable rule in the source. The abstention is corroborated.',
      agreement,
    };
  }

  // ---- Parser emitted a rule, agentic abstained ----
  if (isExtract(input.deterministic) && input.agentic.decision === 'abstain') {
    return {
      route: 'human',
      priority: 'low',
      basis: 'agentic-abstained-parser-did-not',
      reason:
        'The deterministic parser extracted a rule the agentic method declined to state. ' +
        'Possibly parser over-reach, possibly agentic over-caution -- a reviewer decides.',
      agreement,
    };
  }

  // ---- Path B: parser abstained, agentic emitted a rule ----
  if (input.deterministic.decision === 'abstain' && isExtract(input.agentic)) {
    if (!input.probe) {
      return {
        route: 'human',
        priority: 'low',
        basis: 'probe-skipped',
        reason:
          'The deterministic parser abstained, so there is no cross-check, and no exclusion probe was ' +
          'available (offline / no API key). Single-method output is never auto-trusted.',
        agreement,
      };
    }
    const probe = await runExclusionProbe(input.probe.ask, {
      ...input.probe.question,
      rule: input.agentic.criterion,
    });
    if (probe.namedSomeone && probe.spanVerified) {
      return {
        route: 'human',
        priority: 'high',
        basis: 'probe-named-excluded',
        reason:
          'A fresh reader, with no memory of the extraction, named a concrete person the source calls ' +
          'eligible whom this rule would exclude -- and the quoted span checks out against the source.',
        agreement,
        probe,
      };
    }
    if (probe.namedSomeone) {
      return {
        route: 'human',
        priority: 'low',
        basis: 'probe-weak-signal',
        reason:
          'The exclusion probe named someone wrongly excluded but could not ground it in a verbatim span. ' +
          'Weak signal -- a reviewer should still look.',
        agreement,
        probe,
      };
    }
    return {
      route: 'high-confidence',
      basis: 'probe-clear',
      reason:
        'Single-method extraction (the parser abstained), but a fresh independent reader found nobody ' +
        'the source calls eligible whom the rule would exclude.',
      agreement,
      probe,
    };
  }

  // Unreachable: agreement.comparable already covered extract/extract.
  return {
    route: 'human',
    priority: 'low',
    basis: 'probe-skipped',
    reason: 'Unclassified method-outcome combination; routed to a human by default.',
    agreement,
  };
}

// --- Aggregate reporting ---------------------------------------------------

export interface RoutingSummary {
  readonly total: number;
  /** Cases where Path A had two rules to compare. */
  readonly comparable: number;
  /** Of the comparable cases, how many the referee proved equivalent. */
  readonly agreed: number;
  /** agreed / comparable, or null when nothing was comparable. THE number #84 asks for. */
  readonly agreementRate: number | null;
  readonly byBasis: Record<RouteBasis, number>;
  readonly toHuman: number;
  readonly toHighConfidence: number;
  readonly humanHighPriority: number;
  /** True when almost everything routed to a human -- the classify-first smell. */
  readonly routeEverythingWarning: boolean;
}

const ALL_BASES: RouteBasis[] = [
  'methods-agree',
  'methods-agree-abstain',
  'methods-diverge-dangerous',
  'methods-diverge-safe',
  'methods-undecided',
  'probe-named-excluded',
  'probe-weak-signal',
  'probe-clear',
  'probe-skipped',
  'agentic-abstained-parser-did-not',
];

export function summariseRouting(decisions: readonly RouteDecision[]): RoutingSummary {
  const byBasis = Object.fromEntries(ALL_BASES.map((b) => [b, 0])) as Record<RouteBasis, number>;
  let comparable = 0;
  let agreed = 0;
  let toHuman = 0;
  let toHighConfidence = 0;
  let humanHighPriority = 0;

  for (const d of decisions) {
    byBasis[d.basis] += 1;
    if (d.agreement.comparable) {
      comparable += 1;
      if (d.agreement.verdict === 'equivalent') agreed += 1;
    }
    if (d.route === 'human') {
      toHuman += 1;
      if (d.priority === 'high') humanHighPriority += 1;
    } else {
      toHighConfidence += 1;
    }
  }

  const total = decisions.length;
  return {
    total,
    comparable,
    agreed,
    agreementRate: comparable > 0 ? agreed / comparable : null,
    byBasis,
    toHuman,
    toHighConfidence,
    humanHighPriority,
    routeEverythingWarning: total >= 5 && toHighConfidence / total < 0.2,
  };
}
