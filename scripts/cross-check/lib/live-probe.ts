/**
 * The live `ProbeAsker` for Path B -- a single, fresh Messages-API call.
 *
 * "Fresh" is the whole point (issue #84): a new request with no extraction
 * transcript, no tool-use history, nothing but the source text and the emitted
 * rule. It reuses scripts/agentic-extract's `ModelClient` seam and its
 * key-gated `AnthropicModelClient` (no `@anthropic-ai/sdk` dependency, matching
 * the rest of scripts/), so with no ANTHROPIC_API_KEY this throws
 * `MissingApiKeyError` and the caller reports SKIPPED rather than a fabricated
 * result.
 *
 * There is exactly one tool and one turn. The model either calls
 * `report_exclusion` or it does not; either way we read one answer and stop.
 */
import { MissingApiKeyError } from '../../program-benchmark/lib/extractor.ts';
import { AnthropicModelClient } from '../../agentic-extract/lib/anthropic-client.ts';
import type { ModelClient } from '../../agentic-extract/lib/model-client.ts';
import { toolUseBlocks } from '../../agentic-extract/lib/model-client.ts';
import {
  PROBE_SYSTEM_PROMPT,
  buildProbeUserMessage,
  type ProbeAnswer,
  type ProbeAsker,
  type ProbeQuestion,
} from './exclusion-probe.ts';

const REPORT_TOOL = {
  name: 'report_exclusion',
  description:
    'Report the result of the exclusion check. Call this exactly once. If the source names someone ' +
    'as eligible whom the rule would exclude, set found=true and fill in who they are and the exact ' +
    'sentence from the source. Otherwise set found=false.',
  input_schema: {
    type: 'object',
    properties: {
      found: {
        type: 'boolean',
        description: 'True iff the source states someone is eligible whom the rule would exclude or fail to confirm.',
      },
      excluded_person: {
        type: 'string',
        description: 'Concrete description of that person or household (e.g. "an SSI recipient with income above 200% FPL"). Empty when found=false.',
      },
      quoted_span: {
        type: 'string',
        description: 'The verbatim sentence from the SOURCE TEXT that says that person is eligible. Copy it exactly. Empty when found=false.',
      },
      rationale: {
        type: 'string',
        description: 'One sentence: why the rule excludes them.',
      },
    },
    required: ['found'],
  },
} as const;

interface ReportInput {
  readonly found?: unknown;
  readonly excluded_person?: unknown;
  readonly quoted_span?: unknown;
  readonly rationale?: unknown;
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v : null;
}

/** Parse the model's single tool call into a `ProbeAnswer`. Defensive: a missing
 *  or malformed call is read as "found nobody", never as an error. */
export function parseProbeResponse(input: unknown): ProbeAnswer {
  const i = (input ?? {}) as ReportInput;
  if (i.found !== true) {
    return { excludedPerson: null, quotedSpan: null, rationale: str(i.rationale) ?? undefined };
  }
  return {
    excludedPerson: str(i.excluded_person),
    quotedSpan: str(i.quoted_span),
    rationale: str(i.rationale) ?? undefined,
  };
}

export interface LiveProbeOptions {
  /** Inject a scripted client in tests; omit for the live key-gated client. */
  readonly model?: ModelClient;
  readonly hasApiKey?: boolean;
}

export function liveExclusionProbe(opts: LiveProbeOptions = {}): ProbeAsker {
  return async (q: ProbeQuestion): Promise<ProbeAnswer> => {
    if (!opts.model && !opts.hasApiKey) throw new MissingApiKeyError();
    const model = opts.model ?? new AnthropicModelClient();

    const res = await model.createMessage({
      system: [{ type: 'text', text: PROBE_SYSTEM_PROMPT }],
      messages: [{ role: 'user', content: buildProbeUserMessage(q) }],
      tools: [REPORT_TOOL],
    });

    const calls = toolUseBlocks(res).filter((b) => b.name === REPORT_TOOL.name);
    if (calls.length === 0) return { excludedPerson: null, quotedSpan: null };
    return parseProbeResponse(calls[calls.length - 1]!.input);
  };
}
