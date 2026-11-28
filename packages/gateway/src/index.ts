import { DefaultChatTransport } from 'ai';
import type { UIMessage } from 'ai';
import { readGatewayError, sanitizeChatErrors } from './errorDetails.ts';
import { nativeChatTransport } from './nativeChat.ts';
import { apiChatResponsesHistory } from './openAIResponsesHistory.ts';
import { hostedActivityHeader } from './hostedActivity.ts';
import { apiChatHostedSkillProviders, apiChatHostedSkills, hostedSkillProviders } from './hostedSkills.ts';
import type { HostedSkill } from './hostedSkills.ts';
export type { HostedSkill, HostedSkillReference, HostedInlineSkill } from './hostedSkills.ts';
import { apiChatHostedMcp, apiChatHostedSearchProviders, hostedSearchProviders } from './hostedMcp.ts';
import type { HostedMcpTool } from './hostedMcp.ts';
export type { HostedMcpTool } from './hostedMcp.ts';
import { anthropicChatProtocolHeaders } from './nativeToolOptions.ts';
import { decisionChoiceBody, gatewayDecisionEndpoints, readDecisionChoice } from './decisionChoice.ts';
import { decisionSearchBody, readDecisionSearch } from './decisionSearch.ts';
import type { DecisionChoice, DecisionChoiceResult, GatewayDecisionEndpoint } from './decisionChoice.ts';
import { imageRequestBody, isImageEndpoint, readImageResponse } from './images.ts';
import type { GatewayImageEndpoint, ImageRequest, ImageResponse } from './images.ts';
import { readVideoOperation, readVideoStatus, videoOperationParts } from './videos.ts';
import type { VideoRequest, VideoStatus } from './videos.ts';
import { isSpeechEndpoint, readSpeech, speechRequestBody } from './speech.ts';
import type { GatewaySpeechEndpoint, SpeechChunk, SpeechRequest } from './speech.ts';
import { isRealtimeOnlySpeechModel, realtimeSpeechProvider, streamRealtimeSpeech } from './realtimeSpeech.ts';
import type { SpeechPcm } from './realtimeSpeech.ts';
import { googleLiveTranscriptionSetup, isTranscriptionEndpoint, liveTranscriptionProvider, openAITranscriptionSession, readLiveTranscriptionCredential, readNativeTranscript, readTranscript, readTranscriptStream, supportsFileTranscription, transcriptionBody } from './transcriptions.ts';
import type { GatewayTranscriptionEndpoint, LiveTranscriptionOptions, TranscriptionOptions } from './transcriptions.ts';
export { deepgramTranscriptionSwitches, gatewayTranscriptionEndpoints, googleLiveTranscriptionSetup, isLiveTranscriptionModel, isTranscriptionEndpoint, openAITranscriptionFormats, openAITranscriptionSocket, supportsFileTranscription, transcriptionFileAccept, transcriptionMediaType, transcriptionUploadLimit, usesTranscriptionWebSocket } from './transcriptions.ts';
export type { GatewayTranscriptionEndpoint, GoogleLiveTranscriptionConfig, LiveTranscriptionOptions, Transcript, TranscriptSegment, TranscriptionConfig, TranscriptionOptions } from './transcriptions.ts';
import { readTokenPricing } from './tokenPricing.ts';
import type { TokenRates } from './tokenPricing.ts';
export { createDirectChat } from './directChat.ts';
export type { DirectChat } from './directChat.ts';
export { createAgentBackend } from './agentBackend.ts';
export type { AgentBackend, AgentBackendCredentials, HostedAgent, HostedAgentSelection } from './agentBackend.ts';
export { gatewayDecisionEndpoints } from './decisionChoice.ts';
export type { DecisionChoice, DecisionChoiceResult, GatewayDecisionEndpoint } from './decisionChoice.ts';
export { gatewayImageEndpoints, imageBatchSizes, imageSource, isImageEndpoint, maxImageCount, maxNativeImageCount } from './images.ts';
export type { GatewayImageEndpoint, ImageFileInput, ImageInput, ImageJsonObject, ImageOptions, ImageProviderOptions, ImageRequest, ImageResponse } from './images.ts';
export type { VideoAsset, VideoRequest, VideoStatus } from './videos.ts';
export { gatewaySpeechEndpoints, isSpeechEndpoint, speechFormats } from './speech.ts';
export type { GatewaySpeechEndpoint, SpeechChunk, SpeechOptions, SpeechProviderConfig, SpeechRequest, SpeechResponse } from './speech.ts';
export { isRealtimeOnlySpeechModel, isSpeechCatalogModel, supportsRealtimeSpeech } from './realtimeSpeech.ts';
export type { TokenRates } from './tokenPricing.ts';

export const nativeChatEndpoints = ['/v1/responses', '/v1/messages', '/v1/chat/completions'] as const;
export const gatewayChatEndpoints = ['/api/chat', ...nativeChatEndpoints] as const;
export type NativeChatEndpoint = typeof nativeChatEndpoints[number];
export type GatewayChatEndpoint = typeof gatewayChatEndpoints[number];
export type ChatRoute = { mode: 'gateway'; endpoint: GatewayChatEndpoint } | { mode: 'direct'; endpoint: NativeChatEndpoint };

export type ChatMessageMetadata = {
  model?: string;
  timestamp?: string;
  usage?: { promptTokens?: number | null; completionTokens?: number | null; totalTokens?: number | null };
  providerMetadata?: { gateway?: GatewayMetrics; [provider: string]: unknown };
  gateway?: GatewayMetrics;
  [key: string]: unknown;
};
type GatewayMetrics = {
  ttft?: number | string; tps?: number | string; cost?: number | string;
  source?: 'direct';
};
export type ChatMessage = UIMessage<ChatMessageMetadata>;
export type ChatReasoning = 'low' | 'medium' | 'high';
export type ChatToolChoice = 'none' | 'required';

export function chatReasoning(value: unknown): ChatReasoning | undefined {
  return value === 'low' || value === 'medium' || value === 'high' ? value : undefined;
}

export function chatToolChoice(value: unknown): ChatToolChoice | undefined {
  return value === 'none' || value === 'required' ? value : undefined;
}
import { maxSkillZipBytes, qualifiedSkill, readSkillZip, skillListPath, skillVersionPath, validSkillProvider } from './skills.ts';
import type { RemoteSkill, RemoteSkillVersion, SkillPage, SkillPageOptions, SkillUploadTargets } from './skills.ts';
export type { RemoteSkill, RemoteSkillVersion, SkillPage, SkillPageOptions, SkillUploadTargets } from './skills.ts';
export { maxSkillZipBytes } from './skills.ts';

export type CredentialRequest = { kind: 'models' } | { kind: 'chat' | 'decision' | 'image' | 'video' | 'skill' | 'transcription' | 'speech' | 'realtime'; provider: string };
export type Credentials = (request: CredentialRequest) => HeadersInit | Promise<HeadersInit>;
/** `created` is the model creation time in Unix seconds, when the provider supplies it. */
export type ChatModel = { id: string; name: string; provider: string; created?: number };
export type CatalogModel = ChatModel & {
  type?: string;
  tags: readonly string[];
  description?: string;
  pricing?: TokenRates;
  contextWindow?: number;
  maxTokens?: number;
};

export class GatewayError extends Error {
  readonly httpStatus?: number;
  constructor(message?: string, httpStatus?: number) {
    super(message);
    this.httpStatus = httpStatus;
  }
}

class GatewayChatTransport extends DefaultChatTransport<ChatMessage> {
  protected override processResponseStream(stream: ReadableStream<Uint8Array>) {
    return sanitizeChatErrors(super.processResponseStream(stream));
  }
}

export function normalizeGatewayBase(value: string, appUrl: string): URL {
  const url = new URL(value, appUrl);
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if ((url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) ||
      url.username || url.password || url.search || url.hash) {
    throw new GatewayError('Use an HTTPS gateway URL (HTTP is allowed only on loopback), without credentials, query, or fragment.');
  }
  url.pathname = `${url.pathname.replace(/\/+$/, '')}/`;
  return url;
}

// /v1/models is shared across protocols. These are the text-chat providers
// supported by the current gateway's Vercel adapter, not every listed provider.
const apiChatProviders = new Set(['echo', 'openai', 'anthropic', 'openrouter', 'fireworks', 'deepseek', 'groq', 'together', 'cerebras', 'google', 'xai', 'mistral']);

function apiChatProvider(id: string): string | undefined {
  const slash = id.indexOf('/');
  const provider = id.slice(0, slash);
  return slash > 0 && slash < id.length - 1 && apiChatProviders.has(provider) ? provider : undefined;
}

export function isTextModel(provider: string, nativeId: string, type: string | undefined) {
  // Catalog classification is not a promise that /api/chat supports the model.
  if (provider === 'openai' && /(?:^|[-_.])(audio|realtime|tts|transcribe|transcription|image|video|vision|search|embedding|chat|moderation)(?:[-_.]|$)/i.test(nativeId)) return false;
  if (provider === 'google' && (!/^gemini-/i.test(nativeId) || /(?:^|[-_.])(embedding|tts|audio|image)(?:[-_.]|$)/i.test(nativeId))) return false;
  if (provider === 'xai' && (!/^grok-/i.test(nativeId) || /(?:^|[-_.])(voice|image|video|imagine|tts|stt|audio)(?:[-_.]|$)/i.test(nativeId))) return false;
  // The gateway passes through OpenAI's untyped listing and Anthropic's
  // `type: "model"` records on older deployments.
  if (type != null && type !== 'model') return type === 'language';
  if (provider === 'anthropic') return /^claude-/i.test(nativeId);
  return provider === 'openai' && /^(gpt-(4\.1|4o|[56](?:\.\d+)?)|o[134])(?:$|-)/i.test(nativeId);
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' ? value.trim() || undefined : undefined;
}

function tokenLimit(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : undefined;
}

function modelCreationTime(value: unknown): number | undefined {
  if (typeof value === 'number') return Number.isSafeInteger(value) ? value : undefined;
  // Direct Anthropic listings use ISO 8601 in created_at instead of Unix seconds.
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}(?:T.*(?:Z|[+-]\d{2}:\d{2}))?$/.test(value)) return;
  const milliseconds = Date.parse(value);
  if (Number.isFinite(milliseconds)) return milliseconds / 1000;
}

export function readModelCatalog(payload: unknown): CatalogModel[] {
  if (!payload || typeof payload !== 'object' || !('data' in payload) || !Array.isArray(payload.data)) {
    throw new GatewayError('The gateway returned an invalid model list.');
  }
  const result = new Map<string, CatalogModel>();
  for (const item of payload.data) {
    const id = text(item?.id);
    const slash = id?.indexOf('/') ?? -1;
    if (!id || id !== item.id || slash < 1 || !id.slice(slash + 1).trim()) continue;
    const provider = id.slice(0, slash);
    const name = text(item.name);
    let type = text(item.type)?.toLowerCase();
    const tags = new Set<string>();
    for (const raw of Array.isArray(item.tags) ? item.tags : []) {
      const tag = text(raw)?.toLowerCase();
      if (tag) tags.add(tag === 'real-time' ? 'realtime' : tag);
    }
    if (type === 'realtime' || type === 'real-time') {
      type = 'audio';
      tags.add('realtime');
    }
    const key = JSON.stringify([id, type]);
    const previous = result.get(key);
    const pricing = readTokenPricing(item.pricing) ?? previous?.pricing;
    const created = modelCreationTime(item.created) ?? modelCreationTime(item.created_at) ?? previous?.created;
    result.set(key, { id, provider, name: name && name !== id ? name : previous?.name ?? id.slice(slash + 1), type,
      tags: [...new Set([...(previous?.tags ?? []), ...tags])], description: text(item.description) ?? previous?.description,
      ...(created !== undefined && { created }),
      ...(pricing && { pricing }),
      contextWindow: tokenLimit(item.context_window) ?? previous?.contextWindow, maxTokens: tokenLimit(item.max_tokens) ?? previous?.maxTokens });
  }
  return [...result.values()].sort((a, b) => a.provider.localeCompare(b.provider) || a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
}

export function pickChatCatalogModels(models: readonly CatalogModel[]): CatalogModel[] {
  const result = new Map<string, CatalogModel>();
  for (const model of models) {
    const { id, provider, tags, type } = model;
    const googleAgent = provider === 'google' && type === 'language' && tags.includes('agent');
    if (!apiChatProvider(id) || tags.includes('realtime') || (!googleAgent && !isTextModel(provider, id.slice(provider.length + 1), type))) continue;
    result.set(id, model);
  }
  return [...result.values()];
}

export function pickChatModels(models: readonly CatalogModel[]): ChatModel[] {
  return pickChatCatalogModels(models).map(({ id, name, provider, created }) => ({ id, name, provider,
    ...(created !== undefined && { created }) }));
}

export function openAiVoiceProtocol(id: string): 'live' | 'realtime' | undefined {
  if (!/^openai\/[a-z0-9.-]+$/i.test(id) || /(?:^|[-./])(transcribe|transcription|whisper|stt|asr|tts)(?:[-.]|$)/i.test(id)) return;
  if (/^openai\/gpt-live(?:-|$)/i.test(id)) return 'live';
  if (/^openai\/gpt-(?:4o-)?realtime(?:-|$)/i.test(id)) return 'realtime';
}

export type SocketVoiceProvider = 'google' | 'xai';

export function socketVoiceProvider(id: string): SocketVoiceProvider | undefined {
  if (id === 'xai/grok-voice-latest') return 'xai';
  if (/^google\/gemini-[a-z0-9.-]+$/.test(id) && /-(?:live|native-audio)(?:-|$)/.test(id) &&
    !/-(?:transcribe|transcription|tts|stt|asr)(?:-|$)/.test(id)) return 'google';
}

export type VoiceProtocol = NonNullable<ReturnType<typeof openAiVoiceProtocol>> | SocketVoiceProvider;
export const voiceProtocolForModel = (id: string): VoiceProtocol | undefined => openAiVoiceProtocol(id) ?? socketVoiceProvider(id);

export function isVoiceCatalogModel(model: CatalogModel) {
  return model.type === 'audio' && model.tags.includes('realtime') && !!voiceProtocolForModel(model.id);
}

function voiceSocketCredential(provider: SocketVoiceProvider, payload: unknown, model: string) {
  const { url, token, expiresAt } = (payload && typeof payload === 'object' ? payload : {}) as Record<string, unknown>;
  const invalid = () => new GatewayError('The gateway returned an invalid or expired voice credential.');
  if (typeof url !== 'string' || typeof token !== 'string' || !token || token.length > 4096 ||
    (expiresAt != null && (typeof expiresAt !== 'number' || !Number.isFinite(expiresAt) || expiresAt <= Date.now() / 1000))) throw invalid();
  let destination: URL;
  try { destination = new URL(url); } catch { throw invalid(); }
  if (destination.protocol !== 'wss:' || destination.port || destination.username || destination.password || destination.hash) throw invalid();
  if (provider === 'google') {
    if (destination.hostname !== 'generativelanguage.googleapis.com' || destination.search ||
      !/^\/ws\/google\.ai\.generativelanguage\.v1(?:alpha|beta)\.GenerativeService\.BidiGenerateContentConstrained$/.test(destination.pathname) ||
      !/^auth_tokens\/[A-Za-z0-9._~+=-]+$/.test(token)) throw invalid();
    destination.searchParams.set('access_token', token);
    return { url: destination.href };
  }
  if (destination.hostname !== 'api.x.ai' || destination.pathname !== '/v1/realtime' ||
    destination.search !== `?model=${model.slice(4)}` || !/^[A-Za-z0-9._~-]+$/.test(token)) throw invalid();
  return { url: destination.href, protocols: [token.startsWith('xai-client-secret.') ? token : `xai-client-secret.${token}`] };
}

export function readChatModels(payload: unknown): ChatModel[] {
  return pickChatModels(readModelCatalog(payload));
}

type HttpTarget = 'gateway' | 'provider' | 'agent backend';

function statusMessage(status: number, target: HttpTarget): string {
  if (status === 401) return 'Authentication failed. Check your provider key or sign in again.';
  if (status === 403) return `The ${target} denied access. Check your permissions.`;
  if (status === 404) return `The ${target} route or model was not found.`;
  if (status === 429) return `The ${target} is rate-limited. Wait briefly and retry.`;
  return `The ${target} could not complete the request (HTTP ${status}).`;
}

export async function requestHttp(destination: string, credentials: HeadersInit, init: RequestInit, fetcher: typeof fetch,
  target: HttpTarget = 'gateway') {
  // Retain only content negotiation from the caller; credentials are selected by
  // the host for this destination, never by the SDK or message body.
  const headers = new Headers(credentials);
  const supplied = new Headers(init.headers);
  for (const name of ['content-type', 'accept']) {
    const value = supplied.get(name);
    if (value) headers.set(name, value);
  }
  init.signal?.throwIfAborted();
  let response: Response;
  try {
    response = await fetcher(destination, { ...init, headers, credentials: 'omit', redirect: 'error', referrerPolicy: 'no-referrer', cache: 'no-store' });
  } catch {
    init.signal?.throwIfAborted();
    throw new GatewayError(`Could not reach the configured ${target}. Check its address and that it is running.`);
  }
  if (!response.ok) {
    let diagnostic: string | undefined;
    if (target === 'gateway') diagnostic = await readGatewayError(response, new Headers(credentials), init.signal);
    else await response.body?.cancel().catch(() => {});
    init.signal?.throwIfAborted();
    throw new GatewayError(diagnostic ?? statusMessage(response.status, target), response.status);
  }
  return response;
}

export async function expectEventStream(response: Response) {
  if (!response.headers.get('content-type')?.toLowerCase().startsWith('text/event-stream')) {
    await response.body?.cancel();
    throw new GatewayError('Expected a streaming response from the selected route.');
  }
  return response;
}

export function createGateway(baseUrl: URL | undefined, credentials: Credentials, fetcher: typeof fetch = globalThis.fetch) {
  // Copy the deployment-supplied URL; never take the destination from UI inputs,
  // returned model data, redirects, or SDK-provided URLs.
  const root = baseUrl?.href;
  const modelsUrl = root && new URL('v1/models', root).href;
  const chatUrl = root && new URL('api/chat', root).href;
  const videosUrl = root && new URL('api/videos', root).href;

  async function request(destination: string | undefined, auth: CredentialRequest, init: RequestInit = {}, protocolHeaders?: HeadersInit,
    skillProviders: readonly string[] = [], searchProviders: readonly string[] = []) {
    if (!destination) throw new GatewayError('No gateway is configured. Choose Route → Direct to chat with a provider.');
    init.signal?.throwIfAborted();
    const selected = new Headers(await credentials(auth));
    // Add only the scoped skill key. A skill credential must never replace inference authorization.
    for (const provider of skillProviders) {
      const name = `X-${provider}-Key`;
      if (selected.has(name)) continue;
      init.signal?.throwIfAborted();
      const key = new Headers(await credentials({ kind: 'skill', provider })).get(name);
      if (key !== null) selected.set(name, key);
    }
    for (const provider of searchProviders) {
      const name = `X-${provider}-Key`;
      if (selected.has(name) || auth.kind === 'chat' && auth.provider === provider) continue;
      init.signal?.throwIfAborted();
      const key = new Headers(await credentials({ kind: 'decision', provider })).get(name);
      if (key !== null) selected.set(name, key);
    }
    if (protocolHeaders) new Headers(protocolHeaders).forEach((value, name) => {
      if (!selected.has(name) || (auth.kind === 'chat' && auth.provider === 'anthropic'
        && (name === 'anthropic-version' || name === 'anthropic-beta'))) selected.set(name, value);
    });
    return requestHttp(destination, selected, init, fetcher);
  }

  async function listModelCatalog(signal?: AbortSignal): Promise<CatalogModel[]> {
    const response = await request(modelsUrl, { kind: 'models' }, { signal });
    let data: unknown;
    try { data = await response.json(); } catch {
      signal?.throwIfAborted();
      throw new GatewayError('The gateway returned an unreadable model list.');
    }
    return readModelCatalog(data);
  }

  async function decideChoiceResult(endpoint: GatewayDecisionEndpoint, choice: DecisionChoice, signal?: AbortSignal): Promise<DecisionChoiceResult> {
    if (!gatewayDecisionEndpoints.includes(endpoint)) throw new GatewayError('The selected Decisions route is unavailable.');
    const slash = choice.model.indexOf('/');
    const provider = choice.model.slice(0, slash);
    if (slash < 1 || !/^[a-z0-9-]+$/.test(provider) || !choice.model.slice(slash + 1).trim()) {
      throw new GatewayError('Choose a valid Decisions model.');
    }
    const response = await request(root && new URL(endpoint.slice(1), root).href, { kind: 'decision', provider }, {
      method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify(decisionChoiceBody(endpoint, choice)), signal,
    });
    let data: unknown;
    try { data = await response.json(); } catch {
      signal?.throwIfAborted();
      throw new GatewayError('The gateway returned an unreadable Decisions response.');
    }
    signal?.throwIfAborted();
    const result = readDecisionChoice(endpoint, data, choice.choices);
    if (!result) throw new GatewayError('Decisions did not return one of the selected models.');
    return result;
  }

  async function skillRequest(path: string, auth: CredentialRequest, init: RequestInit = {}) {
    return request(root && new URL(path, root).href, auth, init);
  }

  async function videoRequest(path: string | undefined, provider: string, init: RequestInit): Promise<unknown> {
    if (!path) throw new GatewayError('No gateway is configured.');
    const response = await request(path, { kind: 'video', provider }, init);
    try { return await response.json(); } catch {
      init.signal?.throwIfAborted();
      throw new GatewayError('The gateway returned an unreadable video response.');
    }
  }

  return {
    historyScope: chatUrl ?? 'direct',
    hasEndpoint: !!root,
    listModelCatalog,
    async listSkills(options?: SkillPageOptions, signal?: AbortSignal): Promise<SkillPage<RemoteSkill>> {
      return (await skillRequest(skillListPath('v1/skills', options), { kind: 'models' }, { signal })).json();
    },
    async listSkillVersions(id: string, options?: SkillPageOptions, signal?: AbortSignal): Promise<SkillPage<RemoteSkillVersion>> {
      const { provider, path } = qualifiedSkill(id);
      return (await skillRequest(skillListPath(`${path}/versions`, options), { kind: 'skill', provider }, { signal })).json();
    },
    async downloadSkill(id: string, version?: string, signal?: AbortSignal): Promise<Blob> {
      const { provider, path } = qualifiedSkill(id);
      const base = version === undefined ? path : skillVersionPath(path, version);
      return readSkillZip(await skillRequest(`${base}/content`, { kind: 'skill', provider }, { headers: { accept: 'application/zip' }, signal }));
    },
    async skillUploadTargets(signal?: AbortSignal): Promise<SkillUploadTargets> {
      const targets = await (await skillRequest('v1/skills/providers', { kind: 'models' }, { signal })).json();
      if (!targets || !(targets.auth === 'provider-key' || targets.auth === 'provider-header') ||
          !Array.isArray(targets.providers) || !targets.providers.every((id: unknown) => typeof id === 'string' && validSkillProvider(id))) {
        throw new GatewayError('The gateway returned invalid skill destinations.');
      }
      return targets;
    },
    async uploadSkill(provider: string, archive: Blob, targets: SkillUploadTargets, signal?: AbortSignal): Promise<RemoteSkill> {
      if (!validSkillProvider(provider) || !targets.providers.includes(provider)) throw new GatewayError('Choose a supported skill destination.');
      if (!archive.size || archive.size > maxSkillZipBytes) throw new GatewayError('The skill ZIP must be between 1 byte and 16 MiB.');
      if (!root) throw new GatewayError('No gateway is configured.');
      const headers = new Headers(await credentials({ kind: 'skill', provider }));
      if (targets.auth === 'provider-header' || provider === 'echo' && !headers.has('X-Echo-Key')) headers.set('X-Streaik-Provider', provider);
      const body = new FormData(); body.append('files', archive, 'skill.zip');
      const response = await requestHttp(new URL('v1/skills', root).href, headers, { method: 'POST', body, signal }, fetcher);
      return response.json();
    },
    async listModels(signal?: AbortSignal): Promise<ChatModel[]> {
      return pickChatModels(await listModelCatalog(signal));
    },
    async generateImages(endpoint: GatewayImageEndpoint, image: ImageRequest, signal?: AbortSignal): Promise<ImageResponse> {
      if (!isImageEndpoint(endpoint)) throw new GatewayError('The selected image route is unavailable.');
      if (!root) throw new GatewayError('No gateway is configured.');
      const match = /^([a-z0-9-]+)\/(\S.*)$/.exec(image.model);
      if (!match) throw new GatewayError('Choose a valid image model.');
      signal?.throwIfAborted();
      const init = await imageRequestBody(endpoint, image);
      const response = await request(new URL(endpoint.slice(1), root).href, { kind: 'image', provider: match[1] }, { ...init, method: 'POST', signal });
      let data: unknown;
      try { data = await response.json(); } catch {
        signal?.throwIfAborted();
        throw new GatewayError('The gateway returned an unreadable image response.');
      }
      return readImageResponse(endpoint, data, image.model);
    },
    async generateSpeech(endpoint: GatewaySpeechEndpoint, speech: SpeechRequest, signal?: AbortSignal, onChunk?: SpeechChunk) {
      if (!isSpeechEndpoint(endpoint)) throw new GatewayError('The selected speech route is unavailable.');
      if (!root) throw new GatewayError('No gateway is configured.');
      const match = /^([a-z0-9-]+)\/(\S+)$/.exec(speech.model);
      if (!match) throw new GatewayError('Choose a valid speech model.');
      if (isRealtimeOnlySpeechModel(speech.model)) throw new GatewayError('This speech model requires Direct WebSocket. Switch routes or choose an HTTP speech model.');
      if (!speech.text.trim()) throw new GatewayError('Enter text to generate speech.');
      const body = speechRequestBody(endpoint, speech, match[1]);
      const accept = endpoint === '/api/speech' ? 'application/json' : endpoint === '/api/speech/stream' || speech.streamFormat === 'sse'
        ? 'text/event-stream, audio/*, application/octet-stream' : 'audio/*, application/octet-stream, application/zip';
      const response = await request(new URL(endpoint.slice(1), root).href, { kind: 'speech', provider: match[1] }, {
        method: 'POST', headers: { 'content-type': 'application/json', accept }, body: JSON.stringify(body), signal,
      });
      return readSpeech(endpoint, response, speech, signal, onChunk);
    },
    async generateRealtimeSpeech(speech: SpeechRequest, signal: AbortSignal, onPcm?: SpeechPcm) {
      const provider = realtimeSpeechProvider(speech.model);
      if (!provider) throw new GatewayError('This speech model does not support Direct WebSocket. Choose a Gateway route or a compatible model.');
      if (!root) throw new GatewayError('No gateway is configured.');
      const path = speech.model.split('/').map(encodeURIComponent).join('/');
      return streamRealtimeSpeech(speech, async (credentialSignal, session) => {
        const endpoint = session ? 'v1/realtime/client_secrets' : `api/realtime/token/${path}`;
        const response = await request(new URL(endpoint, root).href, { kind: 'realtime', provider }, {
          method: 'POST', headers: { accept: 'application/json', 'content-type': 'application/json' },
          body: session ? JSON.stringify({ session, expires_after: { anchor: 'created_at', seconds: 60 } }) : '{}',
          cache: 'no-store', signal: credentialSignal,
        });
        try { return await response.json(); } catch {
          credentialSignal.throwIfAborted();
          throw new GatewayError('The gateway returned an unreadable speech credential.');
        }
      }, signal, onPcm);
    },
    async startVideo({ model, prompt }: VideoRequest, signal?: AbortSignal): Promise<string> {
      const match = /^([a-z0-9-]+)\/(\S.*)$/.exec(model);
      if (!match) throw new GatewayError('Choose a valid video model.');
      const payload = await videoRequest(videosUrl, match[1], {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ model, prompt }), signal,
      });
      return readVideoOperation(payload, match[1]);
    },
    async getVideoStatus(operation: string, signal?: AbortSignal): Promise<VideoStatus> {
      const { provider, token } = videoOperationParts(operation);
      return readVideoStatus(await videoRequest(videosUrl && `${videosUrl}/${provider}/${token}`, provider, { signal }));
    },
    async transcribe(endpoint: GatewayTranscriptionEndpoint, model: string, file: File, options: TranscriptionOptions, signal: AbortSignal,
      preview: (text: string) => void = () => {}) {
      const match = /^([a-z0-9-]+)\/(\S+)$/.exec(model);
      if (!isTranscriptionEndpoint(endpoint) || !match || !supportsFileTranscription(endpoint, model)) throw new GatewayError('Choose a model that supports this transcription route.');
      if (!root) throw new GatewayError('No gateway is configured.');
      signal.throwIfAborted();
      const init = await transcriptionBody(endpoint, model, file, options);
      const response = await request(new URL(endpoint.slice(1), root).href, { kind: 'transcription', provider: match[1] }, { ...init, method: 'POST', signal });
      if (endpoint === '/api/transcriptions/stream') return readTranscriptStream(response, preview, signal);
      const format = init.body instanceof FormData ? init.body.get('response_format') : undefined;
      if (format === 'text' || format === 'srt' || format === 'vtt') return readNativeTranscript(await response.text(), format);
      let payload: unknown;
      try { payload = await response.json(); } catch {
        signal.throwIfAborted();
        throw new GatewayError('The gateway returned an unreadable transcript.');
      }
      return readTranscript(payload, endpoint === '/v1/audio/transcriptions');
    },
    async negotiateVoice(model: string, session: object, sdp: string, ttl: number | undefined, signal: AbortSignal): Promise<string> {
      const protocol = openAiVoiceProtocol(model);
      if (!protocol || !sdp) throw new GatewayError('Choose a supported OpenAI voice model.');
      async function post(path: string, body: object) {
        const response = await request(root && new URL(path, root).href, { kind: 'realtime', provider: 'openai' }, {
          method: 'POST', headers: { accept: 'application/json', 'content-type': 'application/json' }, body: JSON.stringify(body), signal,
        });
        try { return await response.json(); } catch {
          signal.throwIfAborted();
          throw new GatewayError('The gateway returned an unreadable voice session.');
        }
      }
      if (protocol === 'live') {
        const result = await post('v1/live/sessions', { session: { ...session, model, store: false }, transport: { type: 'webrtc', sdp } });
        if (result?.transport?.type === 'webrtc' && typeof result.transport.sdp === 'string' && result.transport.sdp.trim()) return result.transport.sdp;
      } else if (ttl === undefined) {
        const result = await post(`api/realtime/session/openai/${encodeURIComponent(model.slice(7))}`, { sdp, sessionConfig: { providerOptions: { openai: session } } });
        if (typeof result?.sdp === 'string' && result.sdp.trim()) return result.sdp;
      } else {
        if (!Number.isInteger(ttl) || ttl < 1 || ttl > 7200) throw new GatewayError('Invalid OpenAI client-secret lifetime.');
        const result = await post('v1/realtime/client_secrets', { session: { ...session, model }, expires_after: { anchor: 'created_at', seconds: ttl } });
        const secret = result?.value;
        if (typeof secret !== 'string' || !secret || typeof result.expires_at !== 'number' || result.expires_at <= Date.now() / 1000)
          throw new GatewayError('The gateway returned an invalid or expired OpenAI client secret.');
        // Only the short-lived secret goes to this fixed provider URL, never Gateway credentials.
        const response = await requestHttp('https://api.openai.com/v1/realtime/calls', new Headers({ Authorization: `Bearer ${secret}` }),
          { method: 'POST', body: sdp, headers: { 'content-type': 'application/sdp' }, cache: 'no-store', signal }, fetcher);
        const answer = await response.text();
        if (answer.trim()) return answer;
      }
      throw new GatewayError('The gateway did not return a voice session SDP answer.');
    },
    async realtimeVoiceCredential(model: string, tokenOptions: object, signal: AbortSignal) {
      const provider = socketVoiceProvider(model);
      if (!provider) throw new GatewayError('Choose a compatible realtime voice model.');
      const path = `api/realtime/token/${provider}/${encodeURIComponent(model.slice(provider.length + 1))}`;
      const response = await request(root && new URL(path, root).href, { kind: 'realtime', provider }, {
        method: 'POST', headers: { accept: 'application/json', 'content-type': 'application/json' }, signal,
        body: JSON.stringify({ sessionConfig: { providerOptions: { [provider]: tokenOptions } } }),
      });
      let payload: unknown;
      try { payload = await response.json(); } catch {
        signal.throwIfAborted();
        throw new GatewayError('The gateway returned an unreadable voice credential.');
      }
      signal.throwIfAborted();
      return voiceSocketCredential(provider, payload, model);
    },
    async liveTranscriptionCredential(model: string, options: LiveTranscriptionOptions | string | undefined, signal: AbortSignal) {
      const { language, google } = typeof options === 'string' ? { language: options } : options ?? {};
      const provider = liveTranscriptionProvider(model);
      if (!provider) throw new GatewayError('Choose a compatible microphone transcription model.');
      const path = provider === 'openai' ? 'v1/realtime/client_secrets' : `api/realtime/token/${model}`;
      const body = provider === 'openai' ? { session: openAITranscriptionSession(model, language) }
        : provider === 'google' ? { sessionConfig: { providerOptions: { google: {
          uses: 1, bidiGenerateContentSetup: googleLiveTranscriptionSetup(model, google ?? language),
        } } } }
          : provider === 'gladia' ? { sessionConfig: { providerOptions: { gladia: {
            encoding: 'wav/pcm', sample_rate: 16000, channels: 1, bit_depth: 16,
            ...(language ? { language_config: { languages: [language] } } : {}),
          } } } } : {};
      const response = await request(root && new URL(path, root).href, { kind: 'realtime', provider }, {
        method: 'POST', headers: { accept: 'application/json', 'content-type': 'application/json' }, body: JSON.stringify(body), signal,
      });
      let payload: unknown;
      try { payload = await response.json(); } catch {
        signal.throwIfAborted();
        throw new GatewayError('The gateway returned an unreadable microphone session credential.');
      }
      return readLiveTranscriptionCredential(model, payload, language);
    },
    decideChoiceResult,
    async decideSearch(endpoint: GatewayDecisionEndpoint, model: string, input: string, predicates: readonly string[], signal: AbortSignal) {
      const provider = /^([a-z0-9-]+)\/.+$/u.exec(model)?.[1];
      if (!provider || !gatewayDecisionEndpoints.includes(endpoint) || !predicates.length || predicates.length > 32)
        throw new GatewayError('Invalid Decisions search request.');
      const response = await request(root && new URL(endpoint.slice(1), root).href, { kind: 'decision', provider }, {
        method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify(decisionSearchBody(endpoint, model, input, predicates)), signal,
      });
      const scores = readDecisionSearch(endpoint, await response.json(), predicates.length);
      signal.throwIfAborted();
      if (!scores) throw new GatewayError('Invalid Decisions search response.');
      return scores;
    },
    async decideChoice(endpoint: GatewayDecisionEndpoint, choice: DecisionChoice, signal?: AbortSignal) {
      return (await decideChoiceResult(endpoint, choice, signal)).choice;
    },
    chatTransport(endpoint: GatewayChatEndpoint = '/api/chat') {
      if (endpoint !== '/api/chat') return nativeChatTransport(endpoint, (model, skills, hostedMcp) => {
        const provider = apiChatProvider(model);
        if (!provider) throw new GatewayError('Choose a model supported by this gateway route.');
        if (!root) throw new GatewayError('No gateway is configured. Choose Route → Direct to chat with a provider.');
        const url = new URL(endpoint.slice(1), root).href;
        return { url, model, gateway: true, fetch: async (_input, init) => {
          const headers = new Headers(init?.headers);
          const beta = endpoint === '/v1/responses' && provider === 'openai' && headers.get('openai-beta');
          const protocol = provider === 'anthropic' ? anthropicChatProtocolHeaders(headers) : new Headers();
          if (beta) protocol.set('OpenAI-Beta', beta);
          if (endpoint === '/v1/responses' && headers.get(hostedActivityHeader) === '1') protocol.set(hostedActivityHeader, '1');
          return expectEventStream(await request(url, { kind: 'chat', provider }, init, protocol, hostedSkillProviders(skills), hostedSearchProviders(hostedMcp)));
        } };
      });
      return new GatewayChatTransport({
        api: chatUrl,
        prepareSendMessagesRequest: ({ id, messages, body }) => {
          const hostedMcp = Array.isArray(body?.hostedMcp) ? body.hostedMcp as HostedMcpTool[] : [];
          const skills = Array.isArray(body?.hostedSkills) ? body.hostedSkills as HostedSkill[] : [];
          const tools = [...(Array.isArray(body?.tools) ? body.tools : []), ...hostedMcp.map(apiChatHostedMcp),
            ...(skills.length ? [apiChatHostedSkills(skills)] : [])];
          const history = apiChatResponsesHistory(messages, body?.model, body?.providerMetadata);
          return { body: {
            model: body?.model, messages: history, ...(hostedMcp.length && { id }), ...(tools.length ? { tools } : {}),
            ...(body?.providerMetadata && { providerMetadata: body.providerMetadata }),
            reasoning: chatReasoning(body?.reasoning),
            toolChoice: chatToolChoice(body?.toolChoice),
          } };
        },
        fetch: async (input, init) => {
          if (input !== (chatUrl ?? '/api/chat') || init?.method !== 'POST' || typeof init.body !== 'string') {
            throw new GatewayError('Unexpected chat request.');
          }
          const { model, tools } = JSON.parse(init.body) as { model?: unknown; tools?: unknown };
          const provider = typeof model === 'string' && apiChatProvider(model);
          if (!provider) {
            throw new GatewayError('Choose a model that supports API Chat.');
          }
          // An explicit protocol opt-in passes through this transport, never arbitrary SDK or body headers.
          const headers = new Headers(init.headers);
          const beta = headers.get('openai-beta');
          return expectEventStream(await request(chatUrl, { kind: 'chat', provider }, init,
            provider === 'anthropic' ? anthropicChatProtocolHeaders(headers) : beta ? { 'OpenAI-Beta': beta } : undefined,
            apiChatHostedSkillProviders(tools), apiChatHostedSearchProviders(tools)));
        },
      });
    },
  };
}

export type Gateway = ReturnType<typeof createGateway>;
export { clientToolSearchName } from './toolSearch.ts';
