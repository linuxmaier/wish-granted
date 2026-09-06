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
 * Routing knobs for decideAutonomy() -- the #62 threshold sweep. All default to
 * the PR #63 behaviour:
 *   --confidence-gate=on|off   require the categorical `confidence === 'high'` gate
 *   --min-confidence=N         require the numeric confidenceScore >= N (0 disables)
 *   --scope-gate=on|off        route to manualReview on any scopeSignal
 *   --figures-gate=on|off      require every figure to govern an eligibility ceiling
 *   --shapes=a,b,c             rule shapes allowed onto the auto-extract path
 *   --sweep                    classify each case ONCE, then score a grid of
 *                              routing configs against the cached classifications
 *                              (only the extractor is re-run, memoised per case)
 *
 *   npm run eval:llm-framing
 *   npm run eval:llm-framing -- --split=tuning --sweep --verify
 *   npm run eval:llm-framing -- --split=tuning --confidence-gate=off --min-confidence=60
 *   npm run eval:llm-framing -- --split=framing --excerpt=structured --sweep
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
  DEFAULT_AUTONOMY_CONFIG,
  RULE_SHAPES,
  type AutonomyConfig,
  type Classification,
  type RuleShape,
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
  /** Routing knobs for decideAutonomy() -- the #62 threshold sweep (see classify-role.ts). */
  readonly autonomy: AutonomyConfig;
  /**
   * Sweep mode: classify every case once, then evaluate a grid of routing
   * configs against those cached classifications (only the extractor is re-run,
   * memoised per case). Prints one table row per config.
   */
  readonly sweep: boolean;
}

function onOff(value: string | undefined, dflt: boolean): boolean {
  if (value === 'on') return true;
  if (value === 'off') return false;
  return dflt;
}

function parseArgs(argv: readonly string[]): RunOptions {
  let split: Split = 'framing';
  let pipeline: Pipeline = 'classify-first';
  let excerpt: ExcerptMode = 'prose';
  let verify = false;
  let model = DEFAULT_MODEL;
  let dump = false;
  let sweep = false;
  let requireHighConfidence = DEFAULT_AUTONOMY_CONFIG.requireHighConfidence;
  let minConfidenceScore = DEFAULT_AUTONOMY_CONFIG.minConfidenceScore;
  let blockOnScopeSignal = DEFAULT_AUTONOMY_CONFIG.blockOnScopeSignal;
  let requireAllFiguresCeiling = DEFAULT_AUTONOMY_CONFIG.requireAllFiguresCeiling;
  let autoExtractableShapes = new Set(DEFAULT_AUTONOMY_CONFIG.autoExtractableShapes);
  for (const arg of argv) {
    const [key, value] = arg.replace(/^--/, '').split('=');
    if (key === 'split' && (value === 'framing' || value === 'heldout' || value === 'tuning')) split = value;
    else if (key === 'pipeline' && (value === 'classify-first' || value === 'direct')) pipeline = value;
    else if (key === 'excerpt' && (value === 'prose' || value === 'structured')) excerpt = value;
    else if (key === 'verify') verify = value !== 'off';
    else if (key === 'model' && value) model = value;
    else if (key === 'dump') dump = value !== 'off';
    else if (key === 'sweep') sweep = value !== 'off';
    else if (key === 'confidence-gate') requireHighConfidence = onOff(value, requireHighConfidence);
    else if (key === 'min-confidence') minConfidenceScore = Number(value);
    else if (key === 'scope-gate') blockOnScopeSignal = onOff(value, blockOnScopeSignal);
    else if (key === 'figures-gate') requireAllFiguresCeiling = onOff(value, requireAllFiguresCeiling);
    else if (key === 'shapes' && value) {
      const shapes = value.split(',').map((s) => s.trim()) as RuleShape[];
      const bad = shapes.filter((s) => !(RULE_SHAPES as readonly string[]).includes(s));
      if (bad.length > 0) {
        console.error(`Unknown rule shape(s): ${bad.join(', ')}. Valid: ${RULE_SHAPES.join(', ')}`);
        process.exit(2);
      }
      autoExtractableShapes = new Set(shapes);
    } else if (arg.startsWith('--')) {
      console.error(`Unknown flag: ${arg}`);
      process.exit(2);
    }
  }
  if (!Number.isFinite(minConfidenceScore) || minConfidenceScore < 0 || minConfidenceScore > 100) {
    console.error('--min-confidence must be a number 0-100');
    process.exit(2);
  }
  return {
    split,
    pipeline,
    excerpt,
    verify,
    model,
    dump,
    sweep,
    autonomy: {
      requireHighConfidence,
      minConfidenceScore,
      blockOnScopeSignal,
      requireAllFiguresCeiling,
      autoExtractableShapes,
    },
  };
}

interface PipelineCase {
  readonly id: string;
  readonly citationName: string;
  readonly citationUrl: string;
  readonly expected: 'extract' | 'abstain';
  readonly proseExcerpt: string;
  readonly htmlFixture?: string;
  /** Hand-authored ground truth for `expected: 'extract'` cases (never used for scoring the four numbers -- only the informational target-match line). */
  readonly targetCriterion?: Criterion;
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
      ...(c.targetCriterion ? { targetCriterion: c.targetCriterion } : {}),
    }));
  }
  return casesInSplit(split).map((c) => ({
    id: c.id,
    citationName: c.citationName,
    citationUrl: c.citationUrl,
    expected: c.expected,
    proseExcerpt: c.excerpt,
    ...(c.targetCriterion ? { targetCriterion: c.targetCriterion } : {}),
  }));
}

/**
 * Structural equality of two Criterion trees, ignoring `label`, `manualReview`
 * note prose, and the order of `allOf` / `anyOf` children. Used only for the
 * informational "extractions matching hand-authored target" line -- the four
 * headline numbers never depend on it.
 */
function canonicalCriterion(c: unknown): unknown {
  if (Array.isArray(c)) return c.map(canonicalCriterion);
  if (c === null || typeof c !== 'object') return c;
  const o = c as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(o).sort()) {
    if (k === 'label') continue;
    if (k === 'note' && o.kind === 'manualReview') continue;
    out[k] = canonicalCriterion(o[k]);
  }
  if ((o.kind === 'allOf' || o.kind === 'anyOf') && Array.isArray(o.of)) {
    out.of = (o.of as unknown[])
      .map(canonicalCriterion)
      .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  }
  return out;
}

function criterionShapeEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(canonicalCriterion(a)) === JSON.stringify(canonicalCriterion(b));
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
    maxTokens?: number;
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
      max_tokens: args.maxTokens ?? 4096,
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
  /** Of the correct extractions, how many match the hand-authored targetCriterion in shape (informational only). */
  targetMatches: number;
  /** How many extract-cases have a targetCriterion at all (denominator for targetMatches). */
  targetCases: number;
  /** Which gate suppressed each non-autonomous routing, for the two-trigger report. */
  triggerConfidence: number; // categorical OR numeric score gate
  triggerScope: number;
  triggerShapeOrFigure: number;
  /** Autonomous, reached the extractor, and the extractor itself abstained. */
  extractorAbstained: number;
}

function emptyScore(cases: readonly PipelineCase[]): Score {
  return {
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
    targetMatches: 0,
    targetCases: cases.filter((c) => c.expected === 'extract' && c.targetCriterion).length,
    triggerConfidence: 0,
    triggerScope: 0,
    triggerShapeOrFigure: 0,
    extractorAbstained: 0,
  };
}

const EXTRACTION_SYSTEM = `${EXTRACTION_SYSTEM_PROMPT}\n\n${describeEnumFacts()}`;

interface Caches {
  readonly classify: Map<string, Classification>;
  readonly extract: Map<string, ExtractionOutput>;
  readonly verify: Map<string, boolean>;
}
function newCaches(): Caches {
  return { classify: new Map(), extract: new Map(), verify: new Map() };
}

function userTextFor(c: PipelineCase, mode: ExcerptMode): string {
  const { text, note } = excerptFor(c, mode);
  return `Source: ${c.citationName} (${c.citationUrl})\n\nExcerpt [${note}]:\n"""\n${text}\n"""`;
}

async function classifyOne(
  c: PipelineCase,
  opts: RunOptions,
  apiKey: string,
  tokens: TokenTotals,
  caches: Caches,
): Promise<Classification> {
  const cached = caches.classify.get(c.id);
  if (cached) return cached;
  const out = await callTool(
    {
      apiKey,
      model: opts.model,
      system: CLASSIFIER_SYSTEM_PROMPT,
      userText: userTextFor(c, opts.excerpt),
      toolName: 'classify_excerpt',
      toolDescription: 'Classify what each number in the excerpt governs and what shape the rule is. Do not extract a rule.',
      schema: buildClassifierToolSchema(),
      maxTokens: 8192,
    },
    tokens,
  );
  const parsed = isClassification(out) ? out : FAIL_CLOSED_CLASSIFICATION;
  caches.classify.set(c.id, parsed);
  return parsed;
}

/** A malformed / truncated classification fails closed: treat it as an un-routable excerpt. */
const FAIL_CLOSED_CLASSIFICATION: Classification = {
  numericFigures: [],
  ruleShape: 'negation-or-no-rule-stated',
  scopeSignals: ['classifier output could not be parsed -- failing closed to manualReview'],
  confidence: 'low',
  confidenceScore: 0,
};

async function extractOne(
  c: PipelineCase,
  opts: RunOptions,
  apiKey: string,
  tokens: TokenTotals,
  caches: Caches,
): Promise<ExtractionOutput> {
  const cached = caches.extract.get(c.id);
  if (cached) return cached;
  const out = await callTool(
    {
      apiKey,
      model: opts.model,
      system: EXTRACTION_SYSTEM,
      userText: userTextFor(c, opts.excerpt),
      toolName: 'emit_eligibility_criterion',
      toolDescription:
        'Emit the extracted eligibility rule as a Criterion tree, or manualReview if it cannot be extracted precisely.',
      schema: buildCriterionJsonSchema(),
    },
    tokens,
  );
  if (!isExtractionOutput(out)) throw new Error('extraction output missing required fields');
  caches.extract.set(c.id, out);
  return out;
}

async function verifyOne(
  c: PipelineCase,
  criterion: Criterion,
  opts: RunOptions,
  apiKey: string,
  tokens: TokenTotals,
  caches: Caches,
): Promise<boolean> {
  const cached = caches.verify.get(c.id);
  if (cached !== undefined) return cached;
  const cx = await callTool(
    {
      apiKey,
      model: opts.model,
      system: VERIFIER_SYSTEM_PROMPT,
      userText: `${userTextFor(c, opts.excerpt)}\n\nExtracted rule (JSON):\n${JSON.stringify(criterion)}`,
      toolName: 'construct_counterexample',
      toolDescription: 'Try to construct someone who satisfies the extracted rule but is not eligible per the excerpt.',
      schema: buildVerifierToolSchema(),
    },
    tokens,
  );
  if (!isCounterexample(cx)) throw new Error('verifier output malformed');
  const rejects = verdictRejects(cx);
  caches.verify.set(c.id, rejects);
  return rejects;
}

/**
 * One full pipeline pass over a split with a fixed routing config. All model
 * calls go through `caches`, so a sweep over many configs re-runs only the
 * routing arithmetic and any not-yet-seen extraction.
 */
async function evaluate(
  cases: readonly PipelineCase[],
  opts: RunOptions,
  cfg: AutonomyConfig,
  apiKey: string,
  tokens: TokenTotals,
  caches: Caches,
  log: (line: string) => void,
): Promise<Score> {
  const s = emptyScore(cases);
  for (const c of cases) {
    try {
      let classification: Classification | null = null;
      if (opts.pipeline === 'classify-first') {
        classification = await classifyOne(c, opts, apiKey, tokens, caches);
        if (classification === FAIL_CLOSED_CLASSIFICATION) {
          log(`CLASSIFY-FAIL ${c.id.padEnd(40)} malformed classifier output -- failing closed to manualReview`);
        }
        if (opts.dump) log(`  classify ${c.id}: ${JSON.stringify(classification)}`);
        const decision = decideAutonomy(classification, cfg);
        if (!decision.autonomous) {
          s.scored += 1;
          s.autoRouted += 1;
          if (decision.trigger === 'confidence-categorical' || decision.trigger === 'confidence-score') s.triggerConfidence += 1;
          else if (decision.trigger === 'scope-signal') s.triggerScope += 1;
          else s.triggerShapeOrFigure += 1;
          if (c.expected === 'abstain') {
            s.correctAbstentions += 1;
            log(`OK abstain  ${c.id.padEnd(42)} auto-routed [${decision.trigger}]: ${decision.reason}`);
          } else {
            s.overCautious += 1;
            log(`OVER-CAUT   ${c.id.padEnd(42)} routed, expected extract [${decision.trigger}]: ${decision.reason}`);
          }
          continue;
        }
      }

      const extraction = await extractOne(c, opts, apiKey, tokens, caches);
      if (opts.dump) log(`  extract  ${c.id}: ${JSON.stringify(extraction.criterion)}`);
      s.scored += 1;

      const gate = gateCriterion(extraction.criterion);
      if (!gate.ok) {
        s.gateFailures += 1;
        log(`GATE-FAIL   ${c.id.padEnd(42)} ${gate.problems.join('; ')}`);
        continue;
      }

      let abstained = extraction.criterion.kind === 'manualReview';
      if (abstained && classification) s.extractorAbstained += 1;

      if (opts.verify && !abstained) {
        const rejects = await verifyOne(c, extraction.criterion, opts, apiKey, tokens, caches);
        if (opts.dump) log(`  verify   ${c.id}: rejects=${rejects}`);
        if (rejects) {
          abstained = true;
          s.verifierRejected += 1;
          log(`VERIFY-REJ  ${c.id.padEnd(42)} verifier built a counterexample`);
        }
      }

      if (c.expected === 'abstain' && abstained) {
        s.correctAbstentions += 1;
        log(`OK abstain  ${c.id}`);
      } else if (c.expected === 'abstain' && !abstained) {
        s.dangerousOverclaims += 1;
        log(`DANGEROUS   ${c.id.padEnd(42)} expected abstain, model emitted ${extraction.criterion.kind}`);
      } else if (c.expected === 'extract' && !abstained) {
        s.correctExtractions += 1;
        const matched = c.targetCriterion ? criterionShapeEqual(extraction.criterion, c.targetCriterion) : false;
        if (matched) s.targetMatches += 1;
        log(`OK extract  ${c.id.padEnd(42)} ${c.targetCriterion ? (matched ? 'matches target' : 'DIFFERS from hand-authored target') : ''}`);
      } else {
        s.overCautious += 1;
        log(`OVER-CAUT   ${c.id.padEnd(42)} expected an extraction, model abstained`);
      }
    } catch (err) {
      s.errors += 1;
      log(`ERROR       ${c.id.padEnd(42)} ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return s;
}

function describeConfig(cfg: AutonomyConfig): string {
  const shapes = [...cfg.autoExtractableShapes].join(',');
  return (
    `highConf=${cfg.requireHighConfidence ? 'on' : 'off'} minScore=${cfg.minConfidenceScore} ` +
    `scopeGate=${cfg.blockOnScopeSignal ? 'on' : 'off'} figuresGate=${cfg.requireAllFiguresCeiling ? 'on' : 'off'} shapes=[${shapes}]`
  );
}

async function run(opts: RunOptions, apiKey: string | undefined, tokens: TokenTotals): Promise<Score> {
  const cases = loadCases(opts.split);
  if (!apiKey) {
    for (const c of cases) console.log(`SKIP        ${c.id.padEnd(42)} (no ANTHROPIC_API_KEY)`);
    const s = emptyScore(cases);
    s.skipped = cases.length;
    return s;
  }
  console.log(
    `\n=== split=${opts.split} pipeline=${opts.pipeline} excerpt=${opts.excerpt} verify=${opts.verify ? 'on' : 'off'} ` +
      `(${cases.length} cases: ${cases.filter((c) => c.expected === 'abstain').length} abstain, ` +
      `${cases.filter((c) => c.expected === 'extract').length} extract) ===`,
  );
  console.log(`    routing: ${describeConfig(opts.autonomy)}`);
  return evaluate(cases, opts, opts.autonomy, apiKey, tokens, newCaches(), (l) => console.log(l));
}

/** The #62 confidence-threshold sweep. Confidence is the primary axis; a few ablation rows isolate the scope-signal and figure-role gates. */
function sweepConfigs(base: AutonomyConfig): ReadonlyArray<{ label: string; cfg: AutonomyConfig }> {
  const scoreRow = (n: number): { label: string; cfg: AutonomyConfig } => ({
    label: `score>=${n}`,
    cfg: { ...base, requireHighConfidence: false, minConfidenceScore: n, blockOnScopeSignal: true, requireAllFiguresCeiling: true },
  });
  return [
    { label: 'PR#63 default (highConf on)', cfg: { ...base } },
    scoreRow(0),
    scoreRow(50),
    scoreRow(60),
    scoreRow(70),
    scoreRow(80),
    scoreRow(90),
    {
      label: 'score>=60, scope gate OFF',
      cfg: { ...base, requireHighConfidence: false, minConfidenceScore: 60, blockOnScopeSignal: false, requireAllFiguresCeiling: true },
    },
    {
      label: 'score>=60, figures gate OFF',
      cfg: { ...base, requireHighConfidence: false, minConfidenceScore: 60, blockOnScopeSignal: true, requireAllFiguresCeiling: false },
    },
    {
      label: 'all gates OFF except scope',
      cfg: { ...base, requireHighConfidence: false, minConfidenceScore: 0, blockOnScopeSignal: true, requireAllFiguresCeiling: false },
    },
  ];
}

async function runSweep(opts: RunOptions, apiKey: string | undefined, tokens: TokenTotals): Promise<void> {
  const cases = loadCases(opts.split);
  if (!apiKey) {
    console.log('No ANTHROPIC_API_KEY -- sweep SKIPPED, nothing measured.');
    return;
  }
  const caches = newCaches();
  const rows = sweepConfigs(opts.autonomy);
  const abstain = cases.filter((c) => c.expected === 'abstain').length;
  const extract = cases.filter((c) => c.expected === 'extract').length;
  console.log(
    `\n=== SWEEP  split=${opts.split} excerpt=${opts.excerpt} verify=${opts.verify ? 'on' : 'off'} model=${opts.model} ` +
      `(${cases.length} cases: ${abstain} abstain, ${extract} extract) ===`,
  );
  const results: Array<{ label: string; s: Score }> = [];
  for (const { label, cfg } of rows) {
    const s = await evaluate(cases, opts, cfg, apiKey, tokens, caches, () => {});
    results.push({ label, s });
  }

  const pad = (v: string | number, n: number) => String(v).padEnd(n);
  console.log(
    `\n${pad('config', 30)} ${pad('correct-abst', 13)} ${pad('DANGER', 7)} ${pad('correct-extr', 13)} ` +
      `${pad('gate-fail', 10)} ${pad('tgt-match', 10)} ${pad('over-caut', 10)} trig(conf/scope/shape)`,
  );
  for (const { label, s } of results) {
    console.log(
      `${pad(label, 30)} ${pad(`${s.correctAbstentions}/${s.abstainCases}`, 13)} ${pad(s.dangerousOverclaims, 7)} ` +
        `${pad(`${s.correctExtractions}/${s.extractCases}`, 13)} ${pad(s.gateFailures, 10)} ` +
        `${pad(`${s.targetMatches}/${s.targetCases}`, 10)} ${pad(s.overCautious, 10)} ` +
        `${s.triggerConfidence}/${s.triggerScope}/${s.triggerShapeOrFigure}`,
    );
  }
  console.log(
    '\nColumns: correct-abst = correct abstentions / abstain cases; DANGER = dangerous over-claims (blocking if >0 on heldout); ' +
      'correct-extr = non-abstained extractions on extract cases; tgt-match = of those, how many match the hand-authored Criterion in shape; ' +
      'over-caut = extract cases routed to manualReview; trig = which gate suppressed routing (confidence / scope-signal / shape-or-figure).',
  );
}

function reportScore(opts: RunOptions, s: Score): void {
  console.log(`\n--- ${opts.split}: the four numbers, reported separately (never blended) ---`);
  console.log(`  Correct abstentions:   ${s.correctAbstentions} / ${s.abstainCases}`);
  console.log(`  Dangerous over-claims: ${s.dangerousOverclaims}${s.dangerousOverclaims > 0 ? '   <-- BLOCKING' : ''}`);
  console.log(`  Correct extractions:   ${s.correctExtractions} / ${s.extractCases}`);
  console.log(`  Gate failures:         ${s.gateFailures}`);
  console.log(
    `  (target-match: ${s.targetMatches} / ${s.targetCases} of the correct extractions match the hand-authored Criterion in shape -- informational)`,
  );
  console.log(
    `  (over-cautious: ${s.overCautious} -- a control routed to manualReview; not dangerous, but the cost of selectivity)`,
  );
  console.log(
    `  (routing triggers -- confidence: ${s.triggerConfidence}, scope-signal: ${s.triggerScope}, shape/figure: ${s.triggerShapeOrFigure}; ` +
      `extractor self-abstained: ${s.extractorAbstained})`,
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

  if (opts.sweep) {
    await runSweep(opts, apiKey, tokens);
    reportTokens(opts, tokens);
    console.log(apiKey ? '\nResult: swept. Report the table.' : '\nResult: SKIPPED (no API key).');
    return;
  }

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
