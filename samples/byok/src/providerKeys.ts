import type { CredentialRequest } from '@streaik/gateway';

// Keep the existing direct-to-provider credential scope independent of the picker.
export const directKeyProviderIds: readonly string[] = [
  'openai', 'anthropic', 'openrouter', 'deepseek', 'groq', 'together', 'cerebras',
  'google', 'xai', 'assemblyai', 'gladia', 'deepgram',
];
export type ProviderKeys = Partial<Record<string, string>>;

export function validProviderId(id: string) {
  return id.length > 0 && !/[^a-z0-9_-]/.test(id) && id !== 'echo';
}

export function catalogKeyProviders(catalog: readonly { id: string; name: string }[]) {
  const providers = new Map<string, string>();
  for (const { id, name } of catalog) {
    // The catalog renamed its entry; the gateway's model IDs and key header have not changed.
    const routingId = id === 'spacexai' ? 'xai' : id;
    if (validProviderId(routingId) && (id === 'spacexai' || !providers.has(routingId))) providers.set(routingId, name);
  }
  return providers;
}

export function validProviderKey(value: string) {
  return value.length <= 4096 && /^[!-~]+$/.test(value);
}

export function providerHeaders(keys: ProviderKeys, request: CredentialRequest) {
  return selectHeaders(keys, id => request.kind === 'models' || request.provider === id);
}

export function agentProviderHeaders(keys: ProviderKeys, modelIds: readonly string[]) {
  const requested = new Set(modelIds.flatMap(id => id.includes('/') ? [id.slice(0, id.indexOf('/'))] : []));
  return selectHeaders(keys, id => requested.has(id));
}

function selectHeaders(keys: ProviderKeys, include: (id: string) => boolean) {
  const headers = new Headers();
  for (const [id, key] of Object.entries(keys)) {
    if (key && validProviderId(id) && include(id)) headers.set(`X-${id}-Key`, key);
  }
  return headers;
}
