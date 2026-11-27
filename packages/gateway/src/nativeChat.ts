import { convertToModelMessages, jsonSchema, streamText, tool } from 'ai';
import type { ChatTransport, JSONSchema7, ToolSet } from 'ai';
import { asRecord, createDirectMetrics } from './directMetrics.ts';
import type { DirectMetricsOptions } from './directMetrics.ts';
import { chatToolChoice, GatewayError } from './index.ts';
import type { ChatMessage, ChatMessageMetadata, NativeChatEndpoint } from './index.ts';
import { anthropicChatProtocolHeaders, extendNativeTools, mergeAnthropicMessagesOptions, mergeOpenAIResponsesOptions } from './nativeToolOptions.ts';
import { clientToolSearchName, deferredToolReferences } from './toolSearch.ts';
import { withNativeHostedSkills } from './hostedSkills.ts';
import type { HostedSkill } from './hostedSkills.ts';
import { withResponsesHostedMcp } from './hostedMcp.ts';
import type { HostedMcpTool } from './hostedMcp.ts';
import { responsesMcpOutput, responsesMcpReplay } from './responsesMcp.ts';

type NativeTarget = {
  url: string;
  model: string;
  gateway?: boolean;
  direct?: DirectMetricsOptions;
  requestBody?: (body: RequestInit['body']) => RequestInit['body'];
  fetch: typeof fetch;
};

function readGatewayMetrics(event: unknown): ChatMessageMetadata['gateway'] {
  const frame = asRecord(event);
  const envelope = asRecord(frame?.response) ?? asRecord(frame?.message) ?? frame;
  const metrics = asRecord(asRecord(envelope?.metadata)?.gateway);
  if (!metrics) return;
  const { ttft, tps, cost } = metrics;
  const number = (value: unknown) => typeof value === 'number' && Number.isFinite(value) ? value : undefined;
  return { ttft: number(ttft), tps: number(tps), cost: number(cost) };
}

function nativeAttachmentMessages(messages: ChatMessage[], endpoint: NativeChatEndpoint): ChatMessage[] {
  return messages.map(message => message.role !== 'user' ? message : { ...message, parts: message.parts.map(part => {
    if (part.type !== 'file') return part;
    const image = part.mediaType.startsWith('image/');
    const pdf = part.mediaType === 'application/pdf';
    if (/^https?:\/\//i.test(part.url)) {
      if (image || (pdf && endpoint !== '/v1/chat/completions')) return part;
      return { type: 'text', text: `\n\nLink: ${part.url}` };
    }
    if (image || pdf || endpoint === '/v1/responses' || (endpoint === '/v1/messages' && part.mediaType === 'text/plain')) return part;
    throw new GatewayError('This route does not support one of the attached file types. Use a compatible route or convert text files to text.');
  }) });
}

export function nativeChatTransport(endpoint: NativeChatEndpoint, resolve: (model: string, skills: readonly HostedSkill[]) => NativeTarget): ChatTransport<ChatMessage> {
  return {
    async sendMessages({ messages, body, headers, abortSignal }) {
      const { model, tools: definitions, toolChoice, instructions: gatewayInstructions, mcpInstructions, providerMetadata, hostedSkills, hostedMcp } = asRecord(body) ?? {};
      if (typeof model !== 'string') throw new GatewayError('Choose a model for this route.');
      const skills = Array.isArray(hostedSkills) ? hostedSkills as HostedSkill[] : [];
      const target = resolve(model, skills);
      const rawMcp = endpoint === '/v1/responses' && !target.requestBody;
      const mcpReplay = rawMcp ? responsesMcpReplay(messages, target.url, model, !!target.gateway) : undefined;
      const previous = messages.at(-1);
      const mcpOutput = rawMcp ? responsesMcpOutput(target.url, model, previous?.role === 'assistant' ? previous : undefined) : undefined;
      const mcp = target.gateway && endpoint === '/v1/responses' && Array.isArray(hostedMcp) ? hostedMcp as HostedMcpTool[] : [];
      const openAIResponses = !target.requestBody && endpoint === '/v1/responses' && model.startsWith('openai/');
      const anthropic = !target.requestBody && model.startsWith('anthropic/');
      const anthropicOptions = anthropic ? asRecord(asRecord(providerMetadata)?.anthropic) : undefined;
      const anthropicLimit = anthropicOptions?.max_tokens;
      const nativeOptions = openAIResponses ? asRecord(asRecord(providerMetadata)?.openai) : undefined;
      const nativeTools = Array.isArray(nativeOptions?.tools) ? nativeOptions.tools : [];
      const search = nativeTools.map(asRecord).find(tool => tool?.type === 'tool_search');
      const registerSearch = openAIResponses && (!!search || messages.some(message => message.parts.some(part =>
        (part.type === 'dynamic-tool' && part.toolName === 'tool_search' || part.type === 'tool-tool_search') &&
        typeof part.callProviderMetadata?.openai?.itemId === 'string')));
      const beta = openAIResponses ? new Headers(headers).get('openai-beta') : null;
      const definitionsList = Array.isArray(definitions) ? definitions : [];
      const anthropicSearch = anthropic && endpoint === '/v1/messages' &&
        definitionsList.some(definition => asRecord(definition)?.name === clientToolSearchName);
      const deferred = new Set<string>();
      if (anthropicSearch) for (const definition of definitionsList) {
        const entry = asRecord(definition);
        if (entry?.defer_loading === true && typeof entry.name === 'string' && entry.name !== clientToolSearchName) deferred.add(entry.name);
      }
      const inputInstructions = target.gateway ? gatewayInstructions : mcpInstructions;
      const instructions = typeof inputInstructions === 'string' ? inputInstructions
        : Array.isArray(inputInstructions) && inputInstructions.every(text => typeof text === 'string')
          ? inputInstructions.map(content => ({ role: 'system' as const, content })) : undefined;
      const direct = target.direct && createDirectMetrics(endpoint, target.direct);
      const baseURL = target.url.slice(0, -(endpoint.length - '/v1'.length));
      // SDKs handle protocol conversions. The scoped fetch owns authentication and
      // rejects any SDK request other than this exact destination.
      const fetcher: typeof fetch = (input, init) => {
        if (input !== target.url || init?.method !== 'POST') throw new GatewayError('Unexpected chat request.');
        direct?.start();
        let body = target.requestBody ? target.requestBody(init.body) : extendNativeTools(init.body, definitions, endpoint, model);
        if (openAIResponses) body = mergeOpenAIResponsesOptions(body, nativeOptions, registerSearch);
        if (anthropic && endpoint === '/v1/messages') body = mergeAnthropicMessagesOptions(body, anthropicOptions, toolChoice);
        if (target.gateway) body = withNativeHostedSkills(body, endpoint, skills, toolChoice);
        body = withResponsesHostedMcp(body, mcp, toolChoice);
        if (mcpReplay) body = mcpReplay.body(body);
        if (!beta && !anthropic) return target.fetch(input, body === init.body ? init : { ...init, body });
        const outgoing = new Headers(init.headers);
        if (beta) outgoing.set('OpenAI-Beta', beta);
        if (anthropic) {
          outgoing.delete('anthropic-version');
          outgoing.delete('anthropic-beta');
          anthropicChatProtocolHeaders(new Headers(headers), deferred.size > 0).forEach((value, name) => outgoing.set(name, value));
        }
        return target.fetch(input, { ...init, body, headers: outgoing });
      };
      const sdk = { baseURL, apiKey: 'supplied-by-scoped-fetch', fetch: fetcher };
      const openai = endpoint !== '/v1/messages' ? (await import('@ai-sdk/openai')).createOpenAI(sdk) : undefined;
      const adapter = openai ? openai[endpoint === '/v1/responses' ? 'responses' : 'chat'](target.model)
        : (await import('@ai-sdk/anthropic')).createAnthropic(sdk)(target.model);
      abortSignal?.throwIfAborted();

      const tools: ToolSet = Object.fromEntries(definitionsList.map(
        ({ name, description, inputSchema }: { name: string; description?: string; inputSchema: JSONSchema7 }) =>
          [name, tool({ description, inputSchema: jsonSchema(inputSchema),
            ...(name === clientToolSearchName && deferred.size > 0 && { toModelOutput({ output }: { output: unknown }) {
              const names = deferredToolReferences(output, deferred);
              return names.length ? { type: 'content', value: names.map(toolName => ({ type: 'custom' as const,
                providerOptions: { anthropic: { type: 'tool-reference', toolName } } })) } as const
                : { type: 'text', value: JSON.stringify(output) ?? '' } as const;
            } }),
          })],
      ));
      if (registerSearch && openai) tools.tool_search = openai.tools.toolSearch({ execution: search?.execution === 'client' ? 'client' : 'server' });
      let gateway: ChatMessageMetadata['gateway'];
      const result = streamText({
        model: adapter, messages: await convertToModelMessages(nativeAttachmentMessages(mcpReplay?.messages ?? messages, endpoint), { tools, ignoreIncompleteToolCalls: true }),
        instructions, tools, toolChoice: Object.keys(tools).length || nativeTools.length || target.gateway && skills.length || mcp.length
          ? chatToolChoice(toolChoice) : undefined,
        ...(typeof anthropicLimit === 'number' && { maxOutputTokens: anthropicLimit }),
        abortSignal, maxRetries: 0, includeRawChunks: target.gateway || !!direct || !!mcpOutput,
        ...(endpoint === '/v1/responses' ? { providerOptions: { openai: { store: false, passThroughUnsupportedFiles: true } } }
          : endpoint === '/v1/chat/completions' && (target.gateway || model.startsWith('openai/'))
          ? { providerOptions: { openai: { store: false } } } : {}),
        // URLs pass to the provider only where supported. Never download them in the browser.
        experimental_download: async (files) => files.map(() => null),
        onError: () => {},
      });
      return result.toUIMessageStream<ChatMessage>({
        originalMessages: messages,
        onError: (error) => error instanceof GatewayError ? error.message : 'The selected chat route could not complete the request.',
        messageMetadata: ({ part }) => {
          if (part.type === 'raw') mcpOutput?.observe(part.rawValue);
          if (direct) direct.observe(part);
          else if (part.type === 'raw') gateway = readGatewayMetrics(part.rawValue) ?? gateway;
          if (part.type !== 'finish') return;
          const { inputTokens, outputTokens, totalTokens } = part.totalUsage;
          const observed = direct?.finish(part.totalUsage);
          const metrics = observed?.metrics ?? gateway;
          return { model, ...mcpOutput?.metadata(), usage: observed?.summary ?? { promptTokens: inputTokens, completionTokens: outputTokens, totalTokens },
            ...(metrics && { providerMetadata: { gateway: metrics } }) };
        },
      });
    },
    async reconnectToStream() { return null; },
  };
}
