import type { CredentialRequest } from '@streaik/gateway';

export const providers = {
  openai: { label: 'OpenAI', header: 'X-OpenAI-Key' },
  anthropic: { label: 'Anthropic', header: 'X-Anthropic-Key' },
  openrouter: { label: 'OpenRouter', header: 'X-OpenRouter-Key' },
  deepseek: { label: 'DeepSeek', header: 'X-DeepSeek-Key' },
  groq: { label: 'Groq', header: 'X-Groq-Key' },
  together: { label: 'Together', header: 'X-Together-Key' },
  cerebras: { label: 'Cerebras', header: 'X-Cerebras-Key' },
  google: { label: 'Google Gemini', header: 'X-Google-Key' },
  xai: { label: 'xAI', header: 'X-Xai-Key' },
  assemblyai: { label: 'AssemblyAI', header: 'X-AssemblyAI-Key' },
  gladia: { label: 'Gladia', header: 'X-Gladia-Key' },
  deepgram: { label: 'Deepgram', header: 'X-Deepgram-Key' },
} as const;
export type ProviderId = keyof typeof providers;
export type ProviderKeys = Partial<Record<ProviderId, string>>;
export const providerIds = Object.keys(providers) as ProviderId[];

export function validProviderKey(value: string) {
  return value.length <= 4096 && /^[!-~]+$/.test(value);
}

export function providerHeaders(keys: ProviderKeys, request: CredentialRequest) {
  const headers = new Headers();
  for (const id of providerIds) {
    const value = keys[id];
    if (value && (request.kind === 'models' || request.provider === id)) headers.set(providers[id].header, value);
  }
  return headers;
}

export function agentProviderHeaders(keys: ProviderKeys, modelIds: readonly string[]) {
  const requested = new Set(modelIds.flatMap(id => id.includes('/') ? [id.slice(0, id.indexOf('/'))] : []));
  const headers = new Headers();
  for (const id of providerIds) {
    const key = keys[id];
    if (key && requested.has(id)) headers.set(providers[id].header, key);
  }
  return headers;
}
