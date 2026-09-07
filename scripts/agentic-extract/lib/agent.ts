/**
 * The agent loop: fetch/navigate/resolve the source, then emit a record or
 * abstain. Pipeline-agnostic about the model (ModelClient) and the network
 * (Fetcher), so the whole loop runs offline in tests with a scripted transcript
 * and a fixture fetcher.
 *
 * Enforcement that does NOT depend on the model behaving:
 *   - gateCriterion (scripts/llm-extraction/schema-gate.ts) -- identical bar to
 *     a hand-authored rule.
 *   - verifyAllSpans -- every provenance quote must appear verbatim on a page
 *     actually fetched this run; the URL recorded is the one that matched.
 *   - a step budget -- exhausting it abstains, never guesses.
 * A failed emit is returned to the model as a tool error so it can fix it or
 * abstain; it never ends the loop with a bad record.
 *
 * Step budget: `DEFAULT_MAX_STEPS` is the ceiling on model turns (each fetch,
 * cross-ref resolve, or emit attempt costs one). PR #72's live run set this to
 * 12 and four multi-page sources abstained on exhaustion -- exactly the sources
 * the design exists to handle (the SeniorCare wizard-of-oz case alone needed
 * four pages, before any cross-reference or emit retry). Raised to 24 and made
 * sweepable from the CLI (`--max-steps=N`) so it can be tuned without a code
 * change. Exhaustion still abstains -- that is the safe behaviour -- but the
 * abstention is tagged `budget-exhausted` (see `AgentRun.abstention`) so a
 * tuning limit is not miscounted as the source stating no rule.
 */
import { gateCriterion } from '../../llm-extraction/schema-gate.ts';
import type { Criterion } from '../../../src/domain/criteria.ts';
import type { ExtractionContext, ExtractionResult } from '../../program-benchmark/lib/extractor.ts';
import { Navigator } from './navigator.ts';
import type { Fetcher } from './fetcher.ts';
import { resolveEcfrSection, detectReferences } from './cross-reference.ts';
import { verifyAllSpans, type SpanSource, type ClaimedSpan } from './provenance.ts';
import { CostMeter, type CostSummary } from './cost.ts';
import { toCandidateRecord, type ExtractedRecord } from './record.ts';
import { buildTools, buildSystemPrompt, TOOL_NAMES } from './tools.ts';
import {
  toolUseBlocks,
  type ModelClient,
  type RequestMessage,
  type ToolResultBlock,
  type ResponseBlock,
} from './model-client.ts';

const PAGE_CHAR_CAP = 24_000;

/**
 * Model-turn ceiling. Was 12 in PR #72's live run, which starved the multi-page
 * sources the agentic path exists for. Sweep it with `--max-steps=N`.
 */
export const DEFAULT_MAX_STEPS = 24;

export interface AgentOptions {
  readonly model: ModelClient;
  readonly fetcher: Fetcher;
  readonly maxSteps?: number;
}

/**
 * Why a top-level abstention happened. `budget-exhausted` means the loop ran
 * out of steps (a tuning signal); `substantive` means the model chose to
 * abstain because the source states no decidable rule (the real safety
 * outcome). Conflating the two hides a tuning problem inside a safety metric.
 */
export type AbstentionKind = 'substantive' | 'budget-exhausted';

export interface AgentRun {
  readonly result: ExtractionResult;
  /** Present only when a record was emitted and accepted. */
  readonly record?: ExtractedRecord;
  readonly cost: CostSummary;
  readonly steps: number;
  readonly pagesVisited: readonly string[];
  /** A short trail of what the loop did, for the CLI report and debugging. */
  readonly trace: readonly string[];
  /** Present only when `result` is an abstention. Distinguishes a tuning
   *  limit (`budget-exhausted`) from a genuine "the source states no rule". */
  readonly abstention?: AbstentionKind;
}

function cap(s: string): string {
  return s.length <= PAGE_CHAR_CAP ? s : `${s.slice(0, PAGE_CHAR_CAP)}\n...[truncated ${s.length - PAGE_CHAR_CAP} chars]`;
}

export async function runAgent(ctx: ExtractionContext, opts: AgentOptions): Promise<AgentRun> {
  const maxSteps = opts.maxSteps ?? DEFAULT_MAX_STEPS;
  const nav = new Navigator(opts.fetcher);
  const cost = new CostMeter();
  const crossRefSources: SpanSource[] = [];
  const pagesVisited: string[] = [];
  const trace: string[] = [];

  const tools = buildTools();
  const system = [
    { type: 'text' as const, text: buildSystemPrompt(), cache_control: { type: 'ephemeral' as const } },
  ];
  const messages: RequestMessage[] = [
    {
      role: 'user',
      content:
        `Program: ${ctx.sourceName} (id: ${ctx.programId})\n` +
        `Source URL: ${ctx.sourceUrl}\n\n` +
        `Fetch this page, navigate as needed, and emit the program's eligibility rule with provenance, or abstain.`,
    },
  ];

  const spanSources = (): SpanSource[] => [
    ...[...nav.store().values()].map((p) => ({ url: p.finalUrl, flat: p.flat })),
    ...crossRefSources,
  ];

  const finishAbstain = (reason: string, steps: number, kind: AbstentionKind = 'substantive'): AgentRun => ({
    result: { abstained: true, reason },
    cost: cost.summary(),
    steps,
    pagesVisited,
    trace,
    abstention: kind,
  });

  type Finalize =
    | { readonly ok: true; readonly record: ExtractedRecord }
    | { readonly ok: false; readonly error: string };

  const tryFinalize = (input: Record<string, unknown>): Finalize => {
    const eligibility = input.eligibility as Criterion | undefined;
    if (!eligibility || typeof eligibility !== 'object' || !('kind' in eligibility)) {
      return { ok: false, error: 'eligibility is not a Criterion node' };
    }
    const gate = gateCriterion(eligibility);
    if (!gate.ok) return { ok: false, error: `schema gate: ${gate.problems.join('; ')}` };

    const rawSpans = Array.isArray(input.provenance) ? (input.provenance as unknown[]) : [];
    const claims: ClaimedSpan[] = rawSpans
      .filter((s): s is Record<string, unknown> => typeof s === 'object' && s !== null)
      .map((s) => ({
        quote: typeof s.quote === 'string' ? s.quote : '',
        ...(typeof s.url === 'string' ? { url: s.url } : {}),
      }));
    if (claims.length === 0) return { ok: false, error: 'no provenance spans supplied' };

    const sources = spanSources();
    if (sources.length === 0) return { ok: false, error: 'no pages were fetched -- cannot verify any provenance' };

    const prov = verifyAllSpans(claims, sources);
    if (!prov.ok) {
      return {
        ok: false,
        error: `provenance failed: ${prov.failures.map((f) => `"${f.quote.slice(0, 60)}" -- ${f.reason}`).join(' | ')}`,
      };
    }

    const howToApply =
      typeof input.howToApplyUrl === 'string' || typeof input.howToApplyPhone === 'string'
        ? {
            ...(typeof input.howToApplyUrl === 'string' ? { url: input.howToApplyUrl } : {}),
            ...(typeof input.howToApplyPhone === 'string' ? { phone: input.howToApplyPhone } : {}),
          }
        : undefined;

    return {
      ok: true,
      record: {
        eligibility,
        provenance: prov.verified,
        ...(typeof input.name === 'string' ? { name: input.name } : {}),
        ...(typeof input.administeredBy === 'string' ? { administeredBy: input.administeredBy } : {}),
        ...(typeof input.summary === 'string' ? { summary: input.summary } : {}),
        ...(typeof input.benefit === 'string' ? { benefit: input.benefit } : {}),
        ...(howToApply ? { howToApply } : {}),
        ...(Array.isArray(input.requiredDocuments)
          ? { requiredDocuments: (input.requiredDocuments as unknown[]).filter((d): d is string => typeof d === 'string') }
          : {}),
        ...(typeof input.notes === 'string' ? { modelNotes: input.notes } : {}),
        pagesVisited: [...pagesVisited],
      },
    };
  };

  let nudged = false;

  for (let step = 1; step <= maxSteps; step += 1) {
    const res = await opts.model.createMessage({ system, messages, tools });
    cost.record(res.usage);

    const uses = toolUseBlocks(res);
    messages.push({ role: 'assistant', content: res.content as ResponseBlock[] });

    if (uses.length === 0) {
      if (nudged) {
        trace.push('model produced no tool call twice -> abstain');
        return finishAbstain('the extractor did not call a tool', step);
      }
      nudged = true;
      messages.push({
        role: 'user',
        content: `Call one of: ${Object.values(TOOL_NAMES).join(', ')}.`,
      });
      continue;
    }

    const toolResults: ToolResultBlock[] = [];
    for (const use of uses) {
      const input = (use.input ?? {}) as Record<string, unknown>;

      if (use.name === TOOL_NAMES.abstain) {
        const reason = typeof input.reason === 'string' ? input.reason : 'no reason given';
        trace.push(`abstain: ${reason}`);
        return finishAbstain(reason, step);
      }

      if (use.name === TOOL_NAMES.emit) {
        const finalize = tryFinalize(input);
        if (finalize.ok) {
          trace.push(`emit_record accepted (${finalize.record.provenance.length} spans)`);
          return {
            result: toCandidateRecord(finalize.record),
            record: finalize.record,
            cost: cost.summary(),
            steps: step,
            pagesVisited,
            trace,
          };
        }
        trace.push(`emit_record rejected: ${finalize.error}`);
        toolResults.push({ type: 'tool_result', tool_use_id: use.id, content: `REJECTED: ${finalize.error}`, is_error: true });
        continue;
      }

      if (use.name === TOOL_NAMES.fetch) {
        const url = typeof input.url === 'string' ? input.url : '';
        const nr = await nav.open(url);
        if (nr.ok) {
          if (!pagesVisited.includes(nr.page.finalUrl)) pagesVisited.push(nr.page.finalUrl);
          const refs = detectReferences(nr.page.flat);
          const refNote = refs.length > 0 ? `\n\nCross-references detected: ${refs.map((r) => r.raw).join('; ')}` : '';
          trace.push(`fetch_page ${url} -> ${nr.page.finalUrl}${nr.page.recovered ? ' (recovered)' : ''}`);
          toolResults.push({
            type: 'tool_result',
            tool_use_id: use.id,
            content:
              `Fetched: ${nr.page.finalUrl}` +
              `${nr.page.format === 'pdf' ? ' (PDF -- read as structured text below; cite THIS url)' : ''}` +
              `${nr.page.redirected ? ' (redirected)' : ''}${nr.page.recovered ? ' (RECOVERED from a dead URL -- confirm this is the right page)' : ''}\n\n` +
              `${cap(nr.page.structured)}${refNote}`,
          });
        } else {
          trace.push(`fetch_page ${url} -> ${nr.reason}`);
          const recoveryHint =
            nr.reason === 'gone'
              ? ` Tried: ${(nr.triedRecovery ?? []).join(', ') || 'nothing'}. Try a corrected URL or abstain.`
              : nr.reason === 'moved-host'
                ? ` Redirected to ${nr.movedTo}. It was fetched anyway; treat with suspicion.`
                : '';
          const movedBody = nr.page ? `\n\n${cap(nr.page.structured)}` : '';
          toolResults.push({
            type: 'tool_result',
            tool_use_id: use.id,
            content: `${nr.reason.toUpperCase()}: ${nr.detail}.${recoveryHint}${movedBody}`,
            is_error: nr.reason !== 'moved-host',
          });
          if (nr.page) {
            if (!pagesVisited.includes(nr.page.finalUrl)) pagesVisited.push(nr.page.finalUrl);
          }
        }
        continue;
      }

      if (use.name === TOOL_NAMES.cfr) {
        const title = Number(input.title);
        const part = Number(input.part);
        const section = typeof input.section === 'string' ? input.section : String(input.section ?? '');
        const date = typeof input.date === 'string' ? input.date : undefined;
        if (!title || !part || !section) {
          toolResults.push({ type: 'tool_result', tool_use_id: use.id, content: 'need title, part and section', is_error: true });
          continue;
        }
        const rr = await resolveEcfrSection(opts.fetcher, { title, part, section, ...(date ? { date } : {}) });
        if (rr.ok) {
          crossRefSources.push({ url: rr.url, flat: rr.flat });
          if (!pagesVisited.includes(rr.url)) pagesVisited.push(rr.url);
          trace.push(`resolve_cfr_reference ${title}/${part}/${section} -> ${rr.url}`);
          toolResults.push({
            type: 'tool_result',
            tool_use_id: use.id,
            content: `Resolved from ${rr.url}\nCite THIS url as provenance for anything below.\n\n${cap(rr.structured)}`,
          });
        } else {
          trace.push(`resolve_cfr_reference failed: ${rr.reason}`);
          toolResults.push({ type: 'tool_result', tool_use_id: use.id, content: `could not resolve: ${rr.reason}`, is_error: true });
        }
        continue;
      }

      if (use.name === TOOL_NAMES.search) {
        trace.push('search_web (stub)');
        toolResults.push({
          type: 'tool_result',
          tool_use_id: use.id,
          content:
            'search_web is not wired in this build. Options: call fetch_page with a corrected URL (try the site root, the program section index, or drop a stale filename), or abstain if you cannot reach the governing text.',
        });
        continue;
      }

      toolResults.push({ type: 'tool_result', tool_use_id: use.id, content: `unknown tool ${use.name}`, is_error: true });
    }

    messages.push({ role: 'user', content: toolResults });
  }

  trace.push(`step budget (${maxSteps}) exhausted -> abstain`);
  return finishAbstain(
    `step budget (${maxSteps}) exhausted without a decidable rule`,
    maxSteps,
    'budget-exhausted',
  );
}
