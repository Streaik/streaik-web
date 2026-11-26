import { GatewayError } from '@streaik/gateway';
import type { Transcript } from '@streaik/gateway';

export const maxSplittableFileBytes = 100 * 1024 * 1024;
type Part = { file: File; offset: number; end: number };
type ChunkResult = { transcript: Transcript; offset: number; end: number };

export async function* splitTranscription(file: File, maxBytes: number, overlap: number, signal: AbortSignal): AsyncGenerator<Part> {
  signal.throwIfAborted();
  const rate = 16000;
  let decoded: AudioBuffer;
  try {
    const context = new OfflineAudioContext(1, 1, rate);
    decoded = await context.decodeAudioData(await file.arrayBuffer());
  } catch {
    signal.throwIfAborted();
    throw new GatewayError('This browser could not split this audio format.');
  }
  signal.throwIfAborted();
  if (decoded.duration > 7200) throw new GatewayError('Split uploads are limited to two hours of audio.');
  const channels = Array.from({ length: decoded.numberOfChannels }, (_, i) => decoded.getChannelData(i));
  const length = Math.floor((maxBytes - 44) / 2);
  if (length < 1 || !decoded.length) throw new GatewayError('This browser could not split this audio format.');
  // Keep at least half of each chunk new, even at 1 MB with a 60-second overlap.
  const step = length - Math.min(Math.floor(length / 2), Math.round(Math.max(0, overlap) * rate));
  for (let offset = 0; offset < decoded.length; offset += step) {
    signal.throwIfAborted();
    const frames = Math.min(length, decoded.length - offset);
    const wav = new DataView(new ArrayBuffer(44 + frames * 2));
    wav.setUint32(0, 0x52494646); wav.setUint32(4, wav.byteLength - 8, true);
    wav.setUint32(8, 0x57415645); wav.setUint32(12, 0x666d7420); wav.setUint32(16, 16, true);
    wav.setUint16(20, 1, true); wav.setUint16(22, 1, true); wav.setUint32(24, rate, true);
    wav.setUint32(28, rate * 2, true); wav.setUint16(32, 2, true); wav.setUint16(34, 16, true);
    wav.setUint32(36, 0x64617461); wav.setUint32(40, frames * 2, true);
    for (let start = 0; start < frames; start += rate * 10) {
      if (start) await new Promise(resolve => setTimeout(resolve, 0));
      signal.throwIfAborted();
      for (let i = start; i < Math.min(start + rate * 10, frames); i++) {
        let sample = 0;
        for (const channel of channels) sample += channel[i + offset];
        sample = Math.max(-1, Math.min(1, sample / channels.length));
        wav.setInt16(44 + i * 2, sample * (sample < 0 ? 32768 : 32767), true);
      }
    }
    yield { file: new File([wav.buffer], 'chunk.wav', { type: 'audio/wav' }), offset: offset / rate, end: (offset + frames) / rate };
    if (offset + frames >= decoded.length) break;
  }
}

export function mergeTranscriptionChunks(results: readonly ChunkResult[]): Transcript {
  const merged: Transcript = { text: '', segments: [] };
  let previousEnd = 0;
  let coveredUntil = 0;
  const normalize = (word: string) => word.toLowerCase().replace(/^\p{P}+|\p{P}+$/gu, '');
  for (const { transcript, offset, end } of results) {
    const next = transcript.text.trim() ? transcript.text.trim().split(/\s+/u) : [];
    const hasOverlap = offset < previousEnd;
    let overlap = 0;
    if (hasOverlap && next.length && merged.text) {
      const previous = merged.text.split(/\s+/u).slice(-120).map(normalize);
      const upcoming = next.slice(0, 120).map(normalize);
      for (let count = Math.min(previous.length, upcoming.length); count >= 2; count--) {
        if (previous.slice(-count).every((word, i) => word && word === upcoming[i])) { overlap = count; break; }
      }
    }
    merged.text = [merged.text, next.slice(overlap).join(' ')].filter(Boolean).join(' ');
    const shifted = transcript.segments.map(segment => ({ ...segment, startSecond: segment.startSecond + offset, endSecond: segment.endSecond + offset }));
    merged.segments.push(...shifted.filter(segment => !hasOverlap || segment.endSecond > Math.min(coveredUntil, previousEnd) + 0.15));
    for (const segment of shifted) coveredUntil = Math.max(coveredUntil, segment.endSecond);
    merged.language ??= transcript.language;
    previousEnd = end;
    merged.durationInSeconds = end;
  }
  merged.segments.sort((a, b) => a.startSecond - b.startSecond);
  return merged;
}
