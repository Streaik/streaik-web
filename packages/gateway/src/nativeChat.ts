import { convertToModelMessages, jsonSchema, streamText, tool } from 'ai';
import type { ChatTransport, JSONSchema7, ToolSet } from 'ai';
import { asRecord, createDirectMetrics } from './directMetrics.ts';
import type { DirectMetricsOptions } from './directMetrics.ts';
import { chatToolChoice, GatewayError } from './index.ts';
import type { ChatMessage, ChatMessageMetadata, NativeChatEndpoint } from './index.ts';
import { extendNativeTools } from './nativeToolOptions.ts';

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

export function nativeChatTransport(endpoint: NativeChatEndpoint, resolve: (model: string) => NativeTarget): ChatTransport<ChatMessage> {
  return {
    async sendMessages({ messages, body, abortSignal }) {
      const { model, tools: definitions, toolChoice, instructions: gatewayInstructions, mcpInstructions } = asRecord(body) ?? {};
      if (typeof model !== 'string') throw new GatewayError('Choose a model for this route.');
      const target = resolve(model);
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
        const body = target.requestBody ? target.requestBody(init.body) : extendNativeTools(init.body, definitions, endpoint, model);
        return target.fetch(input, body === init.body ? init : { ...init, body });
      };
      const sdk = { baseURL, apiKey: 'supplied-by-scoped-fetch', fetch: fetcher };
      const adapter = endpoint === '/v1/messages'
        ? (await import('@ai-sdk/anthropic')).createAnthropic(sdk)(target.model)
        : (await import('@ai-sdk/openai')).createOpenAI(sdk)[endpoint === '/v1/responses' ? 'responses' : 'chat'](target.model);
      abortSignal?.throwIfAborted();

      const tools: ToolSet = Object.fromEntries((Array.isArray(definitions) ? definitions : []).map(
        ({ name, description, inputSchema }: { name: string; description?: string; inputSchema: JSONSchema7 }) =>
          [name, tool({ description, inputSchema: jsonSchema(inputSchema) })],
      ));
      let gateway: ChatMessageMetadata['gateway'];
      const result = streamText({
        model: adapter, messages: await convertToModelMessages(nativeAttachmentMessages(messages, endpoint), { tools, ignoreIncompleteToolCalls: true }),
        instructions, tools, toolChoice: Object.keys(tools).length ? chatToolChoice(toolChoice) : undefined,
        abortSignal, maxRetries: 0, includeRawChunks: target.gateway || !!direct,
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
          if (direct) direct.observe(part);
          else if (part.type === 'raw') gateway = readGatewayMetrics(part.rawValue) ?? gateway;
          if (part.type !== 'finish') return;
          const { inputTokens, outputTokens, totalTokens } = part.totalUsage;
          const observed = direct?.finish(part.totalUsage);
          const metrics = observed?.metrics ?? gateway;
          return { model, usage: observed?.summary ?? { promptTokens: inputTokens, completionTokens: outputTokens, totalTokens },
            ...(metrics && { providerMetadata: { gateway: metrics } }) };
        },
      });
    },
    async reconnectToStream() { return null; },
  };
}
