/**
 * A `ModelClient` that replays a fixed transcript of tool calls. This is how
 * the agent loop is exercised end to end with zero tokens: a test (or the
 * --self-test) writes the exact sequence of tool_use blocks a model would emit
 * for a scenario, and asserts on what the loop does with real fetchers,
 * real structure parsing, the real schema gate, and real provenance checks.
 *
 * It is NOT a model and proves nothing about model behaviour -- only that the
 * machinery around the model is correct. See the PR description's candour note.
 */
import type {
  ModelClient,
  ModelRequest,
  ModelResponse,
  ResponseBlock,
} from './model-client.ts';

export interface ScriptedTurn {
  /** Optional assertion hook -- inspect what the loop sent this turn. */
  readonly expect?: (req: ModelRequest, turnIndex: number) => void;
  /** Text block to include (optional). */
  readonly text?: string;
  /** Tool calls to emit this turn. Omit for a no-tool turn. */
  readonly toolCalls?: readonly { readonly name: string; readonly input: unknown }[];
  /** Usage to report (defaults to a small fixed cost with a cache read). */
  readonly usage?: ModelResponse['usage'];
}

export class ScriptedModelClient implements ModelClient {
  private turn = 0;
  readonly requests: ModelRequest[] = [];
  private readonly script: readonly ScriptedTurn[];

  constructor(script: readonly ScriptedTurn[]) {
    this.script = script;
  }

  turnsUsed(): number {
    return this.turn;
  }

  async createMessage(req: ModelRequest): Promise<ModelResponse> {
    this.requests.push(req);
    const t = this.script[this.turn];
    if (!t) throw new Error(`ScriptedModelClient: no scripted turn ${this.turn} (loop ran longer than the script)`);
    this.turn += 1;
    t.expect?.(req, this.turn - 1);

    const content: ResponseBlock[] = [];
    if (t.text) content.push({ type: 'text', text: t.text });
    for (let i = 0; i < (t.toolCalls?.length ?? 0); i += 1) {
      const call = t.toolCalls![i]!;
      content.push({ type: 'tool_use', id: `call_${this.turn}_${i}`, name: call.name, input: call.input });
    }
    return {
      stopReason: t.toolCalls && t.toolCalls.length > 0 ? 'tool_use' : 'end_turn',
      content,
      usage: t.usage ?? {
        input_tokens: 400,
        output_tokens: 120,
        cache_read_input_tokens: 3500,
        cache_creation_input_tokens: 0,
      },
    };
  }
}
