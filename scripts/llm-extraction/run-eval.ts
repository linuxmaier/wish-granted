/**
 * Runs the eval set against the real Claude API and reports, per split, four
 * separate numbers -- correct abstentions, dangerous over-claims, correct
 * extractions, gate failures -- never blended into an accuracy figure
 * (docs/eligibility-extraction.md Section 4, issue #43).
 *
 * Three things #43 adds over the #5/#23 harness:
 *
 *   1. A held-out split. `--split=heldout` (default) scores only the cases
 *      frozen before the enum-slug prompt fix was written; `--split=tuning`
 *      scores the set the fix was designed against; `--split=all` does both.
 *      Reporting the tuning set as if it were a measurement of the model is
 *      exactly the mistake Section 4.4 warns against.
 *
 *   2. The enum-slug fix (Section 4.6). The system prompt now lists every enum
 *      fact's exact valid slugs (enum-vocab.ts), so the model stops emitting
 *      "FoodShare" / "Section 8" where `currentBenefits` wants `snap-foodshare`
 *      / `housing-choice-voucher`. `--enum-vocab=off` disables it for an A/B.
 *
 *   3. Prompt caching on the ~79 KB inlined schema (Section 4.5 flagged it,
 *      Section 6's cost model did not account for it). The schema tool and the
 *      stable system prefix carry `cache_control`; the run summary prints the
 *      measured cache read/write token split and the counterfactual
 *      no-caching cost. `--caching=off` disables it for an A/B.
 *
 * Still deliberately raw `fetch`, not `@anthropic-ai/sdk`: zero new
 * dependencies, matching the rest of scripts/. A real ingestion pipeline (#14)
 * should use the SDK.
 *
 * `strict: true` stays OFF -- Section 4.5's structural finding is that a
 * recursive expression language cannot be enforced by strict structured
 * output. `schema-gate.ts` is the real enforcement.
 *
 * Usage:
 *   npm run eval:llm-extraction                 # held-out split, caching + enum vocab on
 *   npm run eval:llm-extraction -- --split=all
 *   npm run eval:llm-extraction -- --split=tuning --enum-vocab=off --caching=off
 *
 * Reads .env via --env-file-if-exists (see package.json). Without an
 * ANTHROPIC_API_KEY every case is reported SKIPPED rather than faked.
 */

import { buildCriterionJsonSchema } from './criterion-schema.ts';
import { gateCriterion } from './schema-gate.ts';
import { describeEnumFacts } from './enum-vocab.ts';
import { casesInSplit, type EvalCase, type EvalSplit } from './eval-cases.ts';
import type { Criterion } from '../../src/domain/criteria.ts';

const MODEL = 'claude-sonnet-5';
const ANTHROPIC_VERSION = '2023-06-01';

// docs/eligibility-extraction.md Section 6.1, fetched 2026-08-21. The $2/$10
// rate is the standard (not introductory) price for Sonnet 5.
const PRICE = {
  inputPerMTok: 2.0,
  outputPerMTok: 10.0,
  cacheWritePerMTok: 2.5, // 5-minute cache write (~1.25x input)
  cacheReadPerMTok: 0.2, // ~0.1x input
} as const;

const BASE_SYSTEM_PROMPT = `You extract eligibility rules from real assistance-program source text into a small JSON expression language (a "Criterion" tree).

You will be given a verbatim excerpt and its citation. Call the emit_eligibility_criterion tool exactly once.

Rules:
- Only use facts and values that genuinely appear, or are unambiguously implied, in the excerpt. Do not fill in a plausible-sounding number, percentage, or program name that is not actually stated.
- If the excerpt does not state a clear, complete, decidable rule -- deduction stacks, multi-factor exception lists, cross-references to other sections, funding-contingent or discretionary language, or anything else you are not confident you can express exactly -- use the "manualReview" node instead of guessing. This is a correct, expected answer, not a failure.
- manualReview can be the whole rule, or one leaf inside a larger allOf alongside real criteria you are confident about. Do not collapse a whole program to manualReview because one condition inside it is undecidable; do not force a specific rule when the honest answer is manualReview.
- Set confidence: "low" whenever you are not highly confident, even if you did produce a specific rule rather than manualReview.
- Under-claiming (manualReview when a precise rule might have worked) is far preferable to over-claiming (a specific rule that turns out wrong). A wrong threshold reaches a person in financial crisis as a stated fact; a manualReview reaches a human reviewer first.
- A number in the source is not automatically an eligibility threshold. Check what it actually governs -- a deduction, a reporting requirement, a processing-speed trigger, household composition -- before encoding it.`;

interface RunOptions {
  readonly split: EvalSplit | 'all';
  readonly enumVocab: boolean;
  readonly caching: boolean;
}

function parseArgs(argv: readonly string[]): RunOptions {
  let split: RunOptions['split'] = 'heldout';
  let enumVocab = true;
  let caching = true;
  for (const arg of argv) {
    const [key, value] = arg.replace(/^--/, '').split('=');
    if (key === 'split' && (value === 'heldout' || value === 'tuning' || value === 'all')) split = value;
    else if (key === 'enum-vocab') enumVocab = value !== 'off';
    else if (key === 'caching') caching = value !== 'off';
    else if (arg.startsWith('--')) {
      console.error(`Unknown flag: ${arg}`);
      process.exit(2);
    }
  }
  return { split, enumVocab, caching };
}

/** The system prompt as content blocks: stable prefix first, cache breakpoint at its end. */
function buildSystem(opts: RunOptions): unknown {
  const stable = opts.enumVocab ? `${BASE_SYSTEM_PROMPT}\n\n${describeEnumFacts()}` : BASE_SYSTEM_PROMPT;
  const block: Record<string, unknown> = { type: 'text', text: stable };
  if (opts.caching) block.cache_control = { type: 'ephemeral' };
  return [block];
}

function buildTool(opts: RunOptions): unknown {
  const tool: Record<string, unknown> = {
    name: 'emit_eligibility_criterion',
    description:
      'Emit the extracted eligibility rule as a Criterion tree, or manualReview if it cannot be extracted precisely.',
    // No `strict: true` -- see the docblock and criterion-schema.ts.
    input_schema: buildCriterionJsonSchema(),
  };
  // tools render before system in the cached prefix, and the ~79 KB schema is
  // byte-identical across every call, so this is the single highest-value
  // cache breakpoint.
  if (opts.caching) tool.cache_control = { type: 'ephemeral' };
  return tool;
}

interface Usage {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
}

interface ApiResult {
  readonly input: unknown;
  readonly usage: Usage;
}

async function callModel(evalCase: EvalCase, apiKey: string, opts: RunOptions): Promise<ApiResult> {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': ANTHROPIC_VERSION,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 4096,
      system: buildSystem(opts),
      messages: [
        {
          role: 'user',
          content: `Source: ${evalCase.citationName} (${evalCase.citationUrl})\n\nExcerpt:\n"""\n${evalCase.excerpt}\n"""`,
        },
      ],
      tools: [buildTool(opts)],
      tool_choice: { type: 'tool', name: 'emit_eligibility_criterion' },
    }),
  });

  if (!res.ok) {
    throw new Error(`HTTP ${res.status}: ${await res.text()}`);
  }
  const body = (await res.json()) as { content?: unknown[]; usage?: Usage };
  const toolUse = (body.content ?? []).find(isToolUseBlock);
  if (!toolUse) throw new Error('no tool_use block in response');
  return { input: toolUse.input, usage: body.usage ?? { input_tokens: 0, output_tokens: 0 } };
}

interface ToolUseBlock {
  readonly type: 'tool_use';
  readonly input: unknown;
}

function isToolUseBlock(block: unknown): block is ToolUseBlock {
  return typeof block === 'object' && block !== null && (block as { type?: unknown }).type === 'tool_use';
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

/** Did the model abstain? Only a top-level manualReview counts (a nested leaf does not). */
function isAbstention(criterion: Criterion): boolean {
  return criterion.kind === 'manualReview';
}

interface SplitScore {
  scored: number;
  skipped: number;
  correctAbstentions: number;
  dangerousOverclaims: number;
  correctExtractions: number;
  gateFailures: number;
  overCautious: number;
  errors: number;
  abstainCases: number;
  extractCases: number;
}

interface TokenTotals {
  freshInput: number;
  cacheWrite: number;
  cacheRead: number;
  output: number;
}

function emptyScore(cases: readonly EvalCase[]): SplitScore {
  return {
    scored: 0,
    skipped: 0,
    correctAbstentions: 0,
    dangerousOverclaims: 0,
    correctExtractions: 0,
    gateFailures: 0,
    overCautious: 0,
    errors: 0,
    abstainCases: cases.filter((c) => c.expected === 'abstain').length,
    extractCases: cases.filter((c) => c.expected === 'extract').length,
  };
}

async function runSplit(
  split: EvalSplit,
  apiKey: string | undefined,
  opts: RunOptions,
  tokens: TokenTotals,
): Promise<SplitScore> {
  const cases = casesInSplit(split);
  const score = emptyScore(cases);
  console.log(`\n=== Split: ${split} (${cases.length} cases: ${score.abstainCases} abstain, ${score.extractCases} extract) ===`);

  for (const evalCase of cases) {
    if (!apiKey) {
      console.log(`SKIP        ${evalCase.id.padEnd(34)} (no ANTHROPIC_API_KEY)`);
      score.skipped += 1;
      continue;
    }

    try {
      const { input, usage } = await callModel(evalCase, apiKey, opts);
      tokens.freshInput += usage.input_tokens ?? 0;
      tokens.cacheWrite += usage.cache_creation_input_tokens ?? 0;
      tokens.cacheRead += usage.cache_read_input_tokens ?? 0;
      tokens.output += usage.output_tokens ?? 0;

      if (!isExtractionOutput(input)) throw new Error('output missing required fields');
      const gate = gateCriterion(input.criterion);
      const abstained = isAbstention(input.criterion);
      score.scored += 1;

      if (!gate.ok) {
        score.gateFailures += 1;
        console.log(`GATE-FAIL   ${evalCase.id.padEnd(34)} ${gate.problems.join('; ')}`);
      } else if (evalCase.expected === 'abstain' && abstained) {
        score.correctAbstentions += 1;
        console.log(`OK abstain  ${evalCase.id}`);
      } else if (evalCase.expected === 'abstain' && !abstained) {
        score.dangerousOverclaims += 1;
        console.log(`DANGEROUS   ${evalCase.id.padEnd(34)} expected abstain, model emitted ${input.criterion.kind}`);
      } else if (evalCase.expected === 'extract' && !abstained) {
        score.correctExtractions += 1;
        console.log(`OK extract  ${evalCase.id}`);
      } else {
        score.overCautious += 1;
        console.log(`OVER-CAUT   ${evalCase.id.padEnd(34)} expected an extraction, model abstained`);
      }
    } catch (err) {
      score.errors += 1;
      console.log(`ERROR       ${evalCase.id.padEnd(34)} ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return score;
}

function reportSplit(split: EvalSplit, s: SplitScore): void {
  console.log(`\n--- ${split}: the four numbers, reported separately (never blended) ---`);
  console.log(`  Correct abstentions:   ${s.correctAbstentions} / ${s.abstainCases}`);
  console.log(`  Dangerous over-claims:  ${s.dangerousOverclaims}${s.dangerousOverclaims > 0 ? '   <-- BLOCKING' : ''}`);
  console.log(`  Correct extractions:   ${s.correctExtractions} / ${s.extractCases}`);
  console.log(`  Gate failures:          ${s.gateFailures}`);
  if (s.overCautious > 0) console.log(`  (over-cautious: ${s.overCautious} -- abstained where an extraction was expected; not dangerous)`);
  if (s.errors > 0) console.log(`  (API errors: ${s.errors})`);
  if (s.skipped > 0) console.log(`  SKIPPED: ${s.skipped} (no API key -- nothing measured)`);
  if (split === 'heldout' && s.dangerousOverclaims > 0) {
    console.log(
      `\n  ** A single dangerous over-claim on the held-out split is a blocking result, not a percentage. **`,
    );
  }
}

function reportTokens(tokens: TokenTotals, opts: RunOptions, calls: number): void {
  if (calls === 0) return;
  const schemaBytes = JSON.stringify(buildCriterionJsonSchema()).length;
  console.log(`\n=== Token cost (schema is ${(schemaBytes / 1024).toFixed(0)} KB of JSON, byte-identical every call) ===`);
  console.log(`  calls: ${calls}   caching: ${opts.caching ? 'on' : 'off'}   enum-vocab: ${opts.enumVocab ? 'on' : 'off'}`);
  console.log(
    `  fresh input: ${tokens.freshInput}   cache write: ${tokens.cacheWrite}   cache read: ${tokens.cacheRead}   output: ${tokens.output}`,
  );

  const perMTok = (n: number, price: number) => (n / 1_000_000) * price;
  const actualInputCost =
    perMTok(tokens.freshInput, PRICE.inputPerMTok) +
    perMTok(tokens.cacheWrite, PRICE.cacheWritePerMTok) +
    perMTok(tokens.cacheRead, PRICE.cacheReadPerMTok);
  const outputCost = perMTok(tokens.output, PRICE.outputPerMTok);

  // Counterfactual: every cache-read token would have been a full-price fresh
  // input token, and there would be no cache-write premium.
  const noCacheInputTokens = tokens.freshInput + tokens.cacheWrite + tokens.cacheRead;
  const noCacheInputCost = perMTok(noCacheInputTokens, PRICE.inputPerMTok);

  console.log(`  input cost, caching ${opts.caching ? 'ON' : 'OFF'}: $${actualInputCost.toFixed(5)}`);
  console.log(`  input cost, no caching (counterfactual): $${noCacheInputCost.toFixed(5)}`);
  const saved = noCacheInputCost - actualInputCost;
  if (opts.caching && noCacheInputCost > 0) {
    console.log(`  saved on input by caching: $${saved.toFixed(5)}  (${((saved / noCacheInputCost) * 100).toFixed(0)}%)`);
  }
  console.log(`  output cost: $${outputCost.toFixed(5)}   total: $${(actualInputCost + outputCost).toFixed(5)}`);
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const apiKey = process.env.ANTHROPIC_API_KEY;

  console.log(`Model: ${MODEL}`);
  console.log(`Options: split=${opts.split}  enum-vocab=${opts.enumVocab ? 'on' : 'off'}  caching=${opts.caching ? 'on' : 'off'}`);
  console.log(apiKey ? 'Live mode: calling the real API.' : 'No ANTHROPIC_API_KEY -- every case will be SKIPPED (reporting SKIPPED, not a fabricated result).');

  const splits: EvalSplit[] = opts.split === 'all' ? ['heldout', 'tuning'] : [opts.split];
  const tokens: TokenTotals = { freshInput: 0, cacheWrite: 0, cacheRead: 0, output: 0 };
  const scores: { split: EvalSplit; score: SplitScore }[] = [];

  for (const split of splits) {
    const score = await runSplit(split, apiKey, opts, tokens);
    scores.push({ split, score });
  }

  console.log('\n============ SUMMARY ============');
  let blocking = false;
  for (const { split, score } of scores) {
    reportSplit(split, score);
    if (split === 'heldout' && score.dangerousOverclaims > 0) blocking = true;
  }
  const totalCalls = scores.reduce((n, s) => n + s.score.scored + s.score.errors, 0);
  reportTokens(tokens, opts, totalCalls);

  if (!apiKey) {
    console.log('\nResult: SKIPPED (no API key). No numbers were measured.');
  } else if (blocking) {
    console.log('\nResult: BLOCKING -- a dangerous over-claim occurred on the held-out split.');
    process.exitCode = 1;
  } else {
    console.log('\nResult: measured. Report the four numbers per split separately.');
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
