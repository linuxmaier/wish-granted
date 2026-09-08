/**
 * The seam between the agent loop and Claude. `ModelClient` is a one-method
 * interface so every test drives the loop with a scripted transcript and spends
 * zero tokens; the live implementation is anthropic-client.ts.
 *
 * The shapes are a deliberately small subset of the Messages API -- only what
 * the loop uses. They are not the SDK's types (this repo has no SDK dependency,
 * matching the rest of scripts/ -- see scripts/llm-extraction/run-eval.ts).
 */
import type { ModelUsage } from './cost.ts';

export interface TextBlock {
  readonly type: 'text';
  readonly text: string;
}
export interface ToolUseBlock {
  readonly type: 'tool_use';
  readonly id: string;
  readonly name: string;
  readonly input: unknown;
}
export type ResponseBlock = TextBlock | ToolUseBlock;

export interface ToolResultBlock {
  readonly type: 'tool_result';
  readonly tool_use_id: string;
  readonly content: string;
  readonly is_error?: boolean;
}
export interface UserContentText {
  readonly type: 'text';
  readonly text: string;
}
export type RequestMessage =
  | { readonly role: 'user'; readonly content: string | readonly (UserContentText | ToolResultBlock)[] }
  | { readonly role: 'assistant'; readonly content: readonly ResponseBlock[] };

export interface ToolDef {
  readonly name: string;
  readonly description: string;
  readonly input_schema: unknown;
  readonly cache_control?: { readonly type: 'ephemeral' };
}

export interface SystemBlock {
  readonly type: 'text';
  readonly text: string;
  readonly cache_control?: { readonly type: 'ephemeral' };
}

export interface ModelRequest {
  readonly system: readonly SystemBlock[];
  readonly messages: readonly RequestMessage[];
  readonly tools: readonly ToolDef[];
}

export interface ModelResponse {
  readonly stopReason: 'tool_use' | 'end_turn' | 'max_tokens' | string;
  readonly content: readonly ResponseBlock[];
  readonly usage: ModelUsage;
}

export interface ModelClient {
  createMessage(req: ModelRequest): Promise<ModelResponse>;
}

export function toolUseBlocks(res: ModelResponse): ToolUseBlock[] {
  return res.content.filter((b): b is ToolUseBlock => b.type === 'tool_use');
}
