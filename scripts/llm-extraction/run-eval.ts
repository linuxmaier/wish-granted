/**
 * Runs EVAL_CASES against the real Claude API and reports a measured
 * abstention rate -- the headline metric for the LLM half of issue #5 (a
 * model that is 95% accurate and confidently wrong the other 5% is worse for
 * this product than one that abstains on what it doesn't know).
 *
 * Deliberately raw `fetch`, not the `@anthropic-ai/sdk` package: this keeps
 * the prototype at zero new dependencies (matching the rest of this spike,
 * and the contributor brief's "flag new dev dependencies" rule) -- an
 * intentional scope choice for a spike script, not a recommendation for a
 * production ingestion pipeline (#14), which should likely use the SDK.
 *
 * Extraction happens here, at build time, invoked by a human or CI running
 * this script -- never from the shipped app, which makes no network calls
 * at all. That is the hard constraint this whole design exists to respect.
 *
 * Usage:
 *   ANTHROPIC_API_KEY=sk-... node scripts/llm-extraction/run-eval.ts
 * (also `npm run eval:llm-extraction` with the key exported in the shell --
 * this Node version strips TS types directly, no flag or build step needed,
 * matching #24's scripts/refresh-income-tables/index.ts convention.)
 *
 * Without an API key, every case is reported SKIPPED rather than silently
 * treated as a pass or a failure -- this script was written but NOT executed
 * live during this spike (no credentials in the sandboxed environment it ran
 * in). See docs/eligibility-extraction.md for what that means for the
 * recommendation.
 */

import { buildCriterionJsonSchema } from './criterion-schema.ts';
import { gateCriterion } from './schema-gate.ts';
import { EVAL_CASES, type EvalCase } from './eval-cases.ts';
import type { Criterion } from '../../src/domain/criteria.ts';

const MODEL = 'claude-sonnet-5';

const SYSTEM_PROMPT = `You extract eligibility rules from real assistance-program source text into a small JSON expression language (a "Criterion" tree).

You will be given a verbatim excerpt and its citation. Call the emit_eligibility_criterion tool exactly once.

Rules:
- Only use facts and values that genuinely appear, or are unambiguously implied, in the excerpt. Do not fill in a plausible-sounding number, percentage, or program name that is not actually stated.
- If the excerpt does not state a clear, complete, decidable rule -- deduction stacks, multi-factor exception lists, cross-references to other sections, funding-contingent or discretionary language, or anything else you are not confident you can express exactly -- use the "manualReview" node instead of guessing. This is a correct, expected answer, not a failure.
- Set confidence: "low" whenever you are not highly confident, even if you did produce a specific rule rather than manualReview.
- Under-claiming (manualReview when a precise rule might have worked) is far preferable to over-claiming (a specific rule that turns out wrong). A wrong threshold reaches a person in financial crisis as a stated fact; a manualReview reaches a human reviewer first.`;

interface ToolUseBlock {
  readonly type: 'tool_use';
  readonly input: unknown;
}

function isToolUseBlock(block: unknown): block is ToolUseBlock {
  return typeof block === 'object' && block !== null && (block as { type?: unknown }).type === 'tool_use';
}

async function callModel(evalCase: EvalCase, apiKey: string): Promise<unknown> {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 4096,
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: 'user',
          content: `Source: ${evalCase.citationName} (${evalCase.citationUrl})\n\nExcerpt:\n"""\n${evalCase.excerpt}\n"""`,
        },
      ],
      tools: [
        {
          name: 'emit_eligibility_criterion',
          description: 'Emit the extracted eligibility rule as a Criterion tree, or manualReview if it cannot be extracted precisely.',
          // No `strict: true`. Strict structured output cannot express a
          // recursive expression language: even inlined to depth 3, the schema
          // trips the union-count limit (54 vs 16), and depth 1 is far too
          // shallow for real rules. See criterion-schema.ts's docblock and
          // docs/eligibility-extraction.md 4.5. The schema still guides the
          // model; schema-gate.ts does the actual enforcing, which was always
          // the real safety net.
          input_schema: buildCriterionJsonSchema(),
        },
      ],
      tool_choice: { type: 'tool', name: 'emit_eligibility_criterion' },
    }),
  });

  if (!res.ok) {
    throw new Error(`HTTP ${res.status}: ${await res.text()}`);
  }
  const body = (await res.json()) as { content?: unknown[] };
  const toolUse = (body.content ?? []).find(isToolUseBlock);
  if (!toolUse) throw new Error('no tool_use block in response');
  return toolUse.input;
}

type ExtractionOutput = { criterion: Criterion; sourceExcerpt: string; confidence: 'high' | 'low' };

function isExtractionOutput(value: unknown): value is ExtractionOutput {
  return (
    typeof value === 'object' &&
    value !== null &&
    'criterion' in value &&
    'sourceExcerpt' in value &&
    'confidence' in value
  );
}

/** Did the model's output count as an abstention (manualReview anywhere at or above the top)? */
function isAbstention(criterion: Criterion): boolean {
  if (criterion.kind === 'manualReview') return true;
  // A manualReview leaf nested inside allOf/anyOf alongside real criteria is
  // NOT counted as a full abstention here -- e.g.
  // madison-housing-choice-voucher's waitlist gate. Whether that mixed case
  // counts as "extracted" or "abstained" for a given eval case is a scoring
  // nuance the doc discusses; this harness scores strictly (top-level kind
  // only) and leaves mixed cases for manual read of the transcript.
  return false;
}

async function main() {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  console.log(`Model: ${MODEL}`);
  console.log(apiKey ? 'Live mode: calling the real API.\n' : 'No ANTHROPIC_API_KEY set -- every case will be SKIPPED.\n');

  let scored = 0;
  let correctAbstentions = 0;
  let dangerousOverclaims = 0;
  let correctExtractions = 0;
  let skipped = 0;

  for (const evalCase of EVAL_CASES) {
    if (!apiKey) {
      console.log(`SKIP  ${evalCase.id.padEnd(28)} (no ANTHROPIC_API_KEY)`);
      skipped += 1;
      continue;
    }

    try {
      const raw = await callModel(evalCase, apiKey);
      if (!isExtractionOutput(raw)) throw new Error('output missing required fields');
      const gate = gateCriterion(raw.criterion);
      const abstained = isAbstention(raw.criterion);

      scored += 1;
      if (!gate.ok) {
        console.log(`GATE-FAIL  ${evalCase.id.padEnd(28)} ${gate.problems.join('; ')}`);
      } else if (evalCase.expected === 'abstain' && abstained) {
        correctAbstentions += 1;
        console.log(`OK (abstained correctly)  ${evalCase.id}`);
      } else if (evalCase.expected === 'abstain' && !abstained) {
        dangerousOverclaims += 1;
        console.log(`DANGEROUS  ${evalCase.id.padEnd(28)} expected abstain, model emitted a specific rule`);
      } else if (evalCase.expected === 'extract' && !abstained) {
        correctExtractions += 1;
        console.log(`OK (extracted)  ${evalCase.id}`);
      } else {
        console.log(`OVER-CAUTIOUS  ${evalCase.id.padEnd(28)} expected an extraction, model abstained`);
      }
    } catch (err) {
      console.log(`ERROR  ${evalCase.id.padEnd(28)} ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  console.log('\n--- Summary ---');
  console.log(`${scored}/${EVAL_CASES.length} scored, ${skipped} skipped`);
  if (scored > 0) {
    console.log(`Correct abstentions: ${correctAbstentions}`);
    console.log(`Correct extractions: ${correctExtractions}`);
    console.log(`DANGEROUS over-claims (the metric that matters most): ${dangerousOverclaims}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
