import { Map } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import './style.css';

import { createMapLibreStyleTools } from 'maplibre-style-tools/ai';

const map = new Map({
  container: 'map',
  style: 'https://demotiles.maplibre.org/style.json',
  center: [108, 34],
  zoom: 2,
});

const tools = createMapLibreStyleTools({ getMap: () => map });

/** Executors run locally against the live map; results use the capability envelope. */
type ToolExecutor = (input: unknown) => Promise<unknown>;

// Each capability executor zod-parses its raw input internally, so narrowing
// the parameter to unknown at this boundary loses no validation.
const executors = {
  inspectStyle: tools.inspectStyle.execute as ToolExecutor,
  applyStyleTransaction: tools.applyStyleTransaction.execute as ToolExecutor,
} as const;

type ExecutorName = keyof typeof executors;

interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
}

interface ToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

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
3. 修改后向用户简要说明改了什么。始终用中文回复。`;

const OPENAI_TOOLS = [
  {
    type: 'function',
    function: {
      name: 'inspectStyle',
      description: '检查实时地图的样式结构(图层、源、校验),不修改地图。',
      parameters: {
        type: 'object',
        additionalProperties: false,
        required: ['action'],
        properties: {
          action: {
            type: 'string',
            enum: ['listLayers', 'listSources', 'getLayer', 'getSource', 'getLayerCount', 'validateCurrentMap'],
          },
          layerId: { type: 'string', description: 'getLayer 必填' },
          sourceId: { type: 'string', description: 'getSource 必填' },
          query: { type: 'string', description: 'listLayers 的名称过滤' },
          limit: { type: 'integer' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'applyStyleTransaction',
      description: '对实时地图应用一条样式事务(一个或多个操作),原子生效并返回 diff。',
      parameters: {
        type: 'object',
        additionalProperties: false,
        required: ['transaction'],
        properties: {
          transaction: {
            type: 'object',
            additionalProperties: false,
            required: ['operations'],
            properties: {
              operations: {
                type: 'array',
                minItems: 1,
                items: {
                  type: 'object',
                  required: ['op'],
                  properties: { op: { type: 'string' } },
                  additionalProperties: true,
                },
              },
            },
          },
        },
      },
    },
  },
];

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

const history: ChatMessage[] = [{ role: 'system', content: SYSTEM_PROMPT }];

const callChatCompletion = async (messages: ChatMessage[]): Promise<ChatMessage> => {
  const baseUrl = baseUrlInput.value.replace(/\/+$/, '');
  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${apiKeyInput.value}`,
    },
    body: JSON.stringify({
      model: modelInput.value,
      messages,
      tools: OPENAI_TOOLS,
      tool_choice: 'auto',
    }),
  });
  if (!response.ok) {
    throw new Error(`LLM API ${response.status}: ${(await response.text()).slice(0, 300)}`);
  }
  const payload = await response.json() as {
    choices?: Array<{ message?: ChatMessage }>;
  };
  const message = payload.choices?.[0]?.message;
  if (message === undefined) throw new Error('LLM API 返回了空 choices');
  return message;
};

const runToolCall = async (call: ToolCall): Promise<string> => {
  if (!(call.function.name in executors)) {
    return JSON.stringify({ success: false, message: `Unknown tool: ${call.function.name}` });
  }
  let args: unknown;
  try {
    args = JSON.parse(call.function.arguments);
  } catch {
    return JSON.stringify({ success: false, message: '工具参数不是合法 JSON' });
  }
  const executor = executors[call.function.name as ExecutorName];
  const result = await executor(args);
  return JSON.stringify(result);
};

const runChatTurn = async (prompt: string): Promise<void> => {
  history.push({ role: 'user', content: prompt });
  for (let round = 0; round < 6; round += 1) {
    const message = await callChatCompletion(history);
    history.push(message);
    const calls = message.tool_calls ?? [];
    if (calls.length === 0) {
      appendMessage('assistant', message.content ?? '(空回复)');
      return;
    }
    for (const call of calls) {
      appendMessage('tool', `→ ${call.function.name}(${call.function.arguments.slice(0, 160)})`);
      const output = await runToolCall(call);
      const parsed = JSON.parse(output) as { success?: boolean; message?: string };
      appendMessage('tool', `← ${parsed.success === true ? 'ok' : 'fail'}: ${parsed.message ?? ''}`);
      history.push({ role: 'tool', tool_call_id: call.id, content: output });
    }
  }
  appendMessage('error', '工具调用轮次超限,已停止。');
};

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

appendMessage('assistant', '已在右侧挂载实时地图。填好 API 配置后,直接用中文告诉我怎么调,例如「海洋换成淡蓝色」「把中国标成红色」。');
