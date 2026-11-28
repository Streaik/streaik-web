type EventData = Record<string, unknown>;
export type TranscriptionTurns = { preview: (text: string) => void; turn: (text: string) => void };
const object = (input: unknown) => input && typeof input === 'object' ? input as EventData : {};
const text = (input: unknown) => typeof input === 'string' ? input.trim() : '';

/** A streaming transcript is not a list of chat turns. Only native endpoints (or
 * an explicit client commit) can promote final fragments to a user message. */
export function chatTranscriptionTurns(provider: string, events: TranscriptionTurns) {
  const seen = new Set<string>();
  const pending = new Map<string, { partial: string; final?: string }>();
  const fragments: string[] = [];
  let deepgramThrough = -1, fragmentThrough = -1;

  function preview(next: string) {
    events.preview([...fragments, next].filter(Boolean).join(' '));
  }
  function finish(next: string) {
    events.preview('');
    if (next) events.turn(next);
  }
  function finishFragments() {
    const next = fragments.join(' ');
    fragments.length = 0;
    finish(next);
  }
  function finishDeepgram(end: number) {
    deepgramThrough = Math.max(deepgramThrough, fragmentThrough, end);
    fragmentThrough = -1;
    finishFragments();
  }
  function first(key?: string) {
    if (key === undefined) return true;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }
  return (event: EventData) => {
    switch (provider) {
      case 'openai': {
        const id = text(event.item_id);
        if (!id || seen.has(id)) return;
        const type = event.type;
        if (type !== 'input_audio_buffer.speech_started' && type !== 'input_audio_buffer.committed' &&
          type !== 'conversation.item.input_audio_transcription.delta' && type !== 'conversation.item.input_audio_transcription.completed') return;
        const item = pending.get(id) ?? { partial: '' };
        pending.set(id, item);
        if (typeof event.delta === 'string' && type === 'conversation.item.input_audio_transcription.delta') item.partial += event.delta;
        if (type === 'conversation.item.input_audio_transcription.completed') item.final = text(event.transcript);
        // Provider completions can arrive out of order. Committed items retain microphone order.
        for (const [key, turn] of pending) {
          if (turn.final === undefined) break;
          pending.delete(key);
          first(key);
          finish(turn.final);
        }
        events.preview([...pending.values()].map(turn => turn.final ?? turn.partial.trim()).filter(Boolean).join(' '));
        break;
      }
      case 'deepgram': {
        if (event.type === 'UtteranceEnd') {
          const end = typeof event.last_word_end === 'number' ? event.last_word_end : fragmentThrough;
          if (end > deepgramThrough && (fragmentThrough < 0 || end >= fragmentThrough)) finishDeepgram(end);
          return;
        }
        if (event.type !== 'Results') return;
        const { alternatives } = object(event.channel);
        const transcript = text(object(Array.isArray(alternatives) ? alternatives[0] : undefined).transcript);
        const end = typeof event.start === 'number' && typeof event.duration === 'number' ? event.start + event.duration : undefined;
        if (end !== undefined && end <= deepgramThrough) return;
        const key = end !== undefined ? `${event.start}:${event.duration}` : undefined;
        if (event.is_final === true && transcript && first(key)) {
          fragments.push(transcript);
          // UtteranceEnd reports the last word, not the end of the final chunk.
          const words = object(Array.isArray(alternatives) ? alternatives[0] : undefined).words;
          const wordEnd = object(Array.isArray(words) ? words.at(-1) : undefined).end;
          fragmentThrough = Math.max(fragmentThrough, typeof wordEnd === 'number' ? wordEnd : typeof event.start === 'number' ? event.start : -1);
        }
        if (event.speech_final === true) {
          finishDeepgram(end ?? fragmentThrough);
        } else preview(event.is_final === true ? '' : transcript);
        break;
      }
      case 'assemblyai': {
        if (event.type !== 'Turn' || !Number.isSafeInteger(event.turn_order)) return;
        const key = String(event.turn_order);
        if (seen.has(key)) return;
        const transcript = text(event.transcript);
        if (event.end_of_turn === true) { first(key); finish(transcript); }
        else preview(transcript);
        break;
      }
      case 'gladia': {
        if (event.type !== 'transcript') return;
        const data = object(event.data), utterance = object(data.utterance);
        const id = utterance.start ?? data.id;
        const key = typeof id === 'number' || typeof id === 'string' ? String(id) : undefined;
        if (key !== undefined && seen.has(key)) return;
        const transcript = text(utterance.text);
        if (data.is_final === true) { first(key); finish(transcript); }
        else preview(transcript);
        break;
      }
      case 'google': {
        const content = object(event.serverContent);
        const final = object(content.inputTranscription).text;
        const interim = object(content.interimInputTranscription).text;
        if (text(final)) fragments.push(text(final));
        if (content.turnComplete === true) finishFragments();
        else if (typeof final === 'string' || typeof interim === 'string') preview(typeof interim === 'string' ? text(interim) : '');
        break;
      }
    }
  };
}

/** OpenAI's transcription WebSocket does not provide server VAD. Keep a small
 * pre-roll, send only active audio, and commit at quiet or a bounded duration. */
export function commitOnSilence(send: (bytes: ArrayBuffer) => void, commit: () => void) {
  const preroll: ArrayBuffer[] = [];
  let duration = 0, loud = 0, quiet = 0, buffered = 0;
  return (bytes: ArrayBuffer) => {
    const pcm = new DataView(bytes);
    let power = 0;
    for (let i = 0; i + 1 < bytes.byteLength; i += 2) power += (pcm.getInt16(i, true) / 32768) ** 2;
    const ms = bytes.byteLength / 48;
    const speaking = power > 0.025 ** 2 * (bytes.byteLength / 2);
    if (!duration) {
      preroll.push(bytes);
      buffered += ms;
      while (buffered > 320 && preroll.length > 1) buffered -= preroll.shift()!.byteLength / 48;
      loud = speaking ? loud + ms : 0;
      if (loud < 100) return;
      duration = buffered;
      for (const chunk of preroll.splice(0)) send(chunk);
      buffered = 0;
    } else {
      send(bytes);
      duration += ms;
    }
    quiet = speaking ? 0 : quiet + ms;
    if (quiet >= 600 || duration >= 20_000) { commit(); duration = loud = quiet = 0; }
  };
}
