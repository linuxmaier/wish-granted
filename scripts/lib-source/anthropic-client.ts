/**
 * The live `ModelClient` -- raw `fetch` against the Messages API, no
 * `@anthropic-ai/sdk` dependency (same call as
 * scripts/llm-extraction/run-eval.ts, for the same reason: zero new deps,
 * matching the rest of scripts/; a production ingestion pipeline should use the
 * SDK).
 *
 * Model id, API version string and prompt-caching semantics are taken from
 * scripts/llm-extraction/run-eval.ts and the `claude-api` skill, NOT from
 * memory:
 *   - `claude-sonnet-5` -- the same model run-eval.ts measures and the one
 *     docs/archive/eligibility-extraction.md Section 6.1 prices (cost.ts::PRICE). The
 *     coordinator can override with AGENTIC_EXTRACT_MODEL.
 *   - `anthropic-version: 2023-06-01`.
 *   - `cache_control: { type: 'ephemeral' }` breakpoints are set by the caller
 *     (agent.ts) on the last system block and the last tool; render order is
 *     tools -> system -> messages, so the ~large tool list + system prefix is
 *     the high-value cache prefix and the growing message list stays after it.
 *
 * Constructing this class makes NO network call. Only `createMessage` does, and
 * it throws `MissingApiKeyError` when `ANTHROPIC_API_KEY` is absent so the
 * harness reports SKIPPED rather than a fabricated result.
 */
import { MissingApiKeyError } from './errors.ts';
import type { ModelClient, ModelRequest, ModelResponse, ResponseBlock } from './model-client.ts';

const DEFAULT_MODEL = 'claude-sonnet-5';
const ANTHROPIC_VERSION = '2023-06-01';
const ENDPOINT = 'https://api.anthropic.com/v1/messages';

export interface AnthropicClientOptions {
  readonly model?: string;
  readonly maxTokens?: number;
  /** Injectable for a dry-run check; defaults to the real global fetch. */
  readonly fetchImpl?: typeof fetch;
}

export class AnthropicModelClient implements ModelClient {
  private readonly model: string;
  private readonly maxTokens: number;
  private readonly fetchImpl: typeof fetch;

  constructor(opts: AnthropicClientOptions = {}) {
    this.model = opts.model ?? process.env.AGENTIC_EXTRACT_MODEL ?? DEFAULT_MODEL;
    this.maxTokens = opts.maxTokens ?? 4096;
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  modelId(): string {
    return this.model;
  }

  async createMessage(req: ModelRequest): Promise<ModelResponse> {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new MissingApiKeyError();

    const res = await this.fetchImpl(ENDPOINT, {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': ANTHROPIC_VERSION,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: this.model,
        max_tokens: this.maxTokens,
        system: req.system,
        messages: req.messages,
        tools: req.tools,
        tool_choice: { type: 'auto' },
      }),
    });

    if (!res.ok) {
      throw new Error(`Anthropic API HTTP ${res.status}: ${await res.text()}`);
    }
    const body = (await res.json()) as {
      stop_reason?: string;
      content?: ResponseBlock[];
      usage?: ModelResponse['usage'];
    };
    return {
      stopReason: body.stop_reason ?? 'end_turn',
      content: body.content ?? [],
      usage: body.usage ?? {},
    };
  }
}
