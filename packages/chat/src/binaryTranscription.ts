import type { Transcript, TranscriptSegment } from '@streaik/gateway';

type EventData = Record<string, unknown>;
type Update = (transcript: Transcript, partial: string) => void;
type Piece = { text: string; range?: Pick<TranscriptSegment, 'startSecond' | 'endSecond'>; language?: string };

const object = (value: unknown): EventData => value && typeof value === 'object' ? value as EventData : {};
const seconds = (value: unknown) => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined;
const text = (value: unknown) => typeof value === 'string' ? value.trim() : '';

function wordRange(words: unknown, scale = 1): Piece['range'] {
  if (!Array.isArray(words)) return;
  let start = Infinity, end = -Infinity;
  for (const word of words) {
    const from = seconds(object(word).start), to = seconds(object(word).end);
    if (from === undefined || to === undefined || to < from) continue;
    start = Math.min(start, from);
    end = Math.max(end, to);
  }
  if (start !== Infinity) return { startSecond: start / scale, endSecond: end / scale };
}

function publish(update: Update, pieces: Piece[], partial: string, durationInSeconds?: number) {
  const segments = pieces.flatMap(({ text, range }) => range ? [{ text, ...range }] : []);
  update({ text: pieces.map(piece => piece.text).join(' '), segments,
    language: pieces.findLast(piece => piece.language)?.language,
    durationInSeconds: durationInSeconds ?? (segments.length ? segments.reduce((end, segment) => Math.max(end, segment.endSecond), 0) : undefined) }, partial);
}

export function deepgramTranscript(update: Update) {
  const pieces = new Map<number | string, Piece>();
  let partial = '';
  const snapshot = (duration?: number) => publish(update, [...pieces.entries()].sort(([a], [b]) =>
    (typeof a === 'number' ? a : Infinity) - (typeof b === 'number' ? b : Infinity)).map(([, piece]) => piece), partial, duration);
  return (event: EventData) => {
    if (event.type === 'Metadata') { partial = ''; snapshot(seconds(event.duration)); return; }
    if (event.type !== 'Results') return;
    const alternatives = object(event.channel).alternatives;
    const first = object(Array.isArray(alternatives) ? alternatives[0] : undefined);
    const transcript = text(first.transcript);
    if (event.is_final === true) {
      const start = seconds(event.start), duration = seconds(event.duration);
      const range = wordRange(first.words) ?? (start !== undefined && duration !== undefined ? { startSecond: start, endSecond: start + duration } : undefined);
      const language = Array.isArray(first.languages) ? text(first.languages[0]) : '';
      if (transcript) pieces.set(start ?? range?.startSecond ?? `untimed-${pieces.size}`, { text: transcript, range, language });
      partial = '';
    } else partial = transcript;
    snapshot();
  };
}

export function assemblyAITranscript(update: Update) {
  const turns = new Map<number, Piece & { final: boolean; formatted: boolean }>();
  function snapshot(duration?: number, finished = false) {
    const ordered = [...turns.keys()].sort((a, b) => a - b).map(order => turns.get(order)!);
    publish(update, ordered.filter(turn => turn.final), finished ? '' : ordered.filter(turn => !turn.final).map(turn => turn.text).join(' '), duration);
  }
  return (event: EventData) => {
    if (event.type === 'Termination') { snapshot(seconds(event.audio_duration_seconds), true); return; }
    const order = seconds(event.turn_order);
    if (event.type !== 'Turn' || order === undefined || !Number.isSafeInteger(order)) return;
    const previous = turns.get(order);
    const final = event.end_of_turn === true, formatted = event.turn_is_formatted === true;
    if (previous?.final && (!final || (previous.formatted && !formatted))) return;
    const transcript = text(event.transcript);
    if (final && !transcript) {
      if (!previous?.final) turns.delete(order);
    } else {
      turns.set(order, { text: transcript, final, formatted, range: wordRange(event.words, 1000) ?? previous?.range,
        language: text(event.language_code) || previous?.language });
    }
    snapshot();
  };
}
