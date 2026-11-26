import type { VoiceFormat } from './socketVoiceSettings';

export const voiceSampleRate = (format: VoiceFormat) => format.type === 'audio/pcm' ? format.rate : 8000;

// xAI accepts G.711 A-law and μ-law at 8 kHz in addition to linear PCM16.
function g711Encode(sample: number, alaw: boolean) {
  if (alaw) {
    const magnitude = sample < 0 ? -sample - 1 : sample;
    const segment = Math.max(0, Math.floor(Math.log2(magnitude)) - 7);
    return ((segment << 4) | ((magnitude >> (segment ? segment + 3 : 4)) & 15)) ^ (sample < 0 ? 0x55 : 0xd5);
  }
  const magnitude = Math.min(Math.abs(sample), 32635) + 132;
  const segment = Math.floor(Math.log2(magnitude)) - 7;
  return ((segment << 4) | ((magnitude >> (segment + 3)) & 15)) ^ (sample < 0 ? 0x7f : 0xff);
}

function g711Decode(byte: number, alaw: boolean) {
  if (alaw) {
    const value = byte ^ 0x55, segment = (value >> 4) & 7;
    const base = ((value & 15) << 4) + 8;
    const magnitude = segment ? (base + 256) << (segment - 1) : base;
    return value & 0x80 ? magnitude : -magnitude;
  }
  const value = byte ^ 0xff;
  const magnitude = ((((value & 15) << 3) + 132) << ((value >> 4) & 7)) - 132;
  return value & 0x80 ? -magnitude : magnitude;
}

export function encodeVoiceAudio(pcm: ArrayBuffer, format: VoiceFormat) {
  if (format.type === 'audio/pcm') return btoa(String.fromCharCode(...new Uint8Array(pcm)));
  const samples = new DataView(pcm), bytes = new Uint8Array(samples.byteLength / 2);
  for (let i = 0; i < bytes.length; i++) bytes[i] = g711Encode(samples.getInt16(i * 2, true), format.type === 'audio/pcma');
  return btoa(String.fromCharCode(...bytes));
}

export function decodeVoiceAudio(base64: string, format: VoiceFormat) {
  const bytes = atob(base64), pcm = format.type === 'audio/pcm';
  const samples = new Float32Array(Math.floor(bytes.length / (pcm ? 2 : 1)));
  for (let i = 0; i < samples.length; i++) {
    const sample = pcm ? (bytes.charCodeAt(2 * i) | (bytes.charCodeAt(2 * i + 1) << 8)) << 16 >> 16
      : g711Decode(bytes.charCodeAt(i), format.type === 'audio/pcma');
    samples[i] = sample / 32768;
  }
  return samples;
}

export function voicePlayback(context: AudioContext, format: VoiceFormat) {
  const nodes = new Set<AudioBufferSourceNode>();
  let cursor = 0;
  return {
    play(encoded: string, mimeType?: string) {
      const rate = mimeType ? Number(/(?:^|;)\s*rate=(\d+)/.exec(mimeType)?.[1] ?? voiceSampleRate(format)) : voiceSampleRate(format);
      if (rate < 8000 || rate > 48000 || cursor - context.currentTime > 12) throw new Error('Invalid realtime audio stream.');
      const samples = decodeVoiceAudio(encoded, format);
      if (!samples.length) return;
      const buffer = context.createBuffer(1, samples.length, rate);
      buffer.getChannelData(0).set(samples);
      const source = context.createBufferSource();
      source.buffer = buffer;
      source.connect(context.destination);
      source.onended = () => { nodes.delete(source); source.disconnect(); };
      const start = Math.max(context.currentTime, cursor);
      source.start(start);
      cursor = start + buffer.duration;
      nodes.add(source);
    },
    interrupt() {
      for (const source of nodes) { source.onended = null; source.stop(); source.disconnect(); }
      nodes.clear(); cursor = 0;
    },
  };
}
