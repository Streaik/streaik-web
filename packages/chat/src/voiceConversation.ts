import type { ChatMessage, Gateway } from '@streaik/gateway';
import type { VoiceHistoryItem } from './realtimeSettings';

type WireEvent = Record<string, unknown>;
const obj = (v: unknown): WireEvent => v !== null && typeof v === 'object' && !Array.isArray(v) ? v as WireEvent : {};
const str = (v: unknown) => typeof v === 'string' ? v : undefined;
const row = (role: 'user' | 'assistant', text?: string): ChatMessage => ({ id: crypto.randomUUID(), role, parts: text ? [{ type: 'text', text }] : [] });

export function voiceHistory(messages: readonly ChatMessage[]): VoiceHistoryItem[] {
  let remaining = 24000;
  const history: VoiceHistoryItem[] = [];
  for (const { role, parts } of messages.slice(-48).reverse()) {
    if (role !== 'user' && role !== 'assistant') continue;
    const text = parts.flatMap(p => p.type === 'text' ? [p.text] : []).join('\n').trim();
    if (!text) continue;
    const limit = Math.min(remaining, 4000);
    history.push({ role, text: text.slice(-limit) });
    remaining -= Math.min(limit, text.length);
    if (remaining <= 0) break;
  }
  return history.reverse();
}

export type VoiceCall = { id: string; name: string; input: unknown };
type VoiceCallbacks = {
  publish: (message: ChatMessage) => void;
  tools: (message: ChatMessage, calls: VoiceCall[]) => void;
  delegate: (id: string) => void;
  failure: (error: Error) => void;
  closed: () => void;
};
type Options = {
  gateway: Gateway; model: string; protocol: 'live' | 'realtime'; session: object; ttl?: number;
  history: VoiceHistoryItem[]; liveClient: boolean; manual?: 'commit' | 'respond'; transcription: boolean; exposeInput: boolean;
  toolNames: ReadonlySet<string>; signal: AbortSignal; events: VoiceCallbacks;
};
export type VoiceSession = Awaited<ReturnType<typeof startVoiceConversation>>;

/** Each adapter owns provider IDs and event ordering; it only emits normal chat rows and validated function calls. */
export function createVoiceProtocol(options: Pick<Options, 'protocol' | 'history' | 'liveClient' | 'manual' | 'transcription' | 'exposeInput' | 'toolNames' | 'events'>,
  send: (event: WireEvent) => void, mute: (enabled: boolean) => void) {
  const { events, protocol, liveClient } = options;
  const input = new Map<string, ChatMessage>();
  const replies = new Map<string, ChatMessage>();
  const delegated = new Map<string, string>();
  const seen = new Set<string>();
  const seenCalls = new Set<string>();
  const liveCalls = new Map<string, WireEvent[]>();
  const rejected = new Set<string>();
  let liveRow: ChatMessage | undefined;
  let pending: { message: ChatMessage; ids: Set<string> } | undefined;
  let manualReady = false;
  let closing = false;
  let clientDelegation: string | undefined;
  const call = (type: string, fields: WireEvent = {}) => send({ type, event_id: crypto.randomUUID(), ...fields });
  function write(message: ChatMessage, value: string, append = false) {
    const old = message.parts.find(p => p.type === 'text');
    const text = `${append && old ? old.text : ''}${value}`.slice(0, 32000);
    if (!text.trim()) return;
    message.parts = [...message.parts.filter(p => p.type !== 'text'), { type: 'text', text }];
    events.publish({ ...message });
  }
  function item(map: Map<string, ChatMessage>, id: string, role: 'assistant' | 'user') {
    let message = map.get(id);
    if (!message) { message = row(role); map.set(id, message); }
    return message;
  }
  function setMic(enabled: boolean) {
    mute(enabled);
    if (protocol === 'live') call(enabled ? 'session.input_audio.unmute' : 'session.input_audio.mute');
  }
  function output(id: string, value: unknown) {
    const item = { type: 'function_call_output', call_id: id, output: JSON.stringify(value) ?? 'null' };
    call(protocol === 'live' ? 'response.item.create' : 'conversation.item.create', { item });
  }
  function finishCalls(message: ChatMessage, items: unknown[]) {
    if (closing) return;
    const calls: VoiceCall[] = [];
    for (const raw of items) {
      const part = obj(raw), id = str(part.call_id), name = str(part.name);
      if (part.type !== 'function_call' || !id || seenCalls.has(id)) continue;
      seenCalls.add(id);
      if (!name || !options.toolNames.has(name) || pending || seenCalls.size > 150) {
        output(id, { error: 'Tool unavailable for this conversation.' });
        rejected.add(message.id);
        continue;
      }
      try { calls.push({ id, name, input: JSON.parse(str(part.arguments) ?? '{}') }); }
      catch { output(id, { error: 'Invalid tool arguments.' }); rejected.add(message.id); }
    }
    if (calls.length) {
      pending = { message, ids: new Set(calls.map(c => c.id)) };
      setMic(false);
      events.tools({ ...message }, calls);
    } else if (rejected.delete(message.id) && !pending && seenCalls.size <= 150) call('response.create');
  }
  function realtime(event: WireEvent) {
    const type = event.type;
    const itemId = str(event.item_id);
    if (type === 'input_audio_buffer.committed' && itemId) {
      manualReady = true;
      if (options.transcription) events.publish({ ...item(input, itemId, 'user') });
    } else if (itemId && options.transcription && type === 'conversation.item.input_audio_transcription.completed') {
      write(item(input, itemId, 'user'), str(event.transcript) ?? '');
    } else if (itemId && type === 'conversation.item.input_audio_transcription.failed') {
      // Keep the session usable; do not fabricate a transcript.
      input.delete(itemId);
    } else if (type === 'response.created') {
      manualReady = false;
    } else if (type === 'response.output_audio_transcript.delta' || type === 'response.audio_transcript.delta' ||
      type === 'response.output_text.delta' || type === 'response.text.delta' || type === 'response.output_audio_transcript.done' ||
      type === 'response.audio_transcript.done' || type === 'response.output_text.done' || type === 'response.text.done') {
      const id = str(event.response_id) ?? itemId;
      const delta = typeof type === 'string' && type.endsWith('.delta');
      const text = str(delta ? event.delta : event.transcript ?? event.text);
      if (id && text !== undefined) write(item(replies, id, 'assistant'), text, delta);
    } else if (type === 'response.done') {
      const response = obj(event.response), id = str(response.id);
      if (response.status === 'failed') throw new Error('The OpenAI realtime response failed.');
      if (id && Array.isArray(response.output) && (response.status === 'completed' || response.status === undefined)) {
        finishCalls(item(replies, id, 'assistant'), response.output);
      }
    }
  }
  function live(event: WireEvent) {
    const type = event.type;
    if (type === 'session.input_transcript.delta' || type === 'session.output_transcript.delta') {
      const role = type === 'session.input_transcript.delta' ? 'user' : 'assistant';
      const text = str(event.delta);
      if (text === undefined || (role === 'user' && !options.exposeInput)) return;
      if (!liveRow || liveRow.role !== role) liveRow = row(role);
      write(liveRow, text, true);
    } else if (type === 'session.delegation.created') {
      liveRow = undefined;
      const delegation = obj(event.delegation), id = str(delegation.id), response = str(delegation.response_id);
      if (id && response) delegated.set(id, response);
      if (!closing && liveClient && id && delegation.target === 'client' && !seenCalls.has(id) && !clientDelegation) {
        seenCalls.add(id);
        clientDelegation = id;
        setMic(false);
        call('session.thinking.append', { content: '', delegation_id: id });
        events.delegate(id);
      }
    } else if (type === 'response.event' && !liveClient && !closing) {
      const inner = obj(event.event), delegation = str(event.delegation_id) ?? '';
      const id = str(obj(inner.response).id) ?? str(inner.response_id) ?? delegated.get(delegation);
      if (inner.type === 'response.created' && id) delegated.set(delegation, id);
      else if (id && inner.type === 'response.output_item.done' && obj(inner.item).type === 'function_call') {
        const calls = liveCalls.get(id) ?? [];
        calls.push(obj(inner.item)); liveCalls.set(id, calls);
      } else if (id && inner.type === 'response.completed') {
        const list = liveCalls.get(id) ?? [];
        liveCalls.delete(id);
        const final = obj(inner.response).output;
        finishCalls(item(replies, id, 'assistant'), [...list, ...(Array.isArray(final) ? final : [])]);
      } else if (inner.type === 'response.failed' || inner.type === 'response.incomplete') {
        if (id) liveCalls.delete(id);
        throw new Error('The GPT Live delegated response did not complete.');
      }
    } else if (type === 'session.closed') events.closed();
  }
  function comment(id: string, text: string) {
    if (closing || clientDelegation !== id) return;
    const encoder = new TextEncoder();
    let chunk = '';
    for (const char of text.slice(0, 16000)) {
      if (encoder.encode(chunk + char).length > 450) { call('session.commentary.append', { content: chunk, delegation_id: id }); chunk = ''; }
      chunk += char;
    }
    call('session.commentary.append', { content: chunk, delegation_id: id });
    clientDelegation = undefined;
    setMic(true);
  }
  return {
    initialize() {
      if (protocol === 'realtime') for (const { role, text } of options.history) call('conversation.item.create', {
        item: { type: 'message', role, content: [{ type: role === 'assistant' ? 'output_text' : 'input_text', text }] },
      });
    },
    receive(raw: unknown) {
      const event = obj(raw), id = str(event.event_id);
      if (id && seen.has(id)) return;
      if (seen.size > 20000) throw new Error('Voice session event limit reached.');
      if (id) seen.add(id);
      if (event.type === 'error' && !closing) {
        const code = obj(event.error).code;
        if (code === 'input_audio_buffer_commit_empty' || code === 'response_cancel_not_active' || code === 'conversation_already_has_active_response') return;
        throw new Error('OpenAI rejected a voice session event. Check the selected model and Realtime settings.');
      }
      if (protocol === 'live') live(event); else realtime(event);
    },
    manualTurn() {
      if (closing || pending || !options.manual) return;
      if (options.manual === 'commit') call('input_audio_buffer.commit');
      else if (!manualReady) return;
      manualReady = false;
      call('response.create');
    },
    toolResult(id: string, value: unknown) {
      if (!pending?.ids.has(id) || closing) return;
      output(id, value);
      pending.ids.delete(id);
    },
    continueTools(choice?: string, end = false) {
      if (!pending || pending.ids.size || closing) return;
      pending = undefined;
      setMic(true);
      if (!end) call('response.create', protocol === 'realtime' && choice ? { response: { tool_choice: choice } } : {});
    },
    comment,
    close() {
      if (closing) return false;
      closing = true;
      mute(false);
      if (protocol === 'live') call('session.close');
      return protocol === 'live';
    },
  };
}

export async function startVoiceConversation(options: Options) {
  if (!navigator.mediaDevices?.getUserMedia || typeof RTCPeerConnection === 'undefined') throw new Error('Voice requires microphone access and WebRTC.');
  options.signal.throwIfAborted();
  const pc = new RTCPeerConnection();
  const audio = new Audio();
  audio.autoplay = true;
  const channel = pc.createDataChannel('oai-events');
  let stream: MediaStream | undefined;
  let stopped = false;
  let closing = false;
  let closeTimer: ReturnType<typeof setTimeout> | undefined;
  const lifetime = new AbortController();
  const startup = setTimeout(() => finish(new Error('The voice session did not connect in time.')), 30000);
  const send = (event: WireEvent) => {
    if (stopped || channel.readyState !== 'open') throw new Error('The voice data channel is not open.');
    const payload = JSON.stringify(event);
    if (new TextEncoder().encode(payload).length > Math.min(pc.sctp?.maxMessageSize || 65536, 262144) || channel.bufferedAmount > 1048576)
      throw new Error('A voice session message exceeded the data-channel limit.');
    channel.send(payload);
  };
  const adapter = createVoiceProtocol({ ...options, events: { ...options.events, closed: () => finish() } }, send,
    enabled => stream?.getAudioTracks().forEach(track => { track.enabled = enabled; }));
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const opened = new Promise<void>((ok, fail) => { resolve = ok; reject = fail; });
  void opened.catch(() => {});
  const abort = () => finish();
  function finish(error?: Error) {
    if (stopped) return;
    stopped = true;
    clearTimeout(startup); clearTimeout(closeTimer);
    lifetime.abort();
    options.signal.removeEventListener('abort', abort);
    reject(error ?? new DOMException('Aborted', 'AbortError'));
    channel.onmessage = channel.onclose = channel.onerror = channel.onopen = null;
    pc.ontrack = pc.onconnectionstatechange = null;
    for (const track of stream?.getTracks() ?? []) track.stop();
    audio.pause(); audio.srcObject = null;
    channel.close(); pc.close();
    if (error) options.events.failure(error); else options.events.closed();
  }
  options.signal.addEventListener('abort', abort, { once: true });
  channel.onopen = () => resolve();
  channel.onclose = () => finish(closing ? undefined : new Error('The voice data channel closed.'));
  channel.onerror = () => finish(new Error('The voice data channel failed.'));
  channel.onmessage = ({ data }) => {
    if (typeof data !== 'string' || data.length > 512000) return;
    try { adapter.receive(JSON.parse(data)); }
    catch (error) { finish(error instanceof Error ? error : new Error('Invalid voice session event.')); }
  };
  pc.onconnectionstatechange = () => {
    if (pc.connectionState === 'failed' || pc.connectionState === 'disconnected') finish(new Error('The voice connection was lost.'));
  };
  pc.ontrack = ({ streams, track }) => {
    audio.srcObject = streams[0] ?? new MediaStream([track]);
    void audio.play().catch(() => { if (!stopped && !closing) finish(new Error('The browser blocked voice playback.')); });
  };
  try {
    const capture = navigator.mediaDevices.getUserMedia({ audio: true }).then(captured => {
      if (stopped) { captured.getTracks().forEach(track => track.stop()); lifetime.signal.throwIfAborted(); }
      return captured;
    });
    stream = await Promise.race([capture, opened.then(() => capture)]);
    lifetime.signal.throwIfAborted();
    for (const track of stream.getAudioTracks()) { track.enabled = false; pc.addTrack(track, stream); }
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    const answer = await options.gateway.negotiateVoice(options.model, options.session, pc.localDescription?.sdp ?? '', options.ttl, lifetime.signal);
    await pc.setRemoteDescription({ type: 'answer', sdp: answer });
    await opened;
    lifetime.signal.throwIfAborted();
    adapter.initialize();
    stream.getAudioTracks().forEach(track => { track.enabled = true; });
    clearTimeout(startup);
  } catch (error) {
    if (!stopped) finish(error instanceof Error ? error : new Error('Could not start the voice session.'));
    throw error;
  }
  const run = (fn: () => void) => {
    if (!stopped) try { fn(); } catch (error) { finish(error instanceof Error ? error : new Error('Voice session failed.')); }
  };
  return { manualTurn: () => run(adapter.manualTurn), toolResult: (id: string, value: unknown) => run(() => adapter.toolResult(id, value)),
    continueTools: (choice?: string, end?: boolean) => run(() => adapter.continueTools(choice, end)),
    comment: (id: string, text: string) => run(() => adapter.comment(id, text)),
    stop: () => run(() => {
      if (closing) return;
      closing = true;
      // Stop mic capture immediately; Live can still send its buffered final transcript.
      stream?.getTracks().forEach(track => track.stop());
      if (adapter.close()) closeTimer = setTimeout(() => finish(), 1200); else finish();
    }),
  };
}
