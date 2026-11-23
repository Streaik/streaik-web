import type { ChatMessage, ChatMessageMetadata, Gateway } from '@streaik/gateway';

type Transport = ReturnType<Gateway['chatTransport']>;
type ReplyStream = Awaited<ReturnType<Transport['sendMessages']>>;
type ReplyChunk = ReplyStream extends ReadableStream<infer Chunk> ? Chunk : never;

export function messageTime(timestamp: unknown): number | undefined {
  if (typeof timestamp !== 'string') return;
  const time = Date.parse(timestamp);
  return Number.isFinite(time) ? time : undefined;
}

export function withReplyMetadata(stream: ReplyStream, model: string | undefined, previous?: ChatMessage): ReplyStream {
  let timestamp: string | undefined;
  let fallback: ChatMessageMetadata | undefined;
  return stream.pipeThrough(new TransformStream<ReplyChunk, ReplyChunk>({
    transform(chunk, controller) {
      if (chunk.type === 'start') {
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
