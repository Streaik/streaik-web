import type { ChatMessage } from '@streaik/gateway';
import type { SocketVoiceSetup } from './socketVoiceSettings';
import type { VoiceCall, VoiceCallbacks } from './voiceConversation';

type Wire = Record<string, unknown>;
const obj = (v: unknown): Wire => v && typeof v === 'object' && !Array.isArray(v) ? v as Wire : {};
const text = (v: unknown) => typeof v === 'string' ? v : undefined;
const list = (v: unknown) => Array.isArray(v) ? v : [];
const row = (role: 'user' | 'assistant'): ChatMessage => ({ id: crypto.randomUUID(), role, parts: [] });

type IO = { send: (event: Wire) => void; play: (audio: string, mimeType?: string) => void; interrupt: () => void; ready: () => void };

export function createSocketVoiceProtocol(setup: SocketVoiceSetup, events: VoiceCallbacks, io: IO) {
  const google = setup.provider === 'google';
  let user: ChatMessage | undefined, assistant: ChatMessage | undefined;
  let batch: { messageId: string; calls: VoiceCall[]; outputs: Map<string, unknown> } | undefined;
  let active = false, stopping = false, prompted = false, hearing = false, bytesSent = 0;
  let responseId: string | undefined, interrupted = false;
  let xaiCalls: unknown[] = [];
  const seenCalls = new Set<string>();
  const userItems = new Map<string, ChatMessage>();
  const eventIds = new Set<string>();
  const recent = (map: Map<string, ChatMessage>, id: string, role: 'user' | 'assistant') => {
    let message = map.get(id);
    if (!message) {
      if (map.size >= 256) map.delete(map.keys().next().value!);
      message = row(role); map.set(id, message);
    }
    return message;
  };
  function transcript(message: ChatMessage, value: string, append: boolean) {
    const part = message.parts[0];
    const next = `${append && part?.type === 'text' ? part.text : ''}${value}`.slice(0, 32000);
    if (!next.trim() || (part?.type === 'text' && part.text === next)) return;
    message.parts = [{ type: 'text', text: next }];
    events.publish({ ...message });
  }
  function result(id: string, name: string, value: unknown) {
    return { id, name, response: value && typeof value === 'object' && !Array.isArray(value) ? value : { result: value ?? null } };
  }
  function xaiOutput(id: string, value: unknown) {
    io.send({ type: 'conversation.item.create', item: { type: 'function_call_output', call_id: id, output: JSON.stringify(value ?? null) } });
  }
  function tools(items: unknown[]) {
    if (stopping) return;
    const calls: VoiceCall[] = [], rejected: ReturnType<typeof result>[] = [];
    for (const raw of items) {
      const call = obj(raw), id = text(google ? call.id : call.call_id), name = text(call.name);
      if (!id || id.length > 256 || !name || name.length > 64 || (!google && call.type !== 'function_call') || seenCalls.has(id)) continue;
      if (seenCalls.size >= 150) throw new Error('The voice session reached its tool call limit.');
      seenCalls.add(id);
      try {
        if (batch || !setup.toolNames.has(name)) throw new Error();
        const args = google ? call.args ?? {} : JSON.parse(text(call.arguments) ?? '{}') as unknown;
        calls.push({ id, name, input: args });
      } catch {
        const error = { error: 'Tool unavailable or arguments invalid.' };
        if (google) rejected.push(result(id, name, error)); else xaiOutput(id, error);
      }
    }
    if (rejected.length) io.send({ toolResponse: { functionResponses: rejected } });
    if (calls.length) {
      const message = assistant ?? row('assistant');
      assistant = undefined;
      batch = { messageId: message.id, calls, outputs: new Map() };
      events.tools({ ...message }, calls);
    } else if (!google && !batch && items.some(raw => obj(raw).type === 'function_call')) io.send({ type: 'response.create' });
  }
  function ready() {
    if (active) return;
    if (google && setup.history.length) io.send({ clientContent: { turns: setup.history.map(({ role, text }) => ({
      role: role === 'user' ? 'user' : 'model', parts: [{ text }],
    })), turnComplete: setup.initialHistory === true } });
    if (!google) for (const { role, text } of setup.history) io.send({ type: 'conversation.item.create', item: {
      type: 'message', role, content: [{ type: role === 'user' ? 'input_text' : 'output_text', text }],
    } });
    active = true;
    io.ready();
  }
  function gemini(event: Wire) {
    if (event.setupComplete != null) ready();
    if (event.error) throw new Error('Gemini Live rejected a voice session event. Check the selected model and settings.');
    const content = obj(event.serverContent);
    if (content.interrupted === true) io.interrupt();
    const input = text(obj(content.inputTranscription).text);
    if (input) transcript(user ??= row('user'), input, true);
    const output = text(obj(content.outputTranscription).text);
    if (output) transcript(assistant ??= row('assistant'), output, true);
    for (const raw of list(obj(content.modelTurn).parts)) {
      const part = obj(raw), inline = obj(part.inlineData), mime = text(inline.mimeType), data = text(inline.data);
      if (mime?.startsWith('audio/pcm') && data && !stopping && !content.interrupted) io.play(data, mime);
      if (!output && part.thought !== true && typeof part.text === 'string') transcript(assistant ??= row('assistant'), part.text, true);
    }
    tools(list(obj(event.toolCall).functionCalls));
    const cancelled = list(obj(event.toolCallCancellation).ids);
    if (batch && batch.calls.some(call => cancelled.includes(call.id))) {
      const current = batch;
      batch = undefined;
      const remaining = current.calls.filter(call => !cancelled.includes(call.id));
      if (remaining.length && !stopping) io.send({ toolResponse: { functionResponses: remaining.map(({ id, name }) =>
        result(id, name, { error: 'The tool batch was interrupted.' })) } });
      events.cancelTools?.(current.messageId);
    }
    if (content.turnComplete === true) {
      user = assistant = undefined;
      prompted = false;
      if (stopping) events.closed();
    }
    if (event.goAway != null) events.closed();
  }
  function xai(event: Wire) {
    const type = event.type, id = text(event.event_id), itemId = text(event.item_id);
    if (id) {
      if (eventIds.has(id)) return;
      if (eventIds.size >= 2048) eventIds.delete(eventIds.values().next().value!);
      eventIds.add(id);
    }
    if (type === 'session.updated') ready();
    else if (type === 'error') {
      const code = obj(event.error).code;
      if (code === 'input_audio_buffer_commit_empty') { prompted = false; return; }
      if (code === 'response_cancel_not_active' || code === 'conversation_already_has_active_response') return;
      throw new Error('xAI rejected a voice session event. Check the selected model and settings.');
    } else if (type === 'input_audio_buffer.speech_started') {
      io.interrupt();
      interrupted = !!responseId;
      if (itemId) events.publish({ ...recent(userItems, itemId, 'user') });
    } else if (type === 'input_audio_buffer.committed') {
      if (itemId) {
        const message = recent(userItems, itemId, 'user');
        if (!message.parts.length) events.publish({ ...message });
      }
      if (setup.manual && prompted && !stopping) io.send({ type: 'response.create' });
    } else if (itemId && (type === 'conversation.item.input_audio_transcription.completed' || type === 'conversation.item.input_audio_transcription.updated')) {
      transcript(recent(userItems, itemId, 'user'), text(event.transcript) ?? '', false);
    } else if (type === 'response.created') {
      responseId = text(obj(event.response).id);
      assistant = undefined;
      interrupted = false;
      xaiCalls = [];
    } else if (type === 'response.output_audio.delta' || type === 'response.audio.delta') {
      const delta = text(event.delta);
      if (!stopping && !interrupted && delta) io.play(delta);
    } else if (typeof type === 'string' && /^response\.(?:output_)?(?:audio_transcript|text)\.(?:delta|done)$/.test(type)) {
      const delta = type.endsWith('.delta'), content = text(delta ? event.delta : event.transcript ?? event.text);
      if (!interrupted && content) transcript(assistant ??= row('assistant'), content, delta);
    } else if (type === 'response.function_call_arguments.done' || type === 'response.output_item.done') {
      const call = type === 'response.output_item.done' ? obj(event.item) : { ...event, type: 'function_call' };
      if (call.type === 'function_call' && xaiCalls.length < 150) xaiCalls.push(call);
    } else if (type === 'response.done') {
      const response = obj(event.response);
      if (response.status === 'failed') throw new Error('The Grok Voice response failed.');
      if (!interrupted && (response.status === 'completed' || response.status === undefined)) tools([...list(response.output), ...xaiCalls]);
      assistant = undefined; responseId = undefined; xaiCalls = []; prompted = false;
      if (stopping) events.closed();
    }
  }
  return {
    open() { io.send(google ? { setup: setup.session } : { type: 'session.update', session: setup.session }); },
    receive(raw: unknown) { if (google) gemini(obj(raw)); else xai(obj(raw)); },
    audio(data: string, byteLength: number) {
      if (!active || stopping || batch || (setup.manual && prompted)) return;
      if (google) {
        if (setup.manual && !hearing) { io.send({ realtimeInput: { activityStart: {} } }); hearing = true; }
        io.send({ realtimeInput: { audio: { data, mimeType: 'audio/pcm;rate=16000' } } });
      } else io.send({ type: 'input_audio_buffer.append', audio: data });
      bytesSent += byteLength;
    },
    manualTurn() {
      if (!active || stopping || batch || !setup.manual || prompted || (google ? !hearing : bytesSent < (setup.input.type === 'audio/pcm' ? setup.input.rate / 5 : 1600))) return;
      prompted = true; hearing = false; bytesSent = 0;
      io.send(google ? { realtimeInput: { activityEnd: {} } } : { type: 'input_audio_buffer.commit' });
    },
    toolResult(id: string, value: unknown) {
      if (!stopping && batch?.calls.some(call => call.id === id) && !batch.outputs.has(id)) batch.outputs.set(id, value);
    },
    continueTools(_choice?: string, end?: boolean) {
      if (!batch || stopping || batch.outputs.size !== batch.calls.length) return;
      const { calls, outputs } = batch;
      batch = undefined;
      if (google) io.send({ toolResponse: { functionResponses: calls.map(({ id, name }) => result(id, name, outputs.get(id))) } });
      else {
        for (const { id } of calls) xaiOutput(id, outputs.get(id));
        if (!end) io.send({ type: 'response.create' });
      }
    },
    stop() {
      stopping = true;
      io.interrupt();
      if (batch) events.cancelTools?.(batch.messageId);
      if (google && active && !batch) {
        if (setup.manual && hearing) io.send({ realtimeInput: { activityEnd: {} } });
        else if (!setup.manual) io.send({ realtimeInput: { audioStreamEnd: true } });
        return true;
      }
      return !google && active && !batch && (!!responseId || prompted);
    },
  };
}
