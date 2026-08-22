import { Map } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import './style.css';

import { createMapLibreStyleTools } from 'maplibre-style-tools/ai';
import {
  createAnthropicTools,
  createOpenAiFunctionTools,
} from 'maplibre-style-tools/capabilities';

import {
  requestAnthropicCompletion,
  requestOpenAiCompletion,
  type AnthropicChatMessage,
  type AnthropicContentBlock,
  type OpenAiChatMessage,
} from './providers.js';

const map = new Map({
  container: 'map',
  style: 'https://demotiles.maplibre.org/style.json',
  center: [108, 34],
  zoom: 2,
});

const tools = createMapLibreStyleTools({ getMap: () => map });

/** Executors run locally against the live map; results use the capability envelope. */
type ToolExecutor = (input: unknown) => Promise<unknown>;

const executors = {
  inspectStyle: tools.inspectStyle.execute as ToolExecutor,
  applyStyleTransaction: tools.applyStyleTransaction.execute as ToolExecutor,
  applyStyleDocument: tools.applyStyleDocument.execute as ToolExecutor,
  runMapCommand: tools.runMapCommand.execute as ToolExecutor,
  queryMapFeatures: tools.queryMapFeatures.execute as ToolExecutor,
} as const;

type ExecutorName = keyof typeof executors;
type ProviderKind = 'openai' | 'anthropic';
type ToolExecution = { output: string; success: boolean; message: string };

const SYSTEM_PROMPT = `你是 MapLibre 地图样式助手。用户用自然语言描述想要的样式调整,你通过工具调用来检查和修改实时地图。

当前底图是 demotiles 世界地图,主要图层:background(海洋背景)、countries-fill(国家填充,有 ADM0_A3 国家码属性)、countries-boundary、coastline、geolines、countries-label、geolines-label。

工作方式:
1. 需要了解现状时先调 inspectStyle(listLayers / getLayer / getSource 等)。
2. 修改样式调 applyStyleTransaction,一次事务可含多个操作。常用 op:
   - setLayerProperties: {op, layerId, paint: {...}, layout: {...}}
   - setLayerFilter: {op, layerId, mode: 'replace'|'and'|'or'|'clear', filter: 表达式}
   - duplicateLayer: {op, layerId, newLayerId, overrides: {...}}
   - removeLayer: {op, layerId}
   - addGeoJsonLayer: {op, sourceId, layerId, type: 'circle'|'line'|'fill'|'symbol', data: 内联 GeoJSON, paint: {...}, layout: {...}, beforeId?}
   - setGeoJsonData: {op, sourceId, data}
   - moveLayer: {op, layerId, beforeId?|afterId?}
   - addSource / removeSource / patchSource
   过滤器必须用表达式风格,例如 ["==", ["get", "ADM0_A3"], "CHN"]。
3. 工具参数必须是完整、紧凑的 JSON。只传需要的字段；不要枚举大量国家码或生成未闭合的表达式。工具提示参数无效时，立刻用同一工具重试一次。
4. 修改后向用户简要说明改了什么。始终用中文回复。`;

const MAX_COMPLETION_TOKENS = 1_024;
const OPENAI_TOOLS = createOpenAiFunctionTools();
const ANTHROPIC_TOOLS = createAnthropicTools();
const providerDefaults: Record<ProviderKind, { baseUrl: string; model: string; keyPlaceholder: string }> = {
  openai: {
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-4o-mini',
    keyPlaceholder: 'sk-...',
  },
  anthropic: {
    baseUrl: 'https://api.anthropic.com/v1',
    model: 'claude-sonnet-4-5',
    keyPlaceholder: 'sk-ant-...',
  },
};

const chatLog = document.querySelector('#chat-log');
const promptForm = document.querySelector('#prompt-form');
if (!(chatLog instanceof HTMLElement) || !(promptForm instanceof HTMLFormElement)) {
  throw new Error('Missing chat elements');
}

const input = <T extends HTMLElement>(testId: string): T => {
  const element = document.querySelector(`[data-testid="${testId}"]`);
  if (!(element instanceof HTMLElement)) throw new Error(`Missing input: ${testId}`);
  return element as T;
};

const providerInput = input<HTMLSelectElement>('provider');
const baseUrlInput = input<HTMLInputElement>('base-url');
const apiKeyInput = input<HTMLInputElement>('api-key');
const modelInput = input<HTMLInputElement>('model');
const promptInput = input<HTMLInputElement>('prompt');
const sendButton = input<HTMLButtonElement>('send');

const appendMessage = (kind: 'user' | 'assistant' | 'tool' | 'error', text: string): void => {
  const element = document.createElement('div');
  element.className = `msg ${kind}`;
  element.textContent = text;
  chatLog.append(element);
  chatLog.scrollTop = chatLog.scrollHeight;
};

const initialAssistantMessage = '已在右侧挂载实时地图。填写 API 配置后，直接用中文告诉我怎么调，例如「海洋换成淡蓝色」「把中国标成红色」。';
let openAiHistory: OpenAiChatMessage[] = [{ role: 'system', content: SYSTEM_PROMPT }];
let anthropicHistory: AnthropicChatMessage[] = [];

const selectedProvider = (): ProviderKind => providerInput.value === 'anthropic'
  ? 'anthropic'
  : 'openai';

const resultMessage = (output: string): ToolExecution => {
  const parsed = JSON.parse(output) as { success?: unknown; message?: unknown };
  return {
    output,
    success: parsed.success === true,
    message: typeof parsed.message === 'string' ? parsed.message : '',
  };
};

const executeTool = async (name: string, rawInput: unknown): Promise<ToolExecution> => {
  if (!(name in executors)) {
    return resultMessage(JSON.stringify({ success: false, message: `Unknown tool: ${name}` }));
  }
  const executor = executors[name as ExecutorName];
  // Executors report failures through the envelope, but boundary guards and map
  // internals can still throw; keep the throw from corrupting chat history.
  try {
    return resultMessage(JSON.stringify(await executor(rawInput)));
  } catch (error) {
    return resultMessage(JSON.stringify({
      success: false,
      message: `TOOL_EXECUTION_ERROR: ${error instanceof Error ? error.message : String(error)}`,
    }));
  }
};

const malformedOpenAiArguments = (name: string): ToolExecution => resultMessage(JSON.stringify({
  success: false,
  message: `INVALID_TOOL_ARGUMENTS: ${name} arguments were incomplete JSON. Retry the same function once with a complete, compact JSON object and only the required fields.`,
}));

const runOpenAiTurn = async (prompt: string): Promise<void> => {
  openAiHistory.push({ role: 'user', content: prompt });
  let previousCallMalformed = false;
  for (let round = 0; round < 6; round += 1) {
    const completion = await requestOpenAiCompletion({
      baseUrl: baseUrlInput.value,
      apiKey: apiKeyInput.value,
      model: modelInput.value,
      messages: openAiHistory,
      tools: OPENAI_TOOLS,
      maxCompletionTokens: MAX_COMPLETION_TOKENS,
    });
    if (completion.finishReason === 'length') {
      // Throw before recording the message: a truncated assistant message can
      // carry tool_calls whose tool responses will never exist, which would
      // make every later request fail validation.
      throw new Error('LLM 输出在长度上限处截断。请简化请求后重试。');
    }
    openAiHistory.push(completion.message);
    const calls = completion.message.tool_calls ?? [];
    if (calls.length === 0) {
      appendMessage('assistant', completion.message.content ?? '(空回复)');
      return;
    }
    for (const call of calls) {
      appendMessage('tool', `→ ${call.function.name}(${call.function.arguments.slice(0, 160)})`);
      let toolInput: unknown;
      try {
        toolInput = JSON.parse(call.function.arguments);
      } catch {
        const malformed = malformedOpenAiArguments(call.function.name);
        appendMessage('tool', `← fail: ${malformed.message}`);
        openAiHistory.push({ role: 'tool', tool_call_id: call.id, content: malformed.output });
        if (previousCallMalformed) {
          throw new Error('模型连续两次返回未完成的工具参数。请用更短的样式请求重试。');
        }
        previousCallMalformed = true;
        continue;
      }
      previousCallMalformed = false;
      const execution = await executeTool(call.function.name, toolInput);
      appendMessage('tool', `← ${execution.success ? 'ok' : 'fail'}: ${execution.message}`);
      openAiHistory.push({ role: 'tool', tool_call_id: call.id, content: execution.output });
    }
  }
  appendMessage('error', '工具调用轮次超限，已停止。');
};

const isAnthropicToolUse = (block: AnthropicContentBlock): block is Extract<AnthropicContentBlock, { type: 'tool_use' }> =>
  block.type === 'tool_use';

const runAnthropicTurn = async (prompt: string): Promise<void> => {
  anthropicHistory.push({ role: 'user', content: prompt });
  for (let round = 0; round < 6; round += 1) {
    const completion = await requestAnthropicCompletion({
      baseUrl: baseUrlInput.value,
      apiKey: apiKeyInput.value,
      model: modelInput.value,
      system: SYSTEM_PROMPT,
      messages: anthropicHistory,
      tools: ANTHROPIC_TOOLS,
      maxTokens: MAX_COMPLETION_TOKENS,
    });
    if (completion.stopReason === 'max_tokens') {
      // Throw before recording the content: a truncated assistant turn can end
      // inside a tool_use block whose tool_result will never exist, which
      // would make every later request fail validation.
      throw new Error('Anthropic 输出在长度上限处截断。请简化请求后重试。');
    }
    anthropicHistory.push({ role: 'assistant', content: completion.content });
    const calls = completion.content.filter(isAnthropicToolUse);
    if (calls.length === 0) {
      const text = completion.content
        .filter((block): block is Extract<AnthropicContentBlock, { type: 'text' }> => block.type === 'text')
        .map((block) => block.text)
        .join('');
      appendMessage('assistant', text === '' ? '(空回复)' : text);
      return;
    }
    const results: AnthropicContentBlock[] = [];
    for (const call of calls) {
      appendMessage('tool', `→ ${call.name}(${JSON.stringify(call.input).slice(0, 160)})`);
      const execution = await executeTool(call.name, call.input);
      appendMessage('tool', `← ${execution.success ? 'ok' : 'fail'}: ${execution.message}`);
      results.push({
        type: 'tool_result',
        tool_use_id: call.id,
        content: execution.output,
        ...(execution.success ? {} : { is_error: true }),
      });
    }
    anthropicHistory.push({ role: 'user', content: results });
  }
  appendMessage('error', '工具调用轮次超限，已停止。');
};

const runChatTurn = async (prompt: string): Promise<void> => {
  if (selectedProvider() === 'anthropic') return runAnthropicTurn(prompt);
  return runOpenAiTurn(prompt);
};

providerInput.addEventListener('change', () => {
  const defaults = providerDefaults[selectedProvider()];
  baseUrlInput.value = defaults.baseUrl;
  modelInput.value = defaults.model;
  apiKeyInput.placeholder = defaults.keyPlaceholder;
  openAiHistory = [{ role: 'system', content: SYSTEM_PROMPT }];
  anthropicHistory = [];
  appendMessage('assistant', `已切换到 ${selectedProvider() === 'anthropic' ? 'Anthropic Messages' : 'OpenAI-compatible'} provider，新会话已开始。`);
});

promptForm.addEventListener('submit', (event) => {
  event.preventDefault();
  const prompt = promptInput.value.trim();
  if (prompt === '') return;
  if (apiKeyInput.value.trim() === '') {
    appendMessage('error', '请先填写 API Key。');
    return;
  }
  promptInput.value = '';
  sendButton.disabled = true;
  appendMessage('user', prompt);
  void runChatTurn(prompt)
    .catch((error: unknown) => {
      appendMessage('error', error instanceof Error ? error.message : String(error));
    })
    .finally(() => { sendButton.disabled = false; });
});

appendMessage('assistant', initialAssistantMessage);
