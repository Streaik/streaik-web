import type { ChatModel } from '@streaik/gateway';
import { openAIChatHeaders, openAIChatOptions, persistOpenAIOptions } from './openai/options.ts';

export type NativeValue = string | number | boolean | null | NativeOptions | readonly NativeValue[];
export type NativeOptions = { readonly [key: string]: NativeValue | undefined };

export const supportsGptOssEffort = (id: string) => /(?:^|\/)gpt-oss-(?:20b|120b)(?:-|$)/i.test(id);

function reasoningForModel(options: NativeOptions, key: string, supported: boolean): NativeOptions {
  if (supported || !(key in options)) return options;
  const { [key]: _unsupported, ...rest } = options;
  return rest;
}

// Keep provider-native field names and values here and in the forms. Restrictions
// apply both when editing and when a saved preference is replayed for another model.
export const chatProviders = {
  openai: { label: 'OpenAI', options: openAIChatOptions, headers: openAIChatHeaders, persist: persistOpenAIOptions },
  cerebras: { label: 'Cerebras', options: (value, id) => reasoningForModel(value, 'reasoning_effort', supportsGptOssEffort(id)) },
  together: { label: 'Together AI', options: (value, id) => reasoningForModel(value, 'reasoning_effort', supportsGptOssEffort(id)) },
} satisfies Record<string, { label: string; options: (value: NativeOptions, modelId: string) => NativeOptions;
  headers?: (value: NativeOptions) => Record<string, string> | undefined; persist?: (value: NativeOptions) => NativeOptions }>;

export type ChatProviderId = keyof typeof chatProviders;
export type ProviderChatSettings = Readonly<Partial<Record<ChatProviderId, NativeOptions>>>;

const isProvider = (id: string): id is ChatProviderId => Object.hasOwn(chatProviders, id);
export const nativeObject = (value: unknown): NativeOptions | undefined =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? value as NativeOptions : undefined;

export function normalizeProviderChatSettings(value: unknown): ProviderChatSettings {
  const settings: Partial<Record<ChatProviderId, NativeOptions>> = {};
  for (const [id, config] of Object.entries(nativeObject(value) ?? {})) {
    const options = nativeObject(config);
    if (isProvider(id) && options && Object.keys(options).length) settings[id] = options;
  }
  return settings;
}

export function persistentProviderChatSettings(value: unknown): ProviderChatSettings {
  const settings = normalizeProviderChatSettings(value);
  return Object.fromEntries(Object.entries(settings).map(([id, options]) => {
    if (!isProvider(id)) return [id, options];
    const provider = chatProviders[id];
    return [id, 'persist' in provider ? provider.persist(options) : options];
  }));
}

export function activeChatProviders(models: readonly ChatModel[]) {
  const groups = new Map<ChatProviderId, ChatModel[]>();
  for (const model of models) {
    const { provider, id } = model;
    if (isProvider(provider) && id.startsWith(`${provider}/`)) {
      const group = groups.get(provider);
      if (group) group.push(model);
      else groups.set(provider, [model]);
    }
  }
  return groups;
}

export function chatProviderRequest(settings: ProviderChatSettings | undefined, modelId: string | undefined) {
  if (!settings || !modelId) return;
  const provider = modelId.split('/', 1)[0];
  if (!isProvider(provider) || modelId.length <= provider.length + 1) return;
  const saved = settings[provider];
  if (!saved) return;
  const adapter = chatProviders[provider];
  const options = adapter.options(saved, modelId);
  if (Object.values(options).some(value => value !== undefined)) return {
    providerMetadata: { [provider]: options }, headers: 'headers' in adapter ? adapter.headers(options) : undefined,
  };
}
