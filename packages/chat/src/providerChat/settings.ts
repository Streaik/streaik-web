import type { ChatModel } from '@streaik/gateway';

export type NativeValue = string | number | boolean | null | NativeOptions | readonly NativeValue[];
export type NativeOptions = { readonly [key: string]: NativeValue | undefined };

export const supportsOpenAIReasoning = (id: string) => /^openai\/(gpt-5(?:[.-]|$)|o[134](?:-|$))/.test(id);
export const supportsGptOssEffort = (id: string) => /(?:^|\/)gpt-oss-(?:20b|120b)(?:-|$)/i.test(id);

function reasoningForModel(options: NativeOptions, key: string, supported: boolean): NativeOptions {
  if (supported || !(key in options)) return options;
  const { [key]: _unsupported, ...rest } = options;
  return rest;
}

// Keep provider-native field names and values here and in the forms. Restrictions
// apply both when editing and when a saved preference is replayed for another model.
export const chatProviders = {
  openai: { label: 'OpenAI', options: (value, id) => reasoningForModel(value, 'reasoning', supportsOpenAIReasoning(id)) },
  cerebras: { label: 'Cerebras', options: (value, id) => reasoningForModel(value, 'reasoning_effort', supportsGptOssEffort(id)) },
  together: { label: 'Together AI', options: (value, id) => reasoningForModel(value, 'reasoning_effort', supportsGptOssEffort(id)) },
} satisfies Record<string, { label: string; options: (value: NativeOptions, modelId: string) => NativeOptions }>;

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

export function chatProviderMetadata(settings: ProviderChatSettings | undefined, modelId: string | undefined) {
  if (!settings || !modelId) return;
  const provider = modelId.split('/', 1)[0];
  if (!isProvider(provider) || modelId.length <= provider.length + 1) return;
  const saved = settings[provider];
  if (!saved) return;
  const options = chatProviders[provider].options(saved, modelId);
  if (Object.values(options).some(value => value !== undefined)) return { [provider]: options };
}
