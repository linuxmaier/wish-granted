/**
 * The OPTIONAL live classifier for triage (issue #68).
 *
 * Extends the scope-signal idea from
 * scripts/llm-extraction/framing/classify-role.ts (#64): a single, fresh
 * model call, one tool, one turn, that answers one question about a source --
 *
 *   "Does this page state an eligibility rule of any kind, or does it decline
 *    to state one?"
 *
 * and quotes the governing span, exactly as classify-role's scope-signal
 * detection does when it fires. It reports a numeric `confidenceScore` (0-100).
 * The categorical `confidence: 'low'` gate that classify-role shipped was
 * measured miscalibrated and replaced with the numeric form (#64); this module
 * does NOT reintroduce the categorical form.
 *
 * ## Why it is optional, and narrow
 *
 * The deterministic parser's outcome plus ./signals.ts already resolve every
 * source in the offline corpus (see the PR). This call exists only to
 * second-guess the ONE route with a silent-loss failure mode:
 * `no-rule-published`. ./route.ts consults it only when the deterministic
 * evidence already points at `no-rule-published`, and it can only ever move a
 * source TO `agentic` (rescue it), never push one to `no-rule-published`. The
 * asymmetry in #68 makes that the only safe direction for a model to push.
 *
 * ## No key -> SKIPPED, never fabricated
 *
 * With no ANTHROPIC_API_KEY and no injected model this throws
 * `MissingApiKeyError`, and the entrypoint reports SKIPPED for the live step --
 * #63 shipped a whole spike with zero measurements without making that gap
 * obvious; this does not.
 */
import { MissingApiKeyError } from '../../program-benchmark/lib/extractor.ts';
import { AnthropicModelClient } from '../../agentic-extract/lib/anthropic-client.ts';
import type { ModelClient } from '../../agentic-extract/lib/model-client.ts';
import { toolUseBlocks } from '../../agentic-extract/lib/model-client.ts';
import type { SourceClassification } from './route.ts';

export const CLASSIFY_SYSTEM_PROMPT =
  'You classify one page from an assistance-program website. You are NOT extracting a rule -- a ' +
  'later step does that. Answer one question: does this page STATE AN ELIGIBILITY RULE of any ' +
  'kind, or does it DECLINE to state one?\n\n' +
  'A page states a rule if it gives any condition a person must meet: an income limit (even ' +
  'unquantified -- "low-income"), an age band, a categorical route ("if you get SNAP you ' +
  'qualify"), a residency or household requirement, a "you must be...". The rule may be vague, ' +
  'incomplete, or on a linked page -- that still counts as stating one.\n\n' +
  'A page DECLINES to state a rule if it is a pure referral service, a screening tool that ' +
  'explicitly is "not an application" and gives no criteria, or a service open to anyone with no ' +
  'conditions at all ("no income test, no documentation, open to anyone who needs food").\n\n' +
  'Call report_classification exactly once. Quote the single span your answer rests on, verbatim ' +
  'from the page. Set confidenceScore 0-100: reserve above 80 for pages where one plain reading ' +
  'is the only reading. When you are unsure, a LOWER score is the safe answer -- the caller ' +
  'treats an uncertain "no rule" as "attempt extraction anyway".';

const REPORT_TOOL = {
  name: 'report_classification',
  description: 'Report whether the page states an eligibility rule. Call exactly once.',
  input_schema: {
    type: 'object',
    properties: {
      states_eligibility_rule: {
        type: 'boolean',
        description: 'True if the page states any eligibility condition (however vague or incomplete). False only if it clearly declines to state one.',
      },
      evidence_quote: {
        type: 'string',
        description: 'The single span the answer rests on, copied verbatim from the page text.',
      },
      confidence_score: {
        type: 'integer',
        minimum: 0,
        maximum: 100,
        description: 'How sure you are (0-100). Above 80 only when one plain reading is the only reading.',
      },
    },
    required: ['states_eligibility_rule', 'evidence_quote', 'confidence_score'],
  },
} as const;

interface ReportInput {
  readonly states_eligibility_rule?: unknown;
  readonly evidence_quote?: unknown;
  readonly confidence_score?: unknown;
}

/**
 * Parse the model's single tool call. Defensive: a missing or malformed call is
 * read as "states a rule, low confidence" -- the fail-safe direction, because
 * the caller routes an uncertain no-rule to extraction anyway.
 */
export function parseClassifyResponse(input: unknown): SourceClassification {
  const i = (input ?? {}) as ReportInput;
  const score = typeof i.confidence_score === 'number' && Number.isFinite(i.confidence_score)
    ? Math.max(0, Math.min(100, Math.round(i.confidence_score)))
    : 0;
  const quote = typeof i.evidence_quote === 'string' ? i.evidence_quote.trim() : '';
  if (i.states_eligibility_rule === false) {
    return { statesEligibilityRule: false, confidenceScore: score, evidenceQuote: quote };
  }
  return { statesEligibilityRule: true, confidenceScore: i.states_eligibility_rule === true ? score : 0, evidenceQuote: quote };
}

export interface SourceClassifierOptions {
  readonly model?: ModelClient;
  readonly hasApiKey?: boolean;
}

export interface ClassifyQuestion {
  readonly sourceName: string;
  readonly sourceText: string;
}

export type SourceClassifier = (q: ClassifyQuestion) => Promise<SourceClassification>;

export function liveSourceClassifier(opts: SourceClassifierOptions = {}): SourceClassifier {
  return async (q: ClassifyQuestion): Promise<SourceClassification> => {
    if (!opts.model && !opts.hasApiKey) throw new MissingApiKeyError();
    const model = opts.model ?? new AnthropicModelClient();

    const res = await model.createMessage({
      system: [{ type: 'text', text: CLASSIFY_SYSTEM_PROMPT }],
      messages: [
        {
          role: 'user',
          content:
            `SOURCE: ${q.sourceName}\n\n--- PAGE TEXT ---\n${q.sourceText}\n--- END PAGE TEXT ---\n\n` +
            `Does this page state an eligibility rule, or decline to state one?`,
        },
      ],
      tools: [REPORT_TOOL],
    });

    const calls = toolUseBlocks(res).filter((b) => b.name === REPORT_TOOL.name);
    if (calls.length === 0) {
      return { statesEligibilityRule: true, confidenceScore: 0, evidenceQuote: '' };
    }
    return parseClassifyResponse(calls[calls.length - 1]!.input);
  };
}
