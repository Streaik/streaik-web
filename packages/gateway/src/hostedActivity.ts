import { createUIMessageStream } from 'ai';
import type { InferUIMessageChunk } from 'ai';
import { createParser } from 'eventsource-parser';
import type { ChatMessage } from './index.ts';
import { asRecord } from './directMetrics.ts';

export const hostedActivityHeader = 'X-Streaik-Hosted-Tool-Activity';
const event = 'streaik.hosted_tool_activity';
const key = 'streaikHosted';
type Chunk = InferUIMessageChunk<ChatMessage>;

export function withoutHostedActivity(messages: ChatMessage[]): ChatMessage[] {
  return messages.map(message => message.role === 'assistant' ? { ...message, parts: message.parts.filter(part =>
    !('toolCallId' in part && part.providerExecuted && !part.approval && part.toolMetadata?.[key] === true)) } : message);
}

export function hostedActivityRelay() {
  const calls = new Map<string, { name: string; finished: boolean }>();
  const pending: Chunk[] = [];
  let write = (chunk: Chunk) => { pending.push(chunk); };

  function observe(value: unknown) {
    const frame = asRecord(value);
    const activity = frame?.type === event && asRecord(frame.activity);
    if (!activity) return;
    const { name, callId, input, output, error } = activity;
    if (typeof name !== 'string' || !name || typeof callId !== 'string' || !callId) return;
    const call = calls.get(callId);
    const tool = { toolCallId: `streaik-hosted:${callId}`, dynamic: true, providerExecuted: true };
    if (output == null && error == null) {
      if (call || !Object.hasOwn(activity, 'input')) return;
      calls.set(callId, { name, finished: false });
      write({ type: 'tool-input-available', ...tool, toolName: name, input, toolMetadata: { [key]: true } });
      return;
    }
    if (!call || call.finished || call.name !== name || (error != null && typeof error !== 'string')) return;
    call.finished = true;
    write(typeof error === 'string' ? { type: 'tool-output-error', ...tool, errorText: error }
      : { type: 'tool-output-available', ...tool, output });
  }

  return {
    tap(response: Response) {
      if (!response.ok || !response.body) return response;
      // The SDK buffers leading unknown frames until normal output arrives. Read only the
      // gateway activity prefix here and pass the original bytes to the SDK unchanged.
      let prefix = true;
      const decoder = new TextDecoder();
      const parser = createParser({ onEvent(frame) {
        if (frame.event !== event) prefix = false;
        if (!prefix) return;
        let value: unknown;
        try { value = JSON.parse(frame.data); } catch { return; }
        observe(value);
      } });
      const body = response.body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
        transform(bytes, controller) {
          if (prefix) parser.feed(decoder.decode(bytes, { stream: true }));
          controller.enqueue(bytes);
        },
      }));
      return new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers });
    },
    merge(stream: ReadableStream<Chunk>, originalMessages: ChatMessage[]) {
      return createUIMessageStream<ChatMessage>({ originalMessages, execute({ writer }) {
        writer.write({ type: 'start' });
        write = chunk => writer.write(chunk);
        for (const chunk of pending.splice(0)) write(chunk);
        writer.merge(stream);
      } });
    },
  };
}
