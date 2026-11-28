import { expectEventStream, GatewayError } from './index.ts';

export const gatewaySpeechEndpoints = ['/api/speech', '/api/speech/stream', '/v1/audio/speech'] as const;
export type GatewaySpeechEndpoint = typeof gatewaySpeechEndpoints[number];
export const isSpeechEndpoint = (value: unknown): value is GatewaySpeechEndpoint => gatewaySpeechEndpoints.some(route => route === value);
export const speechFormats = ['mp3', 'wav', 'opus', 'aac', 'flac', 'pcm'] as const;

export type SpeechOptions = { voice?: string; outputFormat?: string; instructions?: string; speed?: number; language?: string };
type SpeechParameter = string | number | boolean | null | SpeechParameter[] | SpeechProviderConfig;
export type SpeechProviderConfig = { [key: string]: SpeechParameter | undefined };
export type SpeechRequest = SpeechOptions & {
  model: string; text: string; streamFormat?: 'audio' | 'sse'; providerOptions?: Record<string, SpeechProviderConfig>;
};
export type SpeechResponse = { audio: Blob; format?: string; model: string; timestamp: string; warnings: string[] };
export type SpeechChunk = (bytes: Uint8Array<ArrayBuffer>, mediaType: string) => void | Promise<void>;

const outputLimit = 25 * 1024 * 1024;
const mediaTypes: Readonly<Record<string, string>> = {
  mp3: 'audio/mpeg', mpeg: 'audio/mpeg', wav: 'audio/wav', 'x-wav': 'audio/wav', wave: 'audio/wav',
  opus: 'audio/ogg', ogg: 'audio/ogg', aac: 'audio/aac', flac: 'audio/flac', webm: 'audio/webm',
  m4a: 'audio/mp4', mp4: 'audio/mp4', zip: 'application/zip', pcm: 'application/octet-stream',
  pcm16: 'application/octet-stream', 'pcm_s16le': 'application/octet-stream',
};

export function speechRequestBody(endpoint: GatewaySpeechEndpoint, { model, text, voice, outputFormat, instructions, speed, language,
  streamFormat, providerOptions }: SpeechRequest, provider: string) {
  const selected = providerOptions && Object.hasOwn(providerOptions, provider) ? providerOptions[provider] : undefined;
  const generic = { voice, instructions, speed };
  if (endpoint === '/v1/audio/speech') {
    // The compatible API takes provider extensions alongside, not inside, the native fields.
    const reserved = new Set(['model', 'input', 'text', 'files', 'voice', 'instructions', 'speed', 'response_format', 'stream_format', 'provideroptions']);
    const extensions = Object.fromEntries(Object.entries(selected ?? {}).filter(([key]) => !reserved.has(key.toLowerCase())));
    return { ...extensions, ...generic, model, input: text, response_format: outputFormat, stream_format: streamFormat };
  }
  const common = { ...generic, model, language, providerOptions: selected ? { [provider]: selected } : undefined };
  return endpoint === '/api/speech/stream'
    ? { ...common, text: [{ type: 'text', text }], outputFormat: outputFormat ? { type: outputFormat } : undefined }
    : { ...common, text, outputFormat };
}

const object = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const string = (value: unknown): string | undefined => typeof value === 'string' && value.trim() ? value : undefined;
const mediaTypeFor = (format?: string) => format && Object.hasOwn(mediaTypes, format.toLowerCase()) ? mediaTypes[format.toLowerCase()] : undefined;
function audioType(value: string) {
  const type = value.toLowerCase().split(';', 1)[0].trim();
  return /^audio\/[\w.+-]+$/.test(type) || type === 'application/octet-stream' || type === 'application/zip' ? type : undefined;
}

function warningsOf(value: unknown) {
  return Array.isArray(value) ? value.flatMap(entry => {
    const { message, details, type, feature } = object(entry);
    const warning = string(entry) ?? string(message) ?? [string(type), string(feature), string(details)].filter(Boolean).join(': ');
    return warning ? [warning] : [];
  }) : [];
}

function decode(value: unknown) {
  if (typeof value !== 'string') throw new GatewayError('The gateway returned invalid speech audio.');
  if (value.length > Math.ceil(outputLimit / 3) * 4) throw new GatewayError('Speech audio is too large.');
  try {
    const decoded = atob(value);
    const bytes = new Uint8Array(decoded.length);
    for (let index = 0; index < bytes.length; index++) bytes[index] = decoded.charCodeAt(index);
    return bytes;
  }
  catch { throw new GatewayError('The gateway returned invalid speech audio.'); }
}

async function* readChunks<T>(body: ReadableStream<T>, signal?: AbortSignal) {
  const reader = body.getReader();
  const cancel = () => { void reader.cancel().catch(() => {}); };
  signal?.addEventListener('abort', cancel, { once: true });
  try {
    for (;;) {
      signal?.throwIfAborted();
      const { done, value } = await reader.read();
      signal?.throwIfAborted();
      if (done) return;
      yield value;
    }
  } finally {
    cancel();
    signal?.removeEventListener('abort', cancel);
    reader.releaseLock();
  }
}

async function* speechEvents(body: ReadableStream<Uint8Array<ArrayBuffer>>, signal?: AbortSignal): AsyncGenerator<Record<string, unknown>> {
  let pending = '', data = '', event = '';
  for await (const chunk of readChunks(body.pipeThrough(new TextDecoderStream()), signal)) {
    pending += chunk;
    let index: number;
    while ((index = pending.indexOf('\n')) !== -1) {
      const line = pending.slice(0, index).replace(/\r$/, '');
      pending = pending.slice(index + 1);
      if (line.startsWith('event:')) { event = line.slice(6).trim(); continue; }
      if (line.startsWith('data:')) {
        data += `${line.slice(5).replace(/^ /, '')}\n`;
        if (data.length > 4_000_000) throw new GatewayError('The speech stream returned an oversized event.');
      } else if (!line) {
        if (data.trim() === '[DONE]') return;
        if (data) {
          let part: Record<string, unknown>;
          try { part = object(JSON.parse(data)); }
          catch { throw new GatewayError('The speech stream returned an unreadable event.'); }
          yield { ...part, type: event === 'error' ? event : part.type ?? event };
        }
        data = event = '';
      }
    }
    if (pending.length + data.length > 4_000_000) throw new GatewayError('The speech stream returned an oversized event.');
  }
}

// Some streaming providers return signed, mono, little-endian PCM with a declared sample rate.
// Wrap that in WAV for final playback; never guess a rate for an unknown provider.
export function wavHeader(size: number, rate: number) {
  const bytes = new Uint8Array(44), header = new DataView(bytes.buffer);
  for (const [offset, label] of [[0, 'RIFF'], [8, 'WAVEfmt '], [36, 'data']] as const) bytes.set(new TextEncoder().encode(label), offset);
  header.setUint32(4, size + 36, true); header.setUint32(16, 16, true);
  header.setUint16(20, 1, true); header.setUint16(22, 1, true);
  header.setUint32(24, rate, true); header.setUint32(28, rate * 2, true);
  header.setUint16(32, 2, true); header.setUint16(34, 16, true); header.setUint32(40, size, true);
  return bytes;
}

export async function readSpeech(endpoint: GatewaySpeechEndpoint, response: Response, request: SpeechRequest,
  signal?: AbortSignal, onChunk?: SpeechChunk): Promise<SpeechResponse> {
  const native = endpoint === '/v1/audio/speech';
  let type = response.headers.get('content-type')?.toLowerCase().split(';', 1)[0].trim() ?? '';
  let format = request.outputFormat, timestamp = new Date().toISOString(), rate: number | undefined;
  const warnings: string[] = [], chunks: Uint8Array<ArrayBuffer>[] = [];
  let size = 0;
  async function append(bytes: Uint8Array<ArrayBuffer>, progressive: boolean) {
    if (!bytes.length) return;
    size += bytes.length;
    if (size > outputLimit) throw new GatewayError('Speech audio is too large.');
    chunks.push(bytes);
    if (progressive) await onChunk?.(bytes, type);
    signal?.throwIfAborted();
  }

  if (endpoint === '/api/speech') {
    let data: Record<string, unknown>;
    try { data = object(await response.json()); } catch {
      signal?.throwIfAborted();
      throw new GatewayError('The gateway returned an unreadable speech response.');
    }
    const audio = object(data.audio);
    format = string(audio.format) ?? format;
    type = audioType(string(audio.mediaType) ?? '') ?? mediaTypeFor(format) ?? 'application/octet-stream';
    timestamp = string(object(data.response).timestamp) ?? timestamp;
    warnings.push(...warningsOf(data.warnings));
    await append(decode(audio.base64), false);
  } else if (!native || type === 'text/event-stream') {
    await expectEventStream(response);
    if (!response.body) throw new GatewayError('The speech stream did not return a body.');
    type = native ? mediaTypeFor(format ?? 'mp3') ?? 'application/octet-stream' : '';
    let finished = false;
    for await (const part of speechEvents(response.body, signal)) {
      if (part.type === 'error') {
        if (native) throw new GatewayError('The speech stream failed.');
        warnings.push('The speech provider reported a streaming error.');
      } else if (part.type === (native ? 'speech.audio.done' : 'finish')) { finished = true; break; }
      else if (part.type === 'stream-start') warnings.push(...warningsOf(part.warnings));
      else if (part.type === 'response-metadata') timestamp = string(part.timestamp) ?? timestamp;
      else if (part.type === (native ? 'speech.audio.delta' : 'audio')) {
        if (!native) {
          const audioFormat = object(part.audioFormat);
          const next = string(audioFormat.type) ?? format;
          const nextType = audioType(next ?? '') ?? mediaTypeFor(next) ?? 'application/octet-stream';
          if (size && type !== nextType) throw new GatewayError('The speech stream changed audio formats.');
          type = nextType;
          format = next;
          if (typeof audioFormat.rate === 'number') rate = audioFormat.rate;
        }
        await append(decode(part.audio), true);
      }
    }
    if (!finished) throw new GatewayError('The speech stream ended before it completed.');
  } else {
    const binary = audioType(type);
    if (!response.body || !binary) {
      await response.body?.cancel();
      throw new GatewayError('The gateway did not return speech audio.');
    }
    type = binary === 'application/octet-stream' ? mediaTypeFor(format) ?? binary : binary;
    for await (const bytes of readChunks(response.body, signal)) await append(bytes, true);
  }
  signal?.throwIfAborted();
  if (!size) throw new GatewayError('The gateway did not return speech audio.');
  if ((type === 'application/octet-stream' || type === 'audio/pcm' || type === 'audio/l16' && request.model.startsWith('google/')) &&
      /^(?:pcm|pcm16|pcm_s16le|audio\/pcm|l16)$/i.test(format ?? '')) {
    rate ??= /^(openai|google)\//.test(request.model) ? 24000 : undefined;
    if (rate && Number.isInteger(rate) && rate >= 8000 && rate <= 192000 && size % 2 === 0) {
      chunks.unshift(wavHeader(size, rate));
      type = 'audio/wav';
      format = 'wav';
    }
  }
  return { audio: new Blob(chunks, { type }), format, model: request.model, timestamp, warnings: [...new Set(warnings)] };
}
