import type {
  AnthropicTool,
  OpenAiFunctionTool,
} from 'maplibre-style-tools/capabilities';

export type OpenAiToolCall = {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
};
export type OpenAiChatMessage = {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_calls?: OpenAiToolCall[];
  tool_call_id?: string;
};
export type AnthropicContentBlock =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: unknown }
  | { type: 'tool_result'; tool_use_id: string; content: string; is_error?: boolean };
export type AnthropicChatMessage = {
  role: 'user' | 'assistant';
  content: string | AnthropicContentBlock[];
};

const endpoint = (baseUrl: string, path: string): string =>
  `${baseUrl.replace(/\/+$/u, '')}${path}`;

const failedResponse = async (label: string, response: Response): Promise<never> => {
  throw new Error(`${label} ${response.status}: ${(await response.text()).slice(0, 300)}`);
};

export const requestOpenAiCompletion = async (options: {
  readonly baseUrl: string;
  readonly apiKey: string;
  readonly model: string;
  readonly messages: readonly OpenAiChatMessage[];
  readonly tools: readonly OpenAiFunctionTool[];
  readonly maxCompletionTokens: number;
}): Promise<{ message: OpenAiChatMessage; finishReason?: string }> => {
  const response = await fetch(endpoint(options.baseUrl, '/chat/completions'), {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${options.apiKey}`,
    },
    body: JSON.stringify({
      model: options.model,
      messages: options.messages,
      tools: options.tools,
      tool_choice: 'auto',
      max_completion_tokens: options.maxCompletionTokens,
    }),
  });
  if (!response.ok) return failedResponse('OpenAI-compatible API', response);
  const payload = await response.json() as {
    choices?: Array<{ message?: OpenAiChatMessage; finish_reason?: string | null }>;
  };
  const choice = payload.choices?.[0];
  if (choice?.message === undefined) throw new Error('LLM API 返回了空 choices');
  return {
    message: choice.message,
    ...(choice.finish_reason === undefined || choice.finish_reason === null
      ? {} : { finishReason: choice.finish_reason }),
  };
};

export const requestAnthropicCompletion = async (options: {
  readonly baseUrl: string;
  readonly apiKey: string;
  readonly model: string;
  readonly system: string;
  readonly messages: readonly AnthropicChatMessage[];
  readonly tools: readonly AnthropicTool[];
  readonly maxTokens: number;
}): Promise<{ content: AnthropicContentBlock[]; stopReason?: string }> => {
  const response = await fetch(endpoint(options.baseUrl, '/messages'), {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': options.apiKey,
      'anthropic-version': '2023-06-01',
      // Anthropic rejects browser CORS preflights without this explicit opt-in.
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model: options.model,
      max_tokens: options.maxTokens,
      system: options.system,
      messages: options.messages,
      tools: options.tools,
      tool_choice: { type: 'auto', disable_parallel_tool_use: true },
    }),
  });
  if (!response.ok) return failedResponse('Anthropic API', response);
  const payload = await response.json() as {
    content?: AnthropicContentBlock[];
    stop_reason?: string | null;
  };
  if (!Array.isArray(payload.content)) throw new Error('Anthropic API 返回了无效 content。');
  return {
    content: payload.content,
    ...(payload.stop_reason === undefined || payload.stop_reason === null
      ? {} : { stopReason: payload.stop_reason }),
  };
};
