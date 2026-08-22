import { ToolLoopAgent, stepCountIs, type ModelMessage } from 'ai';
import { Map } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import './style.css';

import { createMapLibreStyleTools } from 'maplibre-style-tools/ai';

import {
  createChatModel,
  createProviderSettings,
  type ProviderKind,
} from './providers.js';

const map = new Map({
  container: 'map',
  style: 'https://demotiles.maplibre.org/style.json',
  center: [108, 34],
  zoom: 2,
});

const tools = createMapLibreStyleTools({ getMap: () => map });

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
// Per-step model output cap. Tool-call arguments (e.g. a transaction with an
// inline GeoJSON source) routinely exceed 1k tokens; 4k stays under most
// OpenAI-compatible endpoints' max_tokens ceiling while leaving room for
// complex calls.
const MAX_COMPLETION_TOKENS = 4_096;


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


const histories: Record<ProviderKind, ModelMessage[]> = {
  openai: [],
  anthropic: [],
};

const selectedProvider = (): ProviderKind => providerInput.value === 'anthropic'
  ? 'anthropic'
  : 'openai';

const runChatTurn = async (prompt: string): Promise<void> => {
  const settings = createProviderSettings({
    provider: selectedProvider(),
    baseUrl: baseUrlInput.value,
    apiKey: apiKeyInput.value,
    model: modelInput.value,
  });
  const history = histories[settings.provider];
  history.push({ role: 'user', content: prompt });
  let reachedStepLimit = false;
  const agent = new ToolLoopAgent({
    model: createChatModel(settings),
    instructions: SYSTEM_PROMPT,
    tools,
    maxOutputTokens: MAX_COMPLETION_TOKENS,
    stopWhen: stepCountIs(6),
  });
  const result = await agent.generate({
    messages: history,
    onStepFinish: ({ stepNumber, toolCalls, toolResults }) => {
      const resultsByCallId = new globalThis.Map(toolResults.map((toolResult) => [
        toolResult.toolCallId,
        toolResult,
      ]));
      for (const toolCall of toolCalls) {
        appendMessage('tool', `→ ${toolCall.toolName}(${JSON.stringify(toolCall.input).slice(0, 160)})`);
        const toolResult = resultsByCallId.get(toolCall.toolCallId);
        if (toolResult === undefined) continue;
        const output = toolResult.output as { success?: unknown; message?: unknown };
        const success = output.success === true;
        const message = typeof output.message === 'string' ? output.message : '';
        appendMessage('tool', `← ${success ? 'ok' : 'fail'}: ${message}`);
      }
      reachedStepLimit = stepNumber === 5 && toolCalls.length > 0;
    },
  });
  if (result.finishReason === 'length') {
    throw new Error('LLM 输出在长度上限处截断。请简化请求后重试。');
  }
  history.push(...result.response.messages);
  if (reachedStepLimit) {
    appendMessage('error', '工具调用轮次超限，已停止。');
    return;
  }
  appendMessage('assistant', result.text === '' ? '(空回复)' : result.text);
};

providerInput.addEventListener('change', () => {
  const defaults = providerDefaults[selectedProvider()];
  baseUrlInput.value = defaults.baseUrl;
  modelInput.value = defaults.model;
  apiKeyInput.placeholder = defaults.keyPlaceholder;
  histories.openai.length = 0;
  histories.anthropic.length = 0;
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
