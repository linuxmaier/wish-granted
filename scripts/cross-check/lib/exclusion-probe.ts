/**
 * Path B of issue #84 -- the exclusion probe.
 *
 * Fires only where the deterministic parser abstains, so Path A has no second
 * rule to compare against. A FRESH model call -- no memory of the extraction --
 * is given the source text and the emitted rule and asked ONE narrow question:
 *
 *   "Name someone the source says is eligible whom this rule would exclude."
 *
 * This is not option 2's failed self-check. Three differences are load-bearing
 * and must be preserved (issue #84):
 *
 *   1. It targets ONLY the dangerous direction (someone wrongly excluded), not
 *      correctness in general.
 *   2. It is a FRESH call -- a second reader not bound by the first reader's
 *      blind spot. The failure mode is confidently-incomplete reading; asking
 *      the same context again cannot catch it.
 *   3. It asks for a CONCRETE person plus a verbatim span, which this module
 *      then checks MECHANICALLY against the source text. An answer whose span is
 *      not in the source is discarded -- the model cannot route a case to a
 *      human by inventing a quote.
 *
 * The model call itself is injected as a `ProbeAsker`; the live implementation
 * is lib/live-probe.ts. Everything in THIS file is pure and model-free, so the
 * span check and the routing logic are unit-tested with zero tokens.
 */
import type { Criterion } from '../../../src/domain/criteria.ts';

export interface ProbeQuestion {
  readonly sourceName: string;
  /** The source's meaningful text (already fetched / rendered). */
  readonly sourceText: string;
  /** The rule the agentic extractor emitted for this source. */
  readonly rule: Criterion;
}

/**
 * The model's answer. `excludedPerson` is null when the model finds nobody the
 * source calls eligible whom the rule would exclude. `quotedSpan` is the
 * verbatim sentence from the source that says that person is eligible -- what
 * makes the claim falsifiable.
 */
export interface ProbeAnswer {
  readonly excludedPerson: string | null;
  readonly quotedSpan: string | null;
  /** The model's one-line reasoning. Not used for routing; carried for the report. */
  readonly rationale?: string;
}

export type ProbeAsker = (q: ProbeQuestion) => Promise<ProbeAnswer>;

export interface ProbeResult {
  /** The model named a concrete excluded person. */
  readonly namedSomeone: boolean;
  /** That person's eligibility span was found verbatim in the source text. */
  readonly spanVerified: boolean;
  readonly answer: ProbeAnswer;
  readonly detail: string;
}

const MIN_SPAN_CHARS = 12;

/** Collapse whitespace and lowercase, for a forgiving verbatim-ish comparison. */
function normalize(s: string): string {
  return s
    .replace(/[‐-―−]/g, '-') // dash variants -> hyphen
    .replace(/[‘’‛]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/**
 * The mechanical falsifiability check. A span counts as verified when a
 * whitespace-normalised, case-folded copy of it appears in the normalised
 * source text and is long enough not to match by accident.
 */
export function spanIsInSource(span: string | null | undefined, sourceText: string): boolean {
  if (!span) return false;
  const n = normalize(span);
  if (n.length < MIN_SPAN_CHARS) return false;
  return normalize(sourceText).includes(n);
}

/**
 * Render a `Criterion` tree as short indented text, so the probe reasons about
 * the rule rather than parsing JSON. Deliberately plain -- it is a prompt input,
 * not a user-facing explanation.
 */
export function describeCriterion(c: Criterion, indent = 0): string {
  const pad = '  '.repeat(indent);
  switch (c.kind) {
    case 'always':
      return `${pad}- always eligible`;
    case 'manualReview':
      return `${pad}- needs manual review: ${c.note}`;
    case 'incomeAtOrBelow':
      return `${pad}- household income at or below ${c.percent}% of ${c.scale}`;
    case 'compare':
      return `${pad}- ${c.fact} ${c.op} ${JSON.stringify(c.value)}`;
    case 'set':
      return `${pad}- ${c.fact} ${c.op} [${c.values.join(', ')}]`;
    case 'not':
      return `${pad}- NOT:\n${describeCriterion(c.of, indent + 1)}`;
    case 'allOf':
      return `${pad}- ALL of:\n${c.of.map((k) => describeCriterion(k, indent + 1)).join('\n')}`;
    case 'anyOf':
      return `${pad}- ANY of:\n${c.of.map((k) => describeCriterion(k, indent + 1)).join('\n')}`;
  }
}

export const PROBE_SYSTEM_PROMPT =
  'You are a second reader checking a machine-extracted eligibility rule for one specific ' +
  'failure: the rule being NARROWER than the source. You have no memory of how the rule was ' +
  'produced. You are NOT asked whether the rule is correct in general, only whether it would ' +
  'turn away someone the source itself says is eligible.\n\n' +
  'Find the single clearest example of a person or household that (a) the SOURCE TEXT states is ' +
  'eligible, and (b) the RULE would rule out or fail to confirm. If there is such a person, name ' +
  'them concretely and quote the exact sentence from the source that says they are eligible. If ' +
  'you cannot find one, say so plainly -- do not invent a borderline case.';

export function buildProbeUserMessage(q: ProbeQuestion): string {
  return (
    `SOURCE: ${q.sourceName}\n\n` +
    `--- SOURCE TEXT ---\n${q.sourceText}\n--- END SOURCE TEXT ---\n\n` +
    `--- EXTRACTED RULE ---\n${describeCriterion(q.rule)}\n--- END EXTRACTED RULE ---\n\n` +
    `Name someone the source says is eligible whom this rule would exclude. ` +
    `Quote the exact sentence from the source that says that person is eligible.`
  );
}

/**
 * Run the probe: ask the (injected) model, then verify its span mechanically.
 * The verdict a caller acts on is `namedSomeone && spanVerified`.
 */
export async function runExclusionProbe(ask: ProbeAsker, q: ProbeQuestion): Promise<ProbeResult> {
  const answer = await ask(q);
  const namedSomeone = Boolean(answer.excludedPerson && answer.excludedPerson.trim());
  const spanVerified = namedSomeone && spanIsInSource(answer.quotedSpan, q.sourceText);

  let detail: string;
  if (!namedSomeone) {
    detail = 'The probe found nobody the source calls eligible whom the rule would exclude.';
  } else if (spanVerified) {
    detail = `The probe named "${answer.excludedPerson}" and its eligibility span checks out against the source.`;
  } else {
    detail = `The probe named "${answer.excludedPerson}" but its quoted span is not in the source text -- discarded.`;
  }

  return { namedSomeone, spanVerified, answer, detail };
}
