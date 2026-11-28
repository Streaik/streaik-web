import { GatewayError } from './index.ts';
import type { CatalogModel } from './index.ts';
import { wavHeader } from './speech.ts';
import type { SpeechRequest, SpeechResponse } from './speech.ts';
import { StreamingWave } from './streamingWave.ts';

const cartesiaVersion = '2026-08-14';
const cartesiaModel = /^cartesia\/tts\/(sonic-3\.6)\/([\w-]+)$/;
const tokenPart = /^[!#$%&'*+.^_`|~\w-]+$/;
const frameLimit = 2 * 1024 * 1024;
const audioLimit = 25 * 1024 * 1024;

export function realtimeSpeechProvider(id: string) {
  if (id === 'mistral/voxtral-mini-tts-3-0') return 'mistral';
  if (id === 'deepgram/aura-2-asteria-en') return 'deepgram';
  if (cartesiaModel.test(id)) return 'cartesia';
}

export const supportsRealtimeSpeech = (model?: Pick<CatalogModel, 'id' | 'type' | 'tags'>) =>
  !!model && model.type === 'speech' && model.tags.includes('realtime') && !!realtimeSpeechProvider(model.id);

export type SpeechPcm = (bytes: Uint8Array<ArrayBuffer>, rate: number) => void;
type Event = Record<string, unknown>;
type Send = (event: object) => void;
type Protocol = {
  url: URL;
  connect: (token: string) => WebSocket;
  start: (send: Send) => void;
  event: (event: Event, send: Send) => boolean | void;
  binary?: (bytes: Uint8Array<ArrayBuffer>) => void;
};

const invalidSetting = (setting: string) => new GatewayError(`${setting} is not supported by this speech WebSocket. Change the setting or choose a Gateway route.`);

function rate(value: unknown, allowed: number[]) {
  if (value === undefined) return 24000;
  if (typeof value !== 'number' || !allowed.includes(value)) throw invalidSetting('The selected sample rate');
  return value;
}

function checkSpeed(speed: number | undefined, min: number, max: number) {
  if (speed !== undefined && (!Number.isFinite(speed) || speed < min || speed > max)) throw invalidSetting('The selected speed');
}

function decode(value: unknown) {
  if (typeof value !== 'string' || !value) throw new Error('Invalid speech packet');
  return Uint8Array.from(atob(value), char => char.charCodeAt(0));
}

// Split at provider message limits without deleting whitespace or splitting surrogate pairs.
function submit(text: string, append: (part: string) => void) {
  for (let i = 0; i < text.length;) {
    let end = Math.min(i + 1000, text.length);
    if (end < text.length && /[\uD800-\uDBFF]/.test(text[end - 1])) end--;
    append(text.slice(i, end));
    i = end;
  }
}

function protocolFor(request: SpeechRequest, output: SpeechPcm): Protocol {
  const { model, text, voice, speed, language, outputFormat, instructions, streamFormat, providerOptions } = request;
  const provider = realtimeSpeechProvider(model);
  if (!provider) throw new GatewayError('This speech model does not support Direct WebSocket. Choose a Gateway route or a compatible model.');
  if (!text.trim() || text.length > 100_000) throw new GatewayError('Enter between 1 and 100,000 characters for WebSocket speech.');
  if (outputFormat && outputFormat !== 'wav') throw invalidSetting('The selected output format');
  if (instructions) throw invalidSetting('Instructions');
  if (streamFormat) throw invalidSetting('The selected stream format');
  const localModel = model.slice(provider.length + 1);
  const options = providerOptions?.[provider] ?? {};
  const checkOptions = (allowed: string[]) => {
    if (Object.entries(options).some(([key, value]) => value !== undefined && !allowed.includes(key))) throw invalidSetting('A provider speech setting');
  };

  if (provider === 'deepgram') {
    checkOptions(['sample_rate', 'mip_opt_out']);
    if (language) throw invalidSetting('Language');
    if (voice && voice !== localModel) throw invalidSetting('The selected voice');
    checkSpeed(speed, 0.7, 1.5);
    const sampleRate = rate(options.sample_rate, [8000, 16000, 24000, 32000, 48000]);
    const url = new URL(`wss://api.deepgram.com/v1/speak?model=${localModel}`);
    return { url, connect(token) {
      const socket = new URL(url);
      socket.searchParams.set('encoding', 'linear16');
      socket.searchParams.set('sample_rate', String(sampleRate));
      if (speed !== undefined) socket.searchParams.set('speed', String(speed));
      if (typeof options.mip_opt_out === 'boolean') socket.searchParams.set('mip_opt_out', String(options.mip_opt_out));
      return new WebSocket(socket, ['bearer', token]);
    }, start(send) {
      submit(text, part => send({ type: 'Speak', text: part }));
      send({ type: 'Flush' });
    }, binary: bytes => output(bytes, sampleRate), event: event => event.type === 'Flushed' };
  }

  if (provider === 'cartesia') {
    checkOptions([]);
    const [, modelId, voiceId] = cartesiaModel.exec(model)!;
    if (voice && voice !== voiceId) throw invalidSetting('The selected voice');
    checkSpeed(speed, 0.6, 1.5);
    const sampleRate = 24000, contextId = crypto.randomUUID();
    const url = new URL(`wss://api.cartesia.ai/tts/websocket?cartesia_version=${cartesiaVersion}`);
    const config = { model_id: modelId, voice: { id: voiceId }, context_id: contextId,
      output_format: { container: 'raw', encoding: 'pcm_s16le', sample_rate: sampleRate },
      ...(language && { language }), ...(speed !== undefined && { generation_config: { speed } }), max_buffer_delay_ms: 200 };
    return { url, connect(token) {
      const socket = new URL(url);
      socket.searchParams.set('access_token', token);
      return new WebSocket(socket);
    }, start(send) {
      submit(text, transcript => send({ ...config, transcript, continue: true }));
      send({ ...config, transcript: '', continue: false });
    }, event(event) {
      if (event.context_id !== contextId) return;
      if (event.type === 'chunk') output(decode(event.data), sampleRate);
      return event.type === 'done' || event.type === 'chunk' && event.done === true;
    } };
  }

  checkOptions([]);
  if (language) throw invalidSetting('Language');
  if (speed !== undefined) throw invalidSetting('Speed');
  if (voice && !/^voice_\d+$/.test(voice)) throw invalidSetting('The selected voice');
  const url = new URL(`wss://api.mistral.ai/v1/audio/speech/realtime?model=${localModel}`);
  const session = { voice: voice ?? 'voice_447', streaming_mode: 'responsive', response_format: 'wav' };
  const wave = new StreamingWave(output);
  let phase: 'opening' | 'configuring' | 'generating' = 'opening';
  return { url, connect: token => new WebSocket(url, ['realtime', token]), start() {}, event(event, send) {
    switch (event.type) {
      case 'session.created':
        if (phase !== 'opening') throw new Error('Unexpected speech session');
        phase = 'configuring';
        send({ type: 'session.update', session });
        break;
      case 'session.updated': {
        const confirmed = event.session as Partial<typeof session> | undefined;
        if (phase !== 'configuring' || confirmed?.voice !== session.voice || confirmed?.streaming_mode !== session.streaming_mode ||
            confirmed?.response_format !== session.response_format) throw new Error('Incompatible speech session');
        phase = 'generating';
        submit(text, part => send({ type: 'input_text.append', text: part }));
        send({ type: 'input_text.end' });
        break;
      }
      case 'speech.audio.delta':
        if (phase !== 'generating') throw new Error('Audio before speech input');
        wave.push(decode(event.audio_data));
        break;
      case 'speech.audio.done':
        if (phase !== 'generating') throw new Error('Completion before speech input');
        wave.finish();
        return true;
    }
  } };
}

export async function streamRealtimeSpeech(request: SpeechRequest, credential: (signal: AbortSignal) => Promise<unknown>,
  signal: AbortSignal, onPcm?: SpeechPcm): Promise<SpeechResponse> {
  const chunks: Uint8Array<ArrayBuffer>[] = [];
  let bytes = 0, sampleRate = 0;
  const protocol = protocolFor(request, (pcm, rate) => {
    if (sampleRate && rate !== sampleRate) throw new Error('Speech sample rate changed');
    sampleRate = rate;
    bytes += pcm.byteLength;
    if (bytes > audioLimit) throw new Error('Speech audio exceeded its limit');
    chunks.push(pcm);
    if (pcm.length) onPcm?.(pcm, rate);
  });
  signal.throwIfAborted();
  const secret = await credential(AbortSignal.any([signal, AbortSignal.timeout(15_000)])) as { token?: unknown; url?: unknown; expiresAt?: unknown } | null;
  signal.throwIfAborted();
  if (typeof secret?.token !== 'string' || !secret.token || secret.token.length > 4096 ||
      (request.model.startsWith('mistral/') && (!secret.token.startsWith('rt_') || !tokenPart.test(secret.token))) ||
      (request.model.startsWith('deepgram/') && !tokenPart.test(secret.token)) ||
      typeof secret.expiresAt !== 'number' || !Number.isFinite(secret.expiresAt) || secret.expiresAt <= Date.now() / 1000 ||
      secret.url !== protocol.url.href) throw new GatewayError('The gateway returned an invalid or expired speech credential.');

  await new Promise<void>((resolve, reject) => {
    let socket: WebSocket;
    try { socket = protocol.connect(secret.token as string); }
    catch { reject(new GatewayError('Could not open the speech WebSocket.')); return; }
    socket.binaryType = 'arraybuffer';
    let settled = false;
    const cleanup = () => {
      settled = true;
      clearTimeout(timer);
      signal.removeEventListener('abort', abort);
      socket.onopen = socket.onmessage = socket.onclose = socket.onerror = null;
      socket.close();
    };
    const fail = (message: string) => { cleanup(); reject(new GatewayError(message)); };
    const abort = () => { cleanup(); reject(signal.reason); };
    const timer = setTimeout(() => fail('The speech WebSocket timed out.'), 60_000);
    const send: Send = event => {
      if (socket.bufferedAmount > 1024 * 1024) throw new Error('Speech input backlog');
      socket.send(JSON.stringify(event));
    };
    signal.addEventListener('abort', abort, { once: true });
    socket.onopen = () => {
      try { protocol.start(send); } catch { fail('Could not send speech text to the provider.'); }
    };
    socket.onclose = () => fail('The speech WebSocket closed before completion.');
    socket.onerror = () => fail('Could not connect to the speech provider.');
    socket.onmessage = ({ data }) => {
      if (settled) return;
      try {
        if (data instanceof ArrayBuffer && protocol.binary && data.byteLength <= frameLimit) {
          protocol.binary(new Uint8Array(data));
          return;
        }
        if (typeof data !== 'string' || data.length > frameLimit) throw new Error('Invalid speech frame');
        const event = JSON.parse(data) as Event;
        if (event.type === 'error' || event.type === 'Error' || (typeof event.status_code === 'number' && event.status_code >= 400)) {
          fail('The provider reported a WebSocket speech error. Check the selected model and settings.');
          return;
        }
        if (protocol.event(event, send)) {
          if (!bytes || bytes % 2) throw new Error('Incomplete speech audio');
          cleanup();
          resolve();
        }
      } catch { fail('The provider returned invalid or incomplete WebSocket speech.'); }
    };
  });
  signal.throwIfAborted();
  return { audio: new Blob([wavHeader(bytes, sampleRate), ...chunks], { type: 'audio/wav' }), format: 'wav',
    model: request.model, timestamp: new Date().toISOString(), warnings: [] };
}
