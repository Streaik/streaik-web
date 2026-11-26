import { GatewayError, expectEventStream } from './index.ts';

export const gatewayTranscriptionEndpoints = ['/api/transcriptions', '/v1/audio/transcriptions', '/api/transcriptions/stream'] as const;
export type GatewayTranscriptionEndpoint = typeof gatewayTranscriptionEndpoints[number];
export const isTranscriptionEndpoint = (value: unknown): value is GatewayTranscriptionEndpoint =>
  gatewayTranscriptionEndpoints.some(endpoint => endpoint === value);

export type TranscriptSegment = { text: string; startSecond: number; endSecond: number; speaker?: string };
export type Transcript = { text: string; segments: TranscriptSegment[]; durationInSeconds?: number; language?: string };
type TranscriptionValue = string | number | boolean | TranscriptionConfig | readonly string[];
export type TranscriptionConfig = { [key: string]: TranscriptionValue | undefined };
export type TranscriptionOptions = { providerOptions?: Readonly<Record<string, TranscriptionConfig>>; language?: string; prompt?: string; diarization?: boolean };
export type GoogleLiveTranscriptionConfig = { languageCodes?: string[]; customVocabulary?: string[]; mode?: 'VERBATIM' | 'SMART' };
export type LiveTranscriptionOptions = { language?: string; google?: GoogleLiveTranscriptionConfig };
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

export function googleLiveTranscriptionSetup(model: string, config?: GoogleLiveTranscriptionConfig | string) {
  const { languageCodes = [], mode = 'VERBATIM', customVocabulary } = typeof config === 'string' ? { languageCodes: [config] } : config ?? {};
  return { model: `models/${model.slice('google/'.length)}`, generationConfig: { responseModalities: ['TEXT'] },
    inputAudioTranscription: { languageCodes, mode, ...(customVocabulary?.length ? { customVocabulary } : {}) } };
}

export function supportsFileTranscription(route: GatewayTranscriptionEndpoint, model: string) {
  if (googleLiveTranscription(model) || !/^(openai|openrouter|google|gladia|deepgram)\//.test(model) ||
      (model.startsWith('openai/') && (isLiveTranscriptionModel(model) || /^openai\/gpt-(?:4o-)?realtime/.test(model)))) return false;
  return route !== '/api/transcriptions/stream' || /^openai\/gpt-(?:4o(?:-mini)?-)?transcribe(?:$|-(?!diarize))/.test(model) || model.startsWith('deepgram/');
}

export function openAITranscriptionFormats(model: string): readonly string[] {
  if (model === 'openai/whisper-1') return ['verbose_json', 'json', 'text', 'srt', 'vtt'];
  if (model.includes('transcribe-diarize')) return ['diarized_json', 'json', 'text'];
  return ['json', 'text'];
}

export const deepgramTranscriptionSwitches = ['detect_language', 'smart_format', 'punctuate', 'diarize', 'utterances', 'numerals', 'profanity_filter', 'mip_opt_out'] as const;

function fileOptions(route: GatewayTranscriptionEndpoint, model: string, settings: TranscriptionOptions) {
  const provider = model.split('/')[0];
  const config = settings.providerOptions?.[provider] ?? {};
  const native = route === '/v1/audio/transcriptions';
  const batch = route === '/api/transcriptions';
  const options: TranscriptionConfig = {};
  const language = config.language ?? settings.language;
  if (typeof language === 'string' && language.trim()) options.language = language.trim();
  function copy(...keys: string[]) {
    for (const key of keys) {
      const value = config[key];
      if (typeof value === 'string' ? value.trim() : value !== undefined) options[key] = typeof value === 'string' ? value.trim() : value;
    }
  }
  if (provider === 'openai') {
    const diarized = model.includes('transcribe-diarize');
    if (!diarized) {
      copy('prompt', 'temperature');
      if (options.prompt === undefined && settings.prompt?.trim()) options.prompt = settings.prompt.trim();
    } else if (native || batch) {
      options.chunking_strategy = 'auto';
    }
    const formats = openAITranscriptionFormats(model);
    if (native) options.response_format = typeof config.response_format === 'string' && formats.includes(config.response_format) ? config.response_format : formats[0];
    const timestamps = config['timestamp_granularities[]'];
    if (model === 'openai/whisper-1' && (batch || options.response_format === 'verbose_json') && Array.isArray(timestamps)) {
      const allowed = timestamps.filter(value => value === 'word' || value === 'segment');
      // The SDK adapter accepts one multipart value per key; native multipart supports repetition.
      if (allowed.length) options['timestamp_granularities[]'] = native ? allowed : allowed[0];
    }
  } else if (provider === 'deepgram') {
    copy(...deepgramTranscriptionSwitches);
    copy(model.startsWith('deepgram/nova-3') ? 'keyterm' : 'keywords');
    if (options.detect_language === true) delete options.language;
  } else if (provider === 'gladia') {
    if (batch) {
      copy('language_config', 'diarization', 'diarization_config', 'custom_vocabulary', 'custom_vocabulary_config', 'detect_entities', 'sentiment_analysis', 'summarization');
      if (options.diarization === undefined && settings.diarization) options.diarization = true;
    }
  } else if (provider === 'google' && batch) copy('generation_config', 'service_tier');
  if (native && provider !== 'openai') options.response_format = 'verbose_json';
  return options;
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
  const options = fileOptions(route, model, settings);
  if (route === '/v1/audio/transcriptions') {
    const body = new FormData();
    body.set('model', model);
    body.set('file', file.slice(0, file.size, mediaType), file.name);
    for (const [key, value] of Object.entries(options)) {
      if (Array.isArray(value)) for (const item of value) body.append(key, item);
      else if (value !== undefined) body.set(key, typeof value === 'object' ? JSON.stringify(value) : String(value));
    }
    return { body, headers: { accept: options.response_format === 'vtt' ? 'text/vtt' : options.response_format === 'srt' || options.response_format === 'text' ? 'text/plain' : 'application/json' } };
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

export function readNativeTranscript(text: string, format: string): Transcript {
  if (format === 'text') return { text, segments: [] };
  const seconds = (value: string) => value.replace(',', '.').split(':').reduce((n, part) => n * 60 + Number(part), 0);
  const segments = text.trim().split(/\r?\n[\t ]*\r?\n/).flatMap(block => {
    const lines = block.split(/\r?\n/);
    const cue = lines.findIndex(line => /^\d[\d:.,]+\s+-->\s+\d/.test(line));
    if (cue < 0) return [];
    const [start, , end] = lines[cue].split(/\s+/);
    return [{ text: lines.slice(cue + 1).join(' '), startSecond: seconds(start), endSecond: seconds(end) }];
  });
  return { text: segments.map(segment => segment.text).join(' '), segments };
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
