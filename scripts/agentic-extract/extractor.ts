/**
 * The #66 seam implementation for the agentic path (#67).
 *
 * `agenticExtractor()` returns an `Extractor` (scripts/program-benchmark/lib/extractor.ts):
 * given a source URL + context it drives the agent loop and returns a
 * `CandidateRecord` or an `Abstention`. With no ANTHROPIC_API_KEY it throws
 * `MissingApiKeyError` -> the benchmark reports SKIPPED, never a fabricated
 * result.
 *
 * Everything is injectable so the benchmark, the CLI, and the offline test
 * suite share one code path:
 *   - `model`   -- omit for the live AnthropicModelClient (needs the key at
 *                  call time); inject a scripted client in tests.
 *   - `fetcher` -- omit for the live fetcher (robots + hard-deny + Chrome UA);
 *                  inject a fixture fetcher in tests.
 */
import type { Extractor, ExtractionContext } from '../program-benchmark/lib/extractor.ts';
import { MissingApiKeyError } from '../program-benchmark/lib/extractor.ts';
import { AnthropicModelClient } from './lib/anthropic-client.ts';
import { createLiveFetcher, type Fetcher } from './lib/fetcher.ts';
import type { ModelClient } from './lib/model-client.ts';
import { runAgent, type AgentRun } from './lib/agent.ts';

export interface AgenticExtractorOptions {
  readonly model?: ModelClient;
  readonly fetcher?: Fetcher;
  readonly maxSteps?: number;
  /** #76: allow a headless-browser render when a page reduces to nothing and the
   *  deterministic form-shell unwrap did not fix it. Off by default. */
  readonly allowBrowserRender?: boolean;
  /** Called with the full run (cost, trace, provenance) after each source. */
  readonly onRun?: (ctx: ExtractionContext, run: AgentRun) => void;
}

export function agenticExtractor(opts: AgenticExtractorOptions = {}): Extractor {
  return async (ctx) => {
    // The live path needs a key; a scripted model in tests does not.
    if (!opts.model && !ctx.hasApiKey) throw new MissingApiKeyError();

    const model = opts.model ?? new AnthropicModelClient();
    const fetcher = opts.fetcher ?? createLiveFetcher();

    const run = await runAgent(ctx, {
      model,
      fetcher,
      ...(opts.maxSteps !== undefined ? { maxSteps: opts.maxSteps } : {}),
      ...(opts.allowBrowserRender ? { allowBrowserRender: true } : {}),
    });
    opts.onRun?.(ctx, run);
    return run.result;
  };
}
