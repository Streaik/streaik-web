import type { CatalogModel, ChatMessage, ChatMessageMetadata, Gateway } from '@streaik/gateway';

type Transport = ReturnType<Gateway['chatTransport']>;
type ReplyStream = Awaited<ReturnType<Transport['sendMessages']>>;
type ReplyChunk = ReplyStream extends ReadableStream<infer Chunk> ? Chunk : never;

export function nonnegativeNumber(value: unknown): number | undefined {
  const parsed = typeof value === 'string' && value.trim() ? Number(value) : value;
  return typeof parsed === 'number' && Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

export function messageTokens(metadata?: ChatMessageMetadata) {
  const input = nonnegativeNumber(metadata?.usage?.promptTokens);
  const output = nonnegativeNumber(metadata?.usage?.completionTokens);
  const total = nonnegativeNumber(metadata?.usage?.totalTokens) ?? nonnegativeNumber(metadata?.totalTokens) ??
    (input !== undefined && output !== undefined ? input + output : undefined);
  return { input, output, total };
}

export function messageCost(metadata?: ChatMessageMetadata) {
  const reported = metadata?.providerMetadata?.gateway;
  const legacy = metadata?.gateway;
  // Timing-only metadata must not mask a cost saved in an older field.
  const metrics = reported?.cost != null ? reported : legacy?.cost != null ? legacy : reported ?? legacy;
  return { cost: nonnegativeNumber(metrics?.cost ?? metadata?.cost), source: metrics?.source };
}

export function conversationCost(messages: readonly ChatMessage[]): number | undefined {
  let total = 0;
  let count = 0;
  function add(cost: number | undefined) {
    if (cost === undefined) return;
    total += cost;
    count++;
  }
  for (const { role, metadata, parts } of messages) {
    if (role !== 'assistant') continue;
    add(messageCost(metadata).cost);
    for (const part of parts) {
      if (!('toolCallId' in part) || part.state !== 'output-available') continue;
      const tool = part.output as { _meta?: { gateway?: ChatMessageMetadata['gateway'] } } | undefined;
      add(nonnegativeNumber(tool?._meta?.gateway?.cost));
    }
  }
  return count > 1 && Number.isFinite(total) ? total : undefined;
}

export function latestContextUsage(messages: readonly ChatMessage[], models: readonly Pick<CatalogModel, 'id' | 'contextWindow' | 'maxTokens'>[]) {
  for (let i = messages.length - 1; i >= 0; i--) {
    const { role, metadata } = messages[i];
    if (role !== 'assistant') continue;
    const { total } = messageTokens(metadata);
    if (total === undefined || !Number.isFinite(total)) continue;
    // A routed reply can use a different model than the first selected candidate.
    const model = models.find(({ id }) => id === metadata?.model);
    const window = model?.contextWindow;
    if (window && window > 0 && Number.isFinite(window)) return { used: total, window, maxOutput: model.maxTokens };
    return undefined;
  }
}

export function messageTime(timestamp: unknown): number | undefined {
  if (typeof timestamp !== 'string') return;
  const time = Date.parse(timestamp);
  return Number.isFinite(time) ? time : undefined;
}

export function withReplyMetadata(stream: ReplyStream, model: string | undefined, previous?: ChatMessage, usedIds?: ReadonlySet<string>): ReplyStream {
  let timestamp: string | undefined;
  let fallback: ChatMessageMetadata | undefined;
  return stream.pipeThrough(new TransformStream<ReplyChunk, ReplyChunk>({
    transform(chunk, controller) {
      if (chunk.type === 'start') {
        if (chunk.messageId && chunk.messageId !== previous?.id && usedIds?.has(chunk.messageId)) {
          // Some providers reuse their reply ID across separate user turns.
          chunk = { ...chunk, messageId: previous?.id ?? crypto.randomUUID() };
        }
        const continuation = previous && (chunk.messageId === undefined || chunk.messageId === previous.id) ? previous.metadata : undefined;
        const supplied = chunk.messageMetadata as ChatMessageMetadata | undefined;
        timestamp = messageTime(continuation?.timestamp) !== undefined ? continuation?.timestamp
          : messageTime(supplied?.timestamp) !== undefined ? supplied?.timestamp : undefined;
        fallback = { model: supplied?.model || continuation?.model || model, timestamp: timestamp ?? new Date().toISOString() };
        controller.enqueue({ ...chunk, messageMetadata: { ...supplied, ...fallback } });
        return;
      }
      // Accept a stream without a start frame, but don't create a reply for an error or abort alone.
      if (!fallback && !['error', 'abort', 'finish'].includes(chunk.type)) {
        timestamp = messageTime(previous?.metadata?.timestamp) !== undefined ? previous?.metadata?.timestamp : undefined;
        fallback = { model: previous?.metadata?.model || model, timestamp: timestamp ?? new Date().toISOString() };
        controller.enqueue({ type: 'start', messageMetadata: fallback });
      }
      if ((chunk.type === 'finish' || chunk.type === 'message-metadata') && chunk.messageMetadata && fallback) {
        const supplied = chunk.messageMetadata as ChatMessageMetadata;
        if (!timestamp && messageTime(supplied.timestamp) !== undefined) timestamp = supplied.timestamp;
        fallback = { ...fallback, model: supplied.model || fallback.model };
        controller.enqueue({ ...chunk, messageMetadata: { ...supplied, model: fallback.model, timestamp: timestamp ?? fallback.timestamp } });
        return;
      }
      controller.enqueue(chunk);
    },
  }));
}
