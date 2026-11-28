import { GatewayError, isRealtimeOnlySpeechModel, supportsRealtimeSpeech } from '@streaik/gateway';
import type { Gateway } from '@streaik/gateway';
import type { ChatVoiceSpeech } from './chatVoiceModels';
import { pcmSpeechPlayback, progressiveSpeech } from './speechPlayback';
import { readSpeechPreferences, speechOptionsForModel } from './speechPreferences';

/** Unlock once in the Start gesture. One reply at a time, independent of chat streaming. */
export function createChatVoiceOutput(gateway: Gateway, target: ChatVoiceSpeech, scope?: string) {
  let context: AudioContext | undefined;
  try {
    context = new AudioContext();
    void context.resume().catch(() => {});
  } catch { /* Encoded gateway audio can still use the media element. */ }
  let playing: AbortController | undefined;
  function interrupt() { playing?.abort(); playing = undefined; }

  async function speak(text: string) {
    interrupt();
    const controller = new AbortController();
    playing = controller;
    const { signal } = controller;
    const { model, options, rate } = target;
    const realtimeOnly = isRealtimeOnlySpeechModel(model.id);
    const preferences = readSpeechPreferences(scope);
    const overrides = Object.fromEntries(Object.entries(options).filter(([, value]) => value !== undefined));
    const request = { ...speechOptionsForModel(realtimeOnly ? 'websocket' : '/api/speech/stream', model.id, preferences), ...overrides, model: model.id, text };
    let clip: Blob | undefined;
    if (supportsRealtimeSpeech(model) && typeof WebSocket !== 'undefined' && (realtimeOnly || context && (!rate || rate === 24000 || model.provider === 'deepgram'))) {
      let started = false;
      const pcm = context && pcmSpeechPlayback(() => { started = true; }, context);
      if (pcm || realtimeOnly) {
        if (pcm) signal.addEventListener('abort', pcm.close, { once: true });
        try {
          const direct = { ...request };
          if (/^(?:audio\/)?(?:x-)?wav$/i.test(direct.outputFormat ?? '')) direct.outputFormat = 'wav';
          if (rate && model.provider === 'deepgram') direct.providerOptions = { deepgram: { ...direct.providerOptions?.deepgram, sample_rate: rate } };
          if (realtimeOnly) direct.outputSampleRate = rate;
          const result = await gateway.generateRealtimeSpeech(direct, signal, pcm?.append);
          if (await pcm?.finish()) return;
          if (realtimeOnly) clip = result.audio;
        } catch (error) {
          signal.throwIfAborted();
          if (started || realtimeOnly) throw error; // Never replay heard text or retry a WebSocket-only model over HTTP.
        } finally { if (pcm) { signal.removeEventListener('abort', pcm.close); pcm.close(); } }
      }
    }
    signal.throwIfAborted();
    if (!clip && realtimeOnly) throw new GatewayError('This speech model requires Direct WebSocket.');
    const audio = new Audio();
    let progressive: ReturnType<typeof progressiveSpeech>;
    let pcm: ReturnType<typeof pcmSpeechPlayback>;
    let started = false, attempted = false;
    let done: (() => void) | undefined;
    const finished = new Promise<void>(resolve => { done = resolve; });
    const abort = () => { pcm?.close(); progressive?.close(); audio.pause(); done?.(); };
    const markPlayed = () => { started = true; };
    audio.addEventListener('playing', markPlayed, { once: true });
    signal.addEventListener('abort', abort, { once: true });
    try {
      clip ??= (await gateway.generateSpeech('/api/speech/stream', { ...request, outputSampleRate: rate }, signal, (bytes, type, pcmRate) => {
        if (!attempted) {
          attempted = true;
          if (pcmRate && context) pcm = pcmSpeechPlayback(markPlayed, context);
          else progressive = progressiveSpeech(audio, type, () => done?.());
        }
        if (pcm && pcmRate) pcm.append(bytes, pcmRate);
        progressive?.append(bytes);
      })).audio;
      if (await pcm?.finish()) return;
      if (progressive) { progressive.finish(); await finished; if (started) return; }
      signal.throwIfAborted();
      if (context?.state === 'running') {
        const buffer = await context.decodeAudioData(await clip.arrayBuffer());
        signal.throwIfAborted();
        const source = context.createBufferSource();
        source.buffer = buffer;
        source.connect(context.destination);
        try {
          await new Promise<void>(resolve => {
            done = resolve;
            source.onended = () => resolve();
            source.start();
          });
        } finally { if (signal.aborted) source.stop(); source.disconnect(); }
      } else {
        if (!clip.type.startsWith('audio/')) throw new GatewayError('Could not play this message.');
        const url = URL.createObjectURL(clip);
        audio.src = url;
        try {
          const end = new Promise<void>((resolve, reject) => {
            done = resolve;
            audio.onended = () => resolve();
            audio.onerror = () => reject(new GatewayError('Could not play this message.'));
          });
          await Promise.all([audio.play(), end]);
        } finally { audio.removeAttribute('src'); audio.load(); URL.revokeObjectURL(url); }
      }
    } finally {
      signal.removeEventListener('abort', abort);
      audio.removeEventListener('playing', markPlayed);
      abort();
    }
  }

  return { speak, interrupt, close() { interrupt(); void context?.close().catch(() => {}); } };
}
