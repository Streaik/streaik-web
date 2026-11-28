import { DefaultChatTransport } from 'ai';
import type { ChatTransport } from 'ai';
import { asRecord } from './directMetrics.ts';
import { expectEventStream, GatewayError, gatewayChatEndpoints, normalizeGatewayBase, requestHttp } from './index.ts';
import type { ChatMessage, GatewayChatEndpoint } from './index.ts';
import { nativeChatTransport } from './nativeChat.ts';

export type HostedAgent = { id: string; name: string; description?: string; owned_by?: string; tags?: readonly string[] };
export type HostedAgentSelection = { id: string; modelIds: readonly string[]; definition?: object };
export type AgentBackendCredentials = (request: { kind: 'catalog' } | { kind: 'chat'; modelIds: readonly string[] }) => HeadersInit | Promise<HeadersInit>;

export function createAgentBackend(base: URL, credentials: AgentBackendCredentials, fetcher: typeof fetch = globalThis.fetch) {
  const root = normalizeGatewayBase(base.href, base.href);
  const modelsUrl = new URL('v1/models', root).href;

  async function catalog(url: string, signal?: AbortSignal): Promise<unknown> {
    const timeout = AbortSignal.timeout(5000);
    const requestSignal = signal ? AbortSignal.any([signal, timeout]) : timeout;
    const headers = await credentials({ kind: 'catalog' });
    const response = await requestHttp(url, headers, { signal: requestSignal }, fetcher, 'agent backend');
    return response.json();
  }

  return {
    async listAgents(signal?: AbortSignal): Promise<HostedAgent[]> {
      const data = asRecord(await catalog(modelsUrl, signal))?.data;
      if (!Array.isArray(data)) throw new GatewayError('The agent backend returned an invalid agent list.');
      const seen = new Set<string>();
      return data.flatMap((value): HostedAgent[] => {
        const entry = asRecord(value);
        const id = entry?.id;
        if (!entry || typeof id !== 'string' || !id.trim() || id === '.' || id === '..' || seen.has(id)) return [];
        seen.add(id);
        return [{ id, name: typeof entry.name === 'string' && entry.name.trim() ? entry.name : id,
          description: typeof entry.description === 'string' ? entry.description : undefined,
          ...(typeof entry.owned_by === 'string' && { owned_by: entry.owned_by }),
          ...(Array.isArray(entry.tags) && { tags: entry.tags.filter((tag): tag is string => typeof tag === 'string') }) }];
      });
    },
    async getAgent(id: string, signal?: AbortSignal): Promise<unknown> {
      if (!id.trim() || id === '.' || id === '..') throw new GatewayError('Choose a valid hosted agent.');
      return asRecord(await catalog(`${modelsUrl}/${encodeURIComponent(id)}`, signal))?.agent;
    },
    chatTransport(endpoint: GatewayChatEndpoint, selection: HostedAgentSelection): ChatTransport<ChatMessage> {
      if (!gatewayChatEndpoints.includes(endpoint)) throw new GatewayError('The selected agent route is unavailable.');
      const url = new URL(endpoint.slice(1), root).href;
      const selector = selection.definition ? { agent: selection.definition } : { model: selection.id };
      const send: typeof fetch = async (input, init) => {
        if (input !== url || init?.method !== 'POST') throw new GatewayError('Unexpected agent request.');
        try {
          return await expectEventStream(await requestHttp(url, await credentials({ kind: 'chat', modelIds: selection.modelIds }),
            init, fetcher, 'agent backend'));
        } catch (error) {
          if (error instanceof GatewayError && (error.httpStatus === 404 || error.httpStatus === 405 || error.httpStatus === 501)) {
            throw new GatewayError('This agent or route is not available on the configured agent backend. Choose another route.', error.httpStatus);
          }
          throw error;
        }
      };
      if (endpoint === '/api/chat') return new DefaultChatTransport<ChatMessage>({
        api: url, fetch: send, prepareSendMessagesRequest: ({ id, messages, body }) => ({
          body: { ...selector, id, messages, ...(Array.isArray(body?.tools) && body.tools.length ? { tools: body.tools } : {}) },
        }),
      });

      const transport = nativeChatTransport(endpoint, () => ({ url, model: selection.id, fetch: send,
        requestBody(value) {
          if (typeof value !== 'string') throw new GatewayError('Unexpected agent request.');
          const { model: _model, ...body } = JSON.parse(value);
          return JSON.stringify({ ...body, ...selector });
        } }));
      return {
        sendMessages: request => transport.sendMessages({ ...request, body: { model: selection.id } }),
        reconnectToStream: request => transport.reconnectToStream(request),
      };
    },
  };
}

export type AgentBackend = ReturnType<typeof createAgentBackend>;
