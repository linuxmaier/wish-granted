/**
 * Runs the #62 framing pipeline and reports the four numbers separately --
 * correct abstentions / dangerous over-claims / correct extractions / gate
 * failures -- plus a fifth, over-cautious (a control routed to manualReview),
 * because that is the cost of a selective pipeline and #61 showed it is real.
 *
 * Pipeline (--pipeline=classify-first, the default):
 *
 *   1. classify_excerpt  -- what does each number govern, what shape is the rule
 *      (classify-role.ts). decideAutonomy() routes.
 *   2a. not autonomous  -> emit manualReview WITHOUT calling the extractor.
 *   2b. autonomous      -> the existing extraction call (criterion-schema.ts +
 *       schema-gate.ts), then optionally verify_by_counterexample (--verify).
 *
 * --pipeline=direct skips step 1 and calls the extractor on every case -- the
 * current one-step behaviour, for an A/B baseline on the same cases.
 *
 * --excerpt=structured re-renders any case that carries an htmlFixture through
 * structure-excerpt.ts (tables kept as Markdown) instead of the prose-flattened
 * excerpt (hypothesis 3). --excerpt=prose (default) is the current pipeline.
 *
 * --split=framing (default) scores the six frozen supplementary cases
 * (framing-eval-cases.ts). --split=heldout / --split=tuning run the SAME
 * pipeline against the frozen main set (eval-cases.ts) WITHOUT modifying it --
 * that is where a real measurement of the classify-first pipeline lives.
 *
 * No ANTHROPIC_API_KEY -> every case SKIPPED, nothing fabricated (same contract
 * as run-eval.ts). `strict: true` stays OFF (docs Section 4.5).
 *
 *   npm run eval:llm-framing
 *   npm run eval:llm-framing -- --split=heldout --verify
 *   npm run eval:llm-framing -- --split=framing --excerpt=structured
 *   npm run eval:llm-framing -- --pipeline=direct --split=heldout   # baseline
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { buildCriterionJsonSchema } from '../criterion-schema.ts';
import { gateCriterion } from '../schema-gate.ts';
import { describeEnumFacts } from '../enum-vocab.ts';
import { casesInSplit } from '../eval-cases.ts';
import type { Criterion } from '../../../src/domain/criteria.ts';
import {
  buildClassifierToolSchema,
  CLASSIFIER_SYSTEM_PROMPT,
  decideAutonomy,
  isClassification,
} from './classify-role.ts';
import {
  buildVerifierToolSchema,
  VERIFIER_SYSTEM_PROMPT,
  verdictRejects,
  isCounterexample,
} from './verify-counterexample.ts';
import { renderExcerpt, type ExcerptMode } from './structure-excerpt.ts';
import { FRAMING_EVAL_CASES } from './framing-eval-cases.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const DEFAULT_MODEL = 'claude-sonnet-5';
const ANTHROPIC_VERSION = '2023-06-01';

// docs/eligibility-extraction.md Section 6.1, fetched 2026-08-21.
const PRICE = { inputPerMTok: 2.0, outputPerMTok: 10.0, cacheWritePerMTok: 2.5, cacheReadPerMTok: 0.2 } as const;

// Mirrors run-eval.ts's BASE_SYSTEM_PROMPT (not imported: run-eval.ts self-executes on import).
const EXTRACTION_SYSTEM_PROMPT = `You extract eligibility rules from real assistance-program source text into a small JSON expression language (a "Criterion" tree).

You will be given a verbatim excerpt and its citation. Call the emit_eligibility_criterion tool exactly once.

Rules:
- Only use facts and values that genuinely appear, or are unambiguously implied, in the excerpt. Do not fill in a plausible-sounding number, percentage, or program name that is not actually stated.
- If the excerpt does not state a clear, complete, decidable rule, use the "manualReview" node instead of guessing. This is a correct, expected answer, not a failure.
- manualReview can be the whole rule, or one leaf inside a larger allOf alongside real criteria you are confident about.
- Set confidence: "low" whenever you are not highly confident.
- Under-claiming is far preferable to over-claiming. A wrong threshold reaches a person in financial crisis as a stated fact; a manualReview reaches a human reviewer first.
- A number in the source is not automatically an eligibility threshold. Check what it actually governs before encoding it.`;

type Pipeline = 'classify-first' | 'direct';
type Split = 'framing' | 'heldout' | 'tuning';

interface RunOptions {
  readonly split: Split;
  readonly pipeline: Pipeline;
  readonly excerpt: ExcerptMode;
  readonly verify: boolean;
  readonly model: string;
  readonly dump: boolean;
}

function parseArgs(argv: readonly string[]): RunOptions {
  let split: Split = 'framing';
  let pipeline: Pipeline = 'classify-first';
  let excerpt: ExcerptMode = 'prose';
  let verify = false;
  let model = DEFAULT_MODEL;
  let dump = false;
  for (const arg of argv) {
    const [key, value] = arg.replace(/^--/, '').split('=');
    if (key === 'split' && (value === 'framing' || value === 'heldout' || value === 'tuning')) split = value;
    else if (key === 'pipeline' && (value === 'classify-first' || value === 'direct')) pipeline = value;
    else if (key === 'excerpt' && (value === 'prose' || value === 'structured')) excerpt = value;
    else if (key === 'verify') verify = value !== 'off';
    else if (key === 'model' && value) model = value;
    else if (key === 'dump') dump = value !== 'off';
    else if (arg.startsWith('--')) {
      console.error(`Unknown flag: ${arg}`);
      process.exit(2);
    }
  }
  return { split, pipeline, excerpt, verify, model, dump };
}

interface PipelineCase {
  readonly id: string;
  readonly citationName: string;
  readonly citationUrl: string;
  readonly expected: 'extract' | 'abstain';
  readonly proseExcerpt: string;
  readonly htmlFixture?: string;
}

function loadCases(split: Split): readonly PipelineCase[] {
  if (split === 'framing') {
    return FRAMING_EVAL_CASES.map((c) => ({
      id: c.id,
      citationName: c.citationName,
      citationUrl: c.citationUrl,
      expected: c.expected,
      proseExcerpt: c.excerpt,
      ...(c.htmlFixture ? { htmlFixture: c.htmlFixture } : {}),
    }));
  }
  return casesInSplit(split).map((c) => ({
    id: c.id,
    citationName: c.citationName,
    citationUrl: c.citationUrl,
    expected: c.expected,
    proseExcerpt: c.excerpt,
  }));
}

function excerptFor(c: PipelineCase, mode: ExcerptMode): { text: string; note: string } {
  if (mode === 'structured' && c.htmlFixture) {
    const html = readFileSync(join(HERE, 'fixtures', c.htmlFixture), 'utf8');
    return { text: renderExcerpt(html, 'structured'), note: 'structured (from fixture)' };
  }
  return { text: c.proseExcerpt, note: mode === 'structured' ? 'prose (no fixture)' : 'prose' };
}

interface Usage {
  input_tokens?: number;
  output_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
}
interface TokenTotals {
  freshInput: number;
  cacheWrite: number;
  cacheRead: number;
  output: number;
}

interface ToolUseBlock {
  readonly type: 'tool_use';
  readonly input: unknown;
}
function isToolUseBlock(b: unknown): b is ToolUseBlock {
  return typeof b === 'object' && b !== null && (b as { type?: unknown }).type === 'tool_use';
}

async function callTool(
  args: {
    apiKey: string;
    model: string;
    system: string;
    userText: string;
    toolName: string;
    toolDescription: string;
    schema: unknown;
  },
  tokens: TokenTotals,
): Promise<unknown> {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': args.apiKey,
      'anthropic-version': ANTHROPIC_VERSION,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: args.model,
      max_tokens: 4096,
      system: [{ type: 'text', text: args.system, cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: args.userText }],
      tools: [
        {
          name: args.toolName,
          description: args.toolDescription,
          input_schema: args.schema,
          cache_control: { type: 'ephemeral' },
        },
      ],
      tool_choice: { type: 'tool', name: args.toolName },
    }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
  const body = (await res.json()) as { content?: unknown[]; usage?: Usage };
  const u = body.usage ?? {};
  tokens.freshInput += u.input_tokens ?? 0;
  tokens.cacheWrite += u.cache_creation_input_tokens ?? 0;
  tokens.cacheRead += u.cache_read_input_tokens ?? 0;
  tokens.output += u.output_tokens ?? 0;
  const toolUse = (body.content ?? []).find(isToolUseBlock);
  if (!toolUse) throw new Error('no tool_use block in response');
  return toolUse.input;
}

type ExtractionOutput = { criterion: Criterion; sourceExcerpt: string; confidence: 'high' | 'low' };
function isExtractionOutput(v: unknown): v is ExtractionOutput {
  return typeof v === 'object' && v !== null && 'criterion' in v && 'confidence' in v;
}

interface Score {
  scored: number;
  skipped: number;
  errors: number;
  correctAbstentions: number;
  dangerousOverclaims: number;
  correctExtractions: number;
  gateFailures: number;
  overCautious: number;
  autoRouted: number;
  verifierRejected: number;
  abstainCases: number;
  extractCases: number;
}

async function run(opts: RunOptions, apiKey: string | undefined, tokens: TokenTotals): Promise<Score> {
  const cases = loadCases(opts.split);
  const s: Score = {
    scored: 0,
    skipped: 0,
    errors: 0,
    correctAbstentions: 0,
    dangerousOverclaims: 0,
    correctExtractions: 0,
    gateFailures: 0,
    overCautious: 0,
    autoRouted: 0,
    verifierRejected: 0,
    abstainCases: cases.filter((c) => c.expected === 'abstain').length,
    extractCases: cases.filter((c) => c.expected === 'extract').length,
  };

  const extractionSystem = `${EXTRACTION_SYSTEM_PROMPT}\n\n${describeEnumFacts()}`;
  const criterionSchema = buildCriterionJsonSchema();

  console.log(
    `\n=== split=${opts.split} pipeline=${opts.pipeline} excerpt=${opts.excerpt} verify=${opts.verify ? 'on' : 'off'} ` +
      `(${cases.length} cases: ${s.abstainCases} abstain, ${s.extractCases} extract) ===`,
  );

  for (const c of cases) {
    if (!apiKey) {
      console.log(`SKIP        ${c.id.padEnd(40)} (no ANTHROPIC_API_KEY)`);
      s.skipped += 1;
      continue;
    }
    try {
      const { text: excerpt, note: excerptNote } = excerptFor(c, opts.excerpt);
      const userText = `Source: ${c.citationName} (${c.citationUrl})\n\nExcerpt [${excerptNote}]:\n"""\n${excerpt}\n"""`;

      // --- Phase A: classify ------------------------------------------------
      if (opts.pipeline === 'classify-first') {
        const classification = await callTool(
          {
            apiKey,
            model: opts.model,
            system: CLASSIFIER_SYSTEM_PROMPT,
            userText,
            toolName: 'classify_excerpt',
            toolDescription: 'Classify what each number in the excerpt governs and what shape the rule is. Do not extract a rule.',
            schema: buildClassifierToolSchema(),
          },
          tokens,
        );
        if (!isClassification(classification)) throw new Error('classifier output malformed');
        if (opts.dump) console.log(`  classify ${c.id}: ${JSON.stringify(classification)}`);
        const decision = decideAutonomy(classification);
        if (!decision.autonomous) {
          s.scored += 1;
          s.autoRouted += 1;
          if (c.expected === 'abstain') {
            s.correctAbstentions += 1;
            console.log(`OK abstain  ${c.id.padEnd(40)} auto-routed: ${decision.reason}`);
          } else {
            s.overCautious += 1;
            console.log(`OVER-CAUT   ${c.id.padEnd(40)} auto-routed but expected extract: ${decision.reason}`);
          }
          continue;
        }
      }

      // --- Phase B: extract -----------------------------------------------
      const extraction = await callTool(
        {
          apiKey,
          model: opts.model,
          system: extractionSystem,
          userText,
          toolName: 'emit_eligibility_criterion',
          toolDescription:
            'Emit the extracted eligibility rule as a Criterion tree, or manualReview if it cannot be extracted precisely.',
          schema: criterionSchema,
        },
        tokens,
      );
      if (!isExtractionOutput(extraction)) throw new Error('extraction output missing required fields');
      if (opts.dump) console.log(`  extract  ${c.id}: ${JSON.stringify(extraction.criterion)}`);
      s.scored += 1;

      const gate = gateCriterion(extraction.criterion);
      if (!gate.ok) {
        s.gateFailures += 1;
        console.log(`GATE-FAIL   ${c.id.padEnd(40)} ${gate.problems.join('; ')}`);
        continue;
      }

      let abstained = extraction.criterion.kind === 'manualReview';

      // --- Phase C: verify by counterexample ----------------------------
      if (opts.verify && !abstained) {
        const cx = await callTool(
          {
            apiKey,
            model: opts.model,
            system: VERIFIER_SYSTEM_PROMPT,
            userText: `${userText}\n\nExtracted rule (JSON):\n${JSON.stringify(extraction.criterion)}`,
            toolName: 'construct_counterexample',
            toolDescription: 'Try to construct someone who satisfies the extracted rule but is not eligible per the excerpt.',
            schema: buildVerifierToolSchema(),
          },
          tokens,
        );
        if (!isCounterexample(cx)) throw new Error('verifier output malformed');
        if (opts.dump) console.log(`  verify   ${c.id}: ${JSON.stringify(cx)}`);
        if (verdictRejects(cx)) {
          abstained = true;
          s.verifierRejected += 1;
          console.log(`VERIFY-REJ  ${c.id.padEnd(40)} dropped scope: ${cx.scopeThatWasDropped}`);
        }
      }

      if (c.expected === 'abstain' && abstained) {
        s.correctAbstentions += 1;
        console.log(`OK abstain  ${c.id}`);
      } else if (c.expected === 'abstain' && !abstained) {
        s.dangerousOverclaims += 1;
        console.log(`DANGEROUS   ${c.id.padEnd(40)} expected abstain, model emitted ${extraction.criterion.kind}`);
      } else if (c.expected === 'extract' && !abstained) {
        s.correctExtractions += 1;
        console.log(`OK extract  ${c.id}`);
      } else {
        s.overCautious += 1;
        console.log(`OVER-CAUT   ${c.id.padEnd(40)} expected an extraction, model abstained`);
      }
    } catch (err) {
      s.errors += 1;
      console.log(`ERROR       ${c.id.padEnd(40)} ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return s;
}

function reportScore(opts: RunOptions, s: Score): void {
  console.log(`\n--- ${opts.split}: the four numbers, reported separately (never blended) ---`);
  console.log(`  Correct abstentions:   ${s.correctAbstentions} / ${s.abstainCases}`);
  console.log(`  Dangerous over-claims: ${s.dangerousOverclaims}${s.dangerousOverclaims > 0 ? '   <-- BLOCKING' : ''}`);
  console.log(`  Correct extractions:   ${s.correctExtractions} / ${s.extractCases}`);
  console.log(`  Gate failures:         ${s.gateFailures}`);
  console.log(
    `  (over-cautious: ${s.overCautious} -- a control routed to manualReview; not dangerous, but the cost of selectivity)`,
  );
  console.log(
    `  (classify auto-routed to manualReview: ${s.autoRouted}; verifier rejections: ${s.verifierRejected}; API errors: ${s.errors})`,
  );
  if (s.skipped > 0) console.log(`  SKIPPED: ${s.skipped} (no API key -- nothing measured)`);
  if (opts.split === 'heldout' && s.dangerousOverclaims > 0) {
    console.log(`\n  ** A single dangerous over-claim on the held-out split is a blocking result, not a percentage. **`);
  }
}

function reportTokens(opts: RunOptions, t: TokenTotals): void {
  const total = t.freshInput + t.cacheWrite + t.cacheRead + t.output;
  if (total === 0) return;
  const per = (n: number, p: number) => (n / 1_000_000) * p;
  const inputCost =
    per(t.freshInput, PRICE.inputPerMTok) + per(t.cacheWrite, PRICE.cacheWritePerMTok) + per(t.cacheRead, PRICE.cacheReadPerMTok);
  const outputCost = per(t.output, PRICE.outputPerMTok);
  const noCache = per(t.freshInput + t.cacheWrite + t.cacheRead, PRICE.inputPerMTok);
  console.log(`\n=== Token cost (model=${opts.model}) ===`);
  console.log(`  fresh ${t.freshInput}  cache-write ${t.cacheWrite}  cache-read ${t.cacheRead}  output ${t.output}`);
  console.log(`  input cost: $${inputCost.toFixed(5)}   (no-cache counterfactual $${noCache.toFixed(5)})`);
  console.log(`  output cost: $${outputCost.toFixed(5)}   total: $${(inputCost + outputCost).toFixed(5)}`);
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const apiKey = process.env.ANTHROPIC_API_KEY;
  console.log(`Model: ${opts.model}`);
  console.log(
    apiKey
      ? 'Live mode: calling the real API.'
      : 'No ANTHROPIC_API_KEY -- every case SKIPPED (reporting SKIPPED, not a fabricated result).',
  );
  const tokens: TokenTotals = { freshInput: 0, cacheWrite: 0, cacheRead: 0, output: 0 };
  const score = await run(opts, apiKey, tokens);

  console.log('\n============ SUMMARY ============');
  reportScore(opts, score);
  reportTokens(opts, tokens);

  if (!apiKey) {
    console.log('\nResult: SKIPPED (no API key). No numbers were measured.');
  } else if (opts.split === 'heldout' && score.dangerousOverclaims > 0) {
    console.log('\nResult: BLOCKING -- a dangerous over-claim occurred on the held-out split.');
    process.exitCode = 1;
  } else {
    console.log('\nResult: measured. Report the four numbers separately.');
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
