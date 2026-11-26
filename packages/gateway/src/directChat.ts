import { expectEventStream, GatewayError, isTextModel, nativeChatEndpoints, readModelCatalog, requestHttp } from './index.ts';
import type { NativeChatEndpoint } from './index.ts';
import { nativeChatTransport } from './nativeChat.ts';
import type { TokenRates } from './tokenPricing.ts';

type CatalogProvider = { id: string; apiBaseUrl?: string; chatEndpoints?: readonly string[]; tokenPricing?: Readonly<Partial<Record<string, TokenRates>>> };

export function createDirectChat(catalog: readonly CatalogProvider[], getKey: (provider: string) => string | undefined,
  fetcher: typeof fetch = globalThis.fetch) {
  // Only catalog records with explicitly supported browser-chat endpoints can
  // receive keys. URLs are resolved here, never from messages or API responses.
  const profiles = catalog.flatMap(({ id, apiBaseUrl, chatEndpoints, tokenPricing }) => {
    const endpoints = (chatEndpoints ?? []).filter((route): route is NativeChatEndpoint =>
      nativeChatEndpoints.some(endpoint => endpoint === route));
    if (!apiBaseUrl || !endpoints.length || !URL.canParse(apiBaseUrl)) return [];
    const api = new URL(apiBaseUrl);
    if (api.protocol !== 'https:' || api.username || api.password || api.search || api.hash) return [];
    return [{ id, base: api.href.replace(/\/+$/, ''), endpoints, tokenPricing }];
  });

  function headers(provider: string) {
    const key = getKey(provider);
    if (!key) throw new GatewayError('Set or unlock the provider key for this model.');
    return new Headers(provider === 'anthropic'
      ? { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' }
      : { Authorization: `Bearer ${key}` });
  }

  return {
    endpoints: (includeWithoutKeys = false) => nativeChatEndpoints.filter(route => profiles.some(profile =>
      (includeWithoutKeys || getKey(profile.id)) && profile.endpoints.includes(route))),
    supports: (provider: string, route: NativeChatEndpoint) => profiles.some(profile =>
      profile.id === provider && getKey(provider) && profile.endpoints.includes(route)),
    async listModelCatalog(signal?: AbortSignal) {
      const candidates = profiles.filter(profile => getKey(profile.id));
      const results = await Promise.allSettled(candidates.map(async ({ id, base }) => {
        const modelsUrl = `${base}/v1/models`;
        const entries = [];
        const auth = headers(id);
        const cursors = new Set<string>();
        let cursor: string | undefined;
        do {
          const url = cursor ? `${modelsUrl}?after_id=${encodeURIComponent(cursor)}` : modelsUrl;
          const response = await requestHttp(url, auth, { signal }, fetcher, 'provider');
          const payload = await response.json();
          if (!Array.isArray(payload?.data)) throw new GatewayError('The provider returned an invalid model list.');
          for (const model of payload.data) {
            if (typeof model?.id !== 'string' || !model.id.trim() || model.id !== model.id.trim()) continue;
            // OpenRouter exposes modality instead of a Streaik model type.
            const type = id === 'openrouter' && model.architecture?.output_modalities?.includes?.('text') ? 'language' : model.type;
            if (!isTextModel(id, model.id, type)) continue;
            entries.push({ ...model, id: `${id}/${model.id}`, name: model.display_name ?? model.name, type: 'language' });
          }
          cursor = id === 'anthropic' && payload.has_more === true && typeof payload.last_id === 'string' ? payload.last_id : undefined;
          if (cursor && cursors.has(cursor)) throw new GatewayError('The provider repeated a model-list page.');
          if (cursor) cursors.add(cursor);
        } while (cursor);
        return entries;
      }));
      signal?.throwIfAborted();
      const succeeded = results.flatMap(result => result.status === 'fulfilled' ? [result.value] : []);
      const failure = results.find(result => result.status === 'rejected');
      if (failure && !succeeded.some(models => models.length)) {
        throw failure.reason instanceof GatewayError ? failure.reason : new GatewayError('Could not load direct provider models.');
      }
      return readModelCatalog({ data: succeeded.flat() });
    },
    chatTransport(endpoint: NativeChatEndpoint) {
      return nativeChatTransport(endpoint, (qualifiedModel) => {
        const slash = qualifiedModel.indexOf('/');
        const provider = qualifiedModel.slice(0, slash);
        const profile = profiles.find(item => item.id === provider && item.endpoints.includes(endpoint));
        if (!profile || slash < 1 || slash === qualifiedModel.length - 1) throw new GatewayError('This model does not support the selected Direct route.');
        const url = `${profile.base}${endpoint}`;
        const auth = headers(provider);
        const price = (id: string) => profile.tokenPricing && Object.hasOwn(profile.tokenPricing, id) ? profile.tokenPricing[id] : undefined;
        return {
          url, model: qualifiedModel.slice(slash + 1),
          direct: { provider, rates: resolved => (resolved ? price(resolved.startsWith(`${provider}/`) ? resolved : `${provider}/${resolved}`) : undefined)
            ?? price(qualifiedModel) },
          fetch: async (_input, init = {}) => {
            const beta = endpoint === '/v1/responses' && provider === 'openai' && new Headers(init.headers).get('openai-beta');
            const selected = new Headers(auth);
            if (beta) selected.set('OpenAI-Beta', beta);
            return expectEventStream(await requestHttp(url, selected, init, fetcher, 'provider'));
          },
        };
      });
    },
  };
}

export type DirectChat = ReturnType<typeof createDirectChat>;
