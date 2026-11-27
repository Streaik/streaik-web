import type { UIMessageChunk } from 'ai';
import { asRecord } from './directMetrics.ts';

const bodyLimit = 16 * 1024;
const fallback = 'The selected chat route could not complete the request.';

export function safeMessage(value: unknown): string | undefined {
  if (typeof value !== 'string' || !value.trim() || value.length > 2048 ||
    /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F-\x9F]|<!doctype\s|<html[\s>]|stack\s*trace|traceback \(most recent call last\)|\n\s*at\s+[^\r\n]+\(/i.test(value)) return;
  return value.replace(/\bsk-[a-z\d_*-]{8,}|\bBearer\s+[a-z\d_./+-]{12,}=*/gi, '[redacted]');
}

export async function readGatewayError(response: Response, credentials: Headers, signal?: AbortSignal | null) {
  const mediaType = response.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase();
  if (!response.body || (mediaType !== 'application/json' && !mediaType?.endsWith('+json')) ||
    Number(response.headers.get('content-length')) > bodyLimit) {
    await response.body?.cancel().catch(() => {});
    return;
  }
  const reader = response.body.getReader();
  const timeout = setTimeout(() => { void reader.cancel().catch(() => {}); }, 2000);
  try {
    const bytes = new Uint8Array(bodyLimit);
    let length = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (length + value.byteLength > bodyLimit) return;
      bytes.set(value, length);
      length += value.byteLength;
    }
    const payload = asRecord(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, length))));
    // Streaik's existing Chat Completions, Responses, Messages and Vercel HTTP envelopes all have this path.
    const message = asRecord(payload?.error)?.message;
    if (typeof message !== 'string') return;
    const secrets = [...credentials.values()].flatMap(value => [value, value.slice(value.indexOf(' ') + 1)]);
    if (secrets.some(secret => secret.length >= 8 && message.includes(secret))) return;
    return safeMessage(message);
  } catch {
    return; // Keep the original status and use the default status text.
  } finally {
    clearTimeout(timeout);
    void reader.cancel().catch(() => {});
    reader.releaseLock();
    signal?.throwIfAborted();
  }
}

export function nativeStreamError(event: unknown): string | undefined {
  const frame = asRecord(event);
  if (frame?.type === 'response.failed') return safeMessage(asRecord(asRecord(frame.response)?.error)?.message);
  if (frame?.type === 'error' || (typeof frame?.type === 'string' && frame.type.endsWith('_error'))
    || (frame?.type == null && frame?.error != null))
    return safeMessage(frame.message) ?? safeMessage(asRecord(frame.error)?.message);
}

export function earlyStreamError(data: unknown, responseBody: string | undefined): string | undefined {
  const structured = nativeStreamError(data);
  if (structured || !responseBody || responseBody.length > bodyLimit) return structured;
  // Some SDKs put only the structured error object in responseBody. Do not use
  // the raw body or the SDK exception's message as display text.
  try { return nativeStreamError(JSON.parse(responseBody)); } catch { return; }
}

export function sanitizeChatErrors(stream: ReadableStream<UIMessageChunk>): ReadableStream<UIMessageChunk> {
  return stream.pipeThrough(new TransformStream<UIMessageChunk, UIMessageChunk>({
    transform(chunk, controller) {
      controller.enqueue(chunk.type === 'error' ? { ...chunk, errorText: safeMessage(chunk.errorText) ?? fallback } : chunk);
    },
  }));
}
