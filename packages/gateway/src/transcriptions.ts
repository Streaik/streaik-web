import { GatewayError, expectEventStream } from './index.ts';

export const gatewayTranscriptionEndpoints = ['/api/transcriptions', '/v1/audio/transcriptions', '/api/transcriptions/stream'] as const;
export type GatewayTranscriptionEndpoint = typeof gatewayTranscriptionEndpoints[number];
export const isTranscriptionEndpoint = (value: unknown): value is GatewayTranscriptionEndpoint =>
  gatewayTranscriptionEndpoints.some(endpoint => endpoint === value);

export type TranscriptSegment = { text: string; startSecond: number; endSecond: number; speaker?: string };
export type Transcript = { text: string; segments: TranscriptSegment[]; durationInSeconds?: number; language?: string };
export type TranscriptionOptions = { language?: string; prompt?: string; diarization?: boolean };
export type LiveTranscriptionCredential = { provider: 'openai'; secret: string }
  | { provider: 'gladia' | 'google' | 'assemblyai'; url: string }
  | { provider: 'deepgram'; url: string; secret: string };

const mediaTypes: Record<string, string> = {
  mp3: 'audio/mpeg', mpga: 'audio/mpeg', mpeg: 'audio/mpeg', wav: 'audio/wav', m4a: 'audio/mp4', mp4: 'audio/mp4',
  webm: 'audio/webm', flac: 'audio/flac', ogg: 'audio/ogg', oga: 'audio/ogg', opus: 'audio/ogg', aac: 'audio/aac',
  aif: 'audio/aiff', aiff: 'audio/aiff', wma: 'audio/x-ms-wma', mov: 'audio/quicktime',
};
export const transcriptionFileAccept = `audio/*,${Object.keys(mediaTypes).map(ext => `.${ext}`).join(',')}`;
export function transcriptionUploadLimit(route: GatewayTranscriptionEndpoint) {
  if (route === '/v1/audio/transcriptions') return 25 * 1024 * 1024 - 16 * 1024;
  // JSON carries base64; leave room for settings under Kestrel's default 30 MB body limit.
  return Math.floor((30_000_000 - 64 * 1024) * 3 / 4);
}

export function transcriptionMediaType(file: File): string | undefined {
  const type = file.type.split(';')[0].toLowerCase();
  const ext = file.name.split('.').at(-1)?.toLowerCase() ?? '';
  return (Object.hasOwn(mediaTypes, ext) ? mediaTypes[ext] : undefined) ?? (/^audio\/[\w.+-]+$/.test(type) ? type : undefined);
}

const openAILive = /^openai\/gpt-live-transcribe(?:-\d{4}-\d{2}-\d{2})?$/;
const openAIWhisper = /^openai\/gpt-realtime-whisper(?:-\d{4}-\d{2}-\d{2})?$/;
const openAILegacyLive = /^openai\/gpt-realtime(?:-[\w-]+)?-transcribe(?:-|$)/;
const googleLiveSocket = 'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContentConstrained';
const deepgramLiveSocket = 'wss://api.deepgram.com/v1/listen';
const assemblyAILiveSocket = 'wss://streaming.assemblyai.com/v3/ws';
const assemblyAIRealtime = 'assemblyai/assemblyai-stt-3-7-realtime';

function googleLiveTranscription(model: string) {
  return model === 'google/gemini-3.5-transcribe-live';
}

export function isLiveTranscriptionModel(model: string) {
  return !!liveTranscriptionProvider(model);
}

export function liveTranscriptionProvider(model: string) {
  if (openAILive.test(model) || openAIWhisper.test(model) || openAILegacyLive.test(model)) return 'openai';
  if (model === 'gladia/solaria-1') return 'gladia';
  if (googleLiveTranscription(model)) return 'google';
  if (model === 'deepgram/nova-3' || model === 'deepgram/nova-2') return 'deepgram';
  if (model === assemblyAIRealtime || /^assemblyai\/universal-streaming-(english|multilingual)$/.test(model)) return 'assemblyai';
}

export function usesTranscriptionWebSocket(model: string) {
  const provider = liveTranscriptionProvider(model);
  return provider === 'openai' ? openAITranscriptionSocket(model) : provider !== undefined;
}

export function openAITranscriptionSocket(model: string) {
  return openAILive.test(model) || openAIWhisper.test(model);
}

export function openAITranscriptionSession(model: string, language?: string) {
  const socket = openAITranscriptionSocket(model);
  return { type: 'transcription', audio: { input: {
    ...(socket ? { format: { type: 'audio/pcm', rate: 24000 } } : {}),
    transcription: { model, ...(language ? openAILive.test(model) ? { languages: [language] } : { language } : {}) },
    turn_detection: socket ? null : { type: 'server_vad' },
  } } };
}

export function googleLiveTranscriptionSetup(model: string, language?: string) {
  // Default to verbatim and automatic language detection. Accept the shared language hint when provided.
  return { model: `models/${model.slice('google/'.length)}`, generationConfig: { responseModalities: ['TEXT'] },
    inputAudioTranscription: { languageCodes: language ? [language] : [], mode: 'VERBATIM' } };
}

export function supportsFileTranscription(route: GatewayTranscriptionEndpoint, model: string) {
  if (googleLiveTranscription(model) || !/^(openai|openrouter|google|gladia|deepgram)\//.test(model) ||
      (model.startsWith('openai/') && (isLiveTranscriptionModel(model) || /^openai\/gpt-(?:4o-)?realtime/.test(model)))) return false;
  return route !== '/api/transcriptions/stream' || /^openai\/gpt-(?:4o(?:-mini)?-)?transcribe(?:$|-(?!diarize))/.test(model) || model.startsWith('deepgram/');
}

async function base64(file: File) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const pieces: string[] = [];
  // Each piece is a multiple of 3 bytes so only the last piece contains padding.
  for (let i = 0; i < bytes.length; i += 24576) pieces.push(btoa(String.fromCharCode(...bytes.subarray(i, i + 24576))));
  return pieces.join('');
}

export async function transcriptionBody(route: GatewayTranscriptionEndpoint, model: string, file: File, settings: TranscriptionOptions): Promise<RequestInit> {
  const provider = model.split('/')[0];
  const mediaType = transcriptionMediaType(file);
  if (!mediaType || !file.size) throw new GatewayError('Choose a supported, nonempty audio file.');
  if (file.size > transcriptionUploadLimit(route)) throw new GatewayError('This audio file exceeds the upload limit.');
  const options: Record<string, string | boolean> = {};
  if (settings.language?.trim()) options.language = settings.language.trim();
  if (provider === 'openai' && !model.includes('diarize') && settings.prompt?.trim()) options.prompt = settings.prompt.trim();
  if (provider === 'gladia' && route === '/api/transcriptions' && settings.diarization) options.diarization = true;
  if (route === '/v1/audio/transcriptions') {
    const body = new FormData();
    body.set('model', model);
    body.set('file', file.slice(0, file.size, mediaType), file.name);
    for (const [key, value] of Object.entries(options)) body.set(key, String(value));
    if (provider === 'openai' && model.includes('diarize')) {
      body.set('response_format', 'diarized_json');
      body.set('chunking_strategy', 'auto');
    } else if (model === 'openai/whisper-1' || provider !== 'openai') body.set('response_format', 'verbose_json');
    return { body, headers: { accept: 'application/json' } };
  }
  const stream = route === '/api/transcriptions/stream';
  return {
    body: JSON.stringify({ model, audio: await base64(file), ...(stream ? { inputAudioFormat: { type: mediaType } } : { mediaType }),
      ...(Object.keys(options).length ? { providerOptions: { [provider]: options } } : {}) }),
    headers: { 'content-type': 'application/json', accept: stream ? 'text/event-stream' : 'application/json' },
  };
}

export function object(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function segments(value: unknown, allowSpeaker: boolean): TranscriptSegment[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap(item => {
    const { text, startSecond, endSecond, start = startSecond, end = endSecond, speaker } = object(item);
    return typeof text === 'string' && typeof start === 'number' && typeof end === 'number' && Number.isFinite(start) && Number.isFinite(end)
      ? [{ text, startSecond: start, endSecond: end, speaker: allowSpeaker && (typeof speaker === 'string' || typeof speaker === 'number') ? String(speaker) : undefined }] : [];
  });
}

export function readTranscript(payload: unknown, native = false): Transcript {
  const { text, language, durationInSeconds, duration = durationInSeconds, segments: raw, providerMetadata } = object(payload);
  if (typeof text !== 'string') throw new GatewayError('The gateway returned an unreadable transcript.');
  // Vercel segments are contract-locked. Speakers come only from native output or provider metadata.
  const metadata = object(providerMetadata);
  const providerSegments = native ? [] : segments(object(metadata.gladia).utterances ?? object(metadata.openai).segments, true);
  return { text, segments: providerSegments.length ? providerSegments : segments(raw, native),
    durationInSeconds: typeof duration === 'number' ? duration : undefined, language: typeof language === 'string' ? language : undefined };
}

export async function readTranscriptStream(response: Response, preview: (text: string) => void, signal?: AbortSignal): Promise<Transcript> {
  await expectEventStream(response);
  const reader = response.body?.pipeThrough(new TextDecoderStream()).getReader();
  if (!reader) throw new GatewayError('The transcription stream did not return a body.');
  let buffer = '', text = '';
  let data: string[] = [];
  try {
    for (;;) {
      const { done, value } = await reader.read();
      signal?.throwIfAborted();
      if (done) break;
      buffer += value;
      let index: number;
      while ((index = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, index).replace(/\r$/, '');
        buffer = buffer.slice(index + 1);
        if (line.startsWith('data:')) { data.push(line.slice(5).replace(/^ /, '')); continue; }
        if (line || !data.length) continue;
        const frame = data.join('\n');
        data = [];
        if (frame === '[DONE]') throw new GatewayError('The transcription stream ended before a final transcript arrived.');
        let part: Record<string, unknown>;
        try { part = object(JSON.parse(frame)); }
        catch { throw new GatewayError('The transcription stream returned an unreadable event.'); }
        if (part.type === 'error') throw new GatewayError('The transcription stream failed.');
        if (part.type === 'finish' || part.type === 'transcript.text.done') return readTranscript(part);
        if (part.type === 'transcript-delta' || part.type === 'transcript.text.delta') {
          if (typeof part.delta === 'string') { text += part.delta; preview(text); }
        } else if (part.type === 'transcript-partial' && typeof part.text === 'string') preview([text, part.text].filter(Boolean).join(' '));
        else if (part.type === 'transcript-final' && typeof part.text === 'string') { text = [text, part.text].filter(Boolean).join(' '); preview(text); }
      }
      if (buffer.length + data.reduce((size, line) => size + line.length, 0) > 4_000_000) throw new GatewayError('The transcription stream returned an oversized event.');
    }
    throw new GatewayError('The transcription stream ended before a final transcript arrived.');
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}

export function readLiveTranscriptionCredential(model: string, payload: unknown, language?: string): LiveTranscriptionCredential {
  const provider = liveTranscriptionProvider(model);
  const { value, url, token, expires_at, expiresAt = expires_at } = object(payload);
  if (typeof expiresAt === 'number' && expiresAt * 1000 <= Date.now()) throw new GatewayError('The microphone session credential expired. Start again.');
  if (provider === 'openai' && typeof value === 'string' && value.trim()) return { provider, secret: value };
  if (provider === 'google' && url === googleLiveSocket && typeof token === 'string' && /^\S{1,4096}$/.test(token) &&
      typeof expiresAt === 'number' && Number.isFinite(expiresAt)) {
    const target = new URL(googleLiveSocket);
    target.searchParams.set('access_token', token);
    return { provider, url: target.href };
  }
  if ((provider === 'deepgram' || provider === 'assemblyai') && typeof token === 'string' &&
      typeof expiresAt === 'number' && Number.isSafeInteger(expiresAt)) {
    const native = model.slice(provider.length + 1);
    if (provider === 'deepgram' && /^[\w.-]{1,4096}$/.test(token)) {
      const target = new URL(deepgramLiveSocket);
      target.searchParams.set('model', native);
      if (url === target.href) {
        target.searchParams.set('encoding', 'linear16');
        target.searchParams.set('sample_rate', '16000');
        target.searchParams.set('channels', '1');
        target.searchParams.set('interim_results', 'true');
        target.searchParams.set('punctuate', 'true');
        if (language) target.searchParams.set('language', language);
        return { provider, url: target.href, secret: token };
      }
    }
    if (provider === 'assemblyai' && /^\S{1,4096}$/.test(token)) {
      const target = new URL(assemblyAILiveSocket);
      target.searchParams.set('sample_rate', '16000');
      target.searchParams.set('speech_model', native);
      if (url === target.href) {
        target.searchParams.set('encoding', 'pcm_s16le');
        if (model !== assemblyAIRealtime) target.searchParams.set('format_turns', 'true');
        if (model !== 'assemblyai/universal-streaming-english') target.searchParams.set('language_detection', 'true');
        if (language && model === assemblyAIRealtime) target.searchParams.set('language_codes', JSON.stringify([language]));
        target.searchParams.set('token', token);
        return { provider, url: target.href };
      }
    }
  }
  if (provider === 'gladia' && typeof url === 'string') {
    let target: URL | undefined;
    try { target = new URL(url); } catch { /* Use the generic error below. */ }
    if (target?.protocol === 'wss:' && !target.username && !target.password && !target.port && !target.hash &&
      (target.hostname === 'gladia.io' || target.hostname.endsWith('.gladia.io'))) return { provider, url: target.href };
  }
  throw new GatewayError('The gateway did not return a valid microphone session credential.');
}
