import { createAnthropic } from '@ai-sdk/anthropic';
import { createOpenAI } from '@ai-sdk/openai';

export type ProviderKind = 'openai' | 'anthropic';

type ProviderInput = {
  readonly provider: ProviderKind;
  readonly baseUrl: string;
  readonly apiKey: string;
  readonly model: string;
};

type OpenAiProviderSettings = {
  readonly provider: 'openai';
  readonly baseURL: string;
  readonly apiKey: string;
  readonly model: string;
};

type AnthropicProviderSettings = {
  readonly provider: 'anthropic';
  readonly baseURL: string;
  readonly apiKey: string;
  readonly model: string;
  readonly headers: { readonly 'anthropic-dangerous-direct-browser-access': 'true' };
};

export type ProviderSettings = OpenAiProviderSettings | AnthropicProviderSettings;

export const createProviderSettings = ({
  provider,
  baseUrl,
  apiKey,
  model,
}: ProviderInput): ProviderSettings => provider === 'openai'
  ? { provider, baseURL: baseUrl, apiKey, model }
  : {
    provider,
    baseURL: baseUrl,
    apiKey,
    model,
    // Anthropic requires this opt-in for browser CORS requests.
    headers: { 'anthropic-dangerous-direct-browser-access': 'true' },
  };

export const createChatModel = (settings: ProviderSettings) => settings.provider === 'openai'
  ? createOpenAI({
    baseURL: settings.baseURL,
    apiKey: settings.apiKey,
  }).chat(settings.model)
  : createAnthropic({
    baseURL: settings.baseURL,
    apiKey: settings.apiKey,
    headers: settings.headers,
  })(settings.model);
