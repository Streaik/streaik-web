import { GatewayError } from '@streaik/gateway';
import type { Transcript } from '@streaik/gateway';

export const maxSplittableFileBytes = 100 * 1024 * 1024;
type Part = { file: File; offset: number };
type ChunkResult = { transcript: Transcript; offset: number };

export async function* splitTranscription(file: File, maxBytes: number, overlap: number, signal: AbortSignal): AsyncGenerator<Part> {
  const rate = 16000;
  let decoded: AudioBuffer;
  try {
    const context = new OfflineAudioContext(1, 1, rate);
    decoded = await context.decodeAudioData(await file.arrayBuffer());
  } catch { throw new GatewayError('This browser could not split this audio format.'); }
  signal.throwIfAborted();
  if (decoded.duration > 7200) throw new GatewayError('Split uploads are limited to two hours of audio.');
  const channels = Array.from({ length: decoded.numberOfChannels }, (_, i) => decoded.getChannelData(i));
  const length = Math.floor((maxBytes - 44) / 2);
  const step = length - Math.round(overlap * rate);
  for (let offset = 0; offset < decoded.length; offset += step) {
    signal.throwIfAborted();
    const frames = Math.min(length, decoded.length - offset);
    const wav = new DataView(new ArrayBuffer(44 + frames * 2));
    wav.setUint32(0, 0x52494646); wav.setUint32(4, wav.byteLength - 8, true);
    wav.setUint32(8, 0x57415645); wav.setUint32(12, 0x666d7420); wav.setUint32(16, 16, true);
    wav.setUint16(20, 1, true); wav.setUint16(22, 1, true); wav.setUint32(24, rate, true);
    wav.setUint32(28, rate * 2, true); wav.setUint16(32, 2, true); wav.setUint16(34, 16, true);
    wav.setUint32(36, 0x64617461); wav.setUint32(40, frames * 2, true);
    for (let i = 0; i < frames; i++) {
      let sample = 0;
      for (const channel of channels) sample += channel[i + offset];
      sample = Math.max(-1, Math.min(1, sample / channels.length));
      wav.setInt16(44 + i * 2, sample * (sample < 0 ? 32768 : 32767), true);
    }
    yield { file: new File([wav.buffer], 'chunk.wav', { type: 'audio/wav' }), offset: offset / rate };
    if (offset + frames >= decoded.length) break;
  }
}

export function mergeTranscriptionChunks(results: readonly ChunkResult[]): Transcript {
  const merged: Transcript = { text: '', segments: [] };
  for (const { transcript, offset } of results) {
    const previous = merged.text.split(/\s+/u);
    const next = transcript.text.trim().split(/\s+/u);
    const normalize = (word: string) => word.toLowerCase().replace(/^\p{P}+|\p{P}+$/gu, '');
    let overlap = 0;
    if (offset && transcript.text.trim() && previous[0]) {
      for (let count = Math.min(60, previous.length, next.length); count >= 2; count--) {
        if (previous.slice(-count).every((word, i) => normalize(word) === normalize(next[i]))) { overlap = count; break; }
      }
    }
    merged.text = [merged.text, next.slice(overlap).join(' ')].filter(Boolean).join(' ');
    const coveredUntil = merged.segments.at(-1)?.endSecond ?? 0;
    for (const segment of transcript.segments) {
      const startSecond = segment.startSecond + offset, endSecond = segment.endSecond + offset;
      if (!offset || endSecond > coveredUntil + 0.15) merged.segments.push({ ...segment, startSecond, endSecond });
    }
    merged.language ??= transcript.language;
    if (transcript.durationInSeconds !== undefined) merged.durationInSeconds = offset + transcript.durationInSeconds;
  }
  return merged;
}
