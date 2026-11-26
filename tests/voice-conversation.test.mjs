import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createVoiceProtocol, startVoiceConversation, voiceHistory } from '../packages/chat/src/voiceConversation.ts';
import { liveSession, normalizeRealtimeSettings, realtimeSession } from '../packages/chat/src/realtimeSettings.ts';

const wire = options => JSON.parse(JSON.stringify(options));

test('Realtime options keep explicit off, zero and false distinct from provider defaults', () => {
  const { realtime } = normalizeRealtimeSettings({ realtime: { tokenTtl: 60, instructions: 'voice only', speed: 1.2, reasoning: null,
    transcription: null, noise: null, inputFormat: 'audio/pcm', outputFormat: 'audio/pcmu',
    vad: { type: 'server_vad', threshold: 0, create_response: false, interrupt_response: false, eagerness: 'high', idle_timeout_ms: 5000 },
  } });
  assert.equal(realtime.tokenTtl, 60);
  const config = wire(realtimeSession(realtime, 'app context', []));
  assert.equal(config.instructions, 'app context\n\nvoice only');
  assert.deepEqual(config.audio.input, { format: { type: 'audio/pcm', rate: 24000 }, noise_reduction: null, transcription: null,
    turn_detection: { type: 'server_vad', create_response: false, interrupt_response: false, threshold: 0, idle_timeout_ms: 5000 } });
  assert.deepEqual(config.audio.output, { format: { type: 'audio/pcmu' }, speed: 1.2 });
  assert.equal(config.reasoning, null);
  assert.equal(wire(realtimeSession({ vad: null }, undefined, [])).audio.input.turn_detection, null);
});

test('GPT Live passes user-selected Responses configuration, history, and supported tools, never dictation settings', () => {
  const history = voiceHistory([{ role: 'system', parts: [{ type: 'text', text: 'do not replay' }] },
    { role: 'user', parts: [{ type: 'text', text: 'earlier' }, { type: 'file', url: 'private' }] },
    { role: 'assistant', parts: [{ type: 'text', text: 'reply' }] }]);
  const config = wire(liveSession({ model: 'openai/gpt-fixture', acknowledgement: 0, parallel: false, customVoice: 'voice-id',
    tools: ['code_interpreter', 'file_search'], vectorStores: 'vs_a, vs_b' }, history, undefined, [{ type: 'function', name: 'chart' }]));
  assert.equal(config.store, false);
  assert.deepEqual(config.input, [{ type: 'message', role: 'user', content: [{ type: 'input_text', text: 'earlier' }] },
    { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'reply' }] }]);
  assert.deepEqual(config.audio, { output: { voice: { id: 'voice-id' } } });
  assert.deepEqual(config.delegation, { type: 'responses', acknowledgement_delay_ms: 0, responses: {
    model: 'gpt-fixture', parallel_tool_calls: false, tools: [{ type: 'function', name: 'chart' },
      { type: 'code_interpreter', container: { type: 'auto' } }, { type: 'file_search', vector_store_ids: ['vs_a', 'vs_b'] }],
  } });
  assert.throws(() => liveSession(undefined, [], undefined, []), /Choose an OpenAI Responses model/);
  assert.deepEqual(wire(liveSession({ mode: 'client', clientModel: 'other/model' }, [], undefined, [])).delegation, { type: 'client' });
});

function fixture(options = {}) {
  const sent = [], transcript = new Map(), batches = [], microphone = [], delegates = [];
  const protocol = createVoiceProtocol({ protocol: 'realtime', history: [], liveClient: false, transcription: true, exposeInput: true,
    toolNames: new Set(['charts']), events: {
      publish: message => transcript.set(message.id, message), tools: (message, calls) => batches.push({ message, calls }),
      delegate: id => delegates.push(id), failure: assert.fail, closed: () => {},
    }, ...options }, event => sent.push(event), enabled => microphone.push(enabled));
  return { protocol, sent, transcript, batches, microphone, delegates };
}

test('Realtime commits a manual audio turn before requesting a response, and preserves input order', () => {
  const { protocol, sent, transcript } = fixture({ manual: 'commit', history: [{ role: 'user', text: 'previous' }] });
  protocol.initialize();
  protocol.manualTurn(); protocol.manualTurn();
  assert.deepEqual(sent.map(({ type }) => type), ['conversation.item.create', 'input_audio_buffer.commit']);
  protocol.receive({ type: 'input_audio_buffer.committed', item_id: 'u' });
  assert.equal(sent.at(-1).type, 'response.create');
  protocol.receive({ type: 'response.output_audio_transcript.delta', response_id: 'a', delta: 'Hello' });
  protocol.receive({ type: 'response.output_audio_transcript.done', response_id: 'a', transcript: 'Hello!' });
  protocol.receive({ type: 'conversation.item.input_audio_transcription.completed', item_id: 'u', transcript: 'Can you help?' });
  assert.deepEqual([...transcript.values()].map(({ role, parts }) => [role, parts[0].text]), [['user', 'Can you help?'], ['assistant', 'Hello!']]);
});

for (const family of ['realtime', 'live']) test(`${family} waits for every approved or declined tool result before one continuation`, () => {
  const { protocol, sent, batches, microphone } = fixture({ protocol: family });
  const item = call_id => ({ type: 'function_call', name: 'charts', call_id, arguments: '{"title":"test"}' });
  if (family === 'live') {
    for (const id of ['a', 'b']) protocol.receive({ type: 'response.event', delegation_id: 'd',
      event: { type: 'response.output_item.done', response_id: 'r', item: item(id) } });
    assert.equal(batches.length, 0);
    protocol.receive({ type: 'response.event', delegation_id: 'd', event: { type: 'response.completed', response: { id: 'r', output: [item('a'), item('b')] } } });
  } else protocol.receive({ type: 'response.done', response: { id: 'r', status: 'completed', output: [item('a'), item('b')] } });
  assert.deepEqual(batches[0].calls, ['a', 'b'].map(id => ({ id, name: 'charts', input: { title: 'test' } })));
  assert.deepEqual(microphone, [false]);
  assert.equal(sent.filter(({ item }) => item?.type === 'function_call_output').length, 0);
  protocol.toolResult('a', { ok: true });
  protocol.continueTools();
  assert.equal(sent.some(({ type }) => type === 'response.create'), false);
  protocol.toolResult('b', 'The user declined to share this tool result.');
  protocol.toolResult('b', 'duplicate');
  protocol.continueTools(); protocol.continueTools();
  const outputs = sent.filter(({ item }) => item?.type === 'function_call_output');
  assert.equal(outputs.length, 2);
  assert(outputs.every(({ type }) => type === (family === 'live' ? 'response.item.create' : 'conversation.item.create')));
  assert.equal(sent.filter(({ type }) => type === 'response.create').length, 1);
  assert.deepEqual(microphone, [false, true]);
});

test('native GPT Live Client delegation returns spoken commentary to its own delegation', () => {
  const { protocol, sent, delegates } = fixture({ protocol: 'live', liveClient: true });
  protocol.receive({ type: 'session.delegation.created', delegation: { id: 'd', target: 'client' } });
  protocol.receive({ type: 'session.delegation.created', delegation: { id: 'd', target: 'client' } });
  protocol.comment('unrelated', 'not sent');
  protocol.comment('d', 'reply');
  assert.deepEqual(delegates, ['d']);
  assert.deepEqual(sent.map(({ type }) => type), ['session.input_audio.mute', 'session.thinking.append', 'session.commentary.append', 'session.input_audio.unmute']);
  assert.equal(sent[2].content, 'reply');
});

test('cancelling at the microphone prompt closes the peer and releases a delayed permission grant', async t => {
  let capture, closed = 0, stopped = 0;
  const channel = { close() { closed++; } };
  class Peer { createDataChannel() { return channel; } close() { closed++; } }
  function replace(name, value) {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, name);
    Object.defineProperty(globalThis, name, { configurable: true, value });
    t.after(() => descriptor ? Object.defineProperty(globalThis, name, descriptor) : Reflect.deleteProperty(globalThis, name));
  }
  replace('navigator', { mediaDevices: { getUserMedia: () => new Promise(resolve => { capture = resolve; }) } });
  replace('RTCPeerConnection', Peer);
  replace('Audio', class { pause() {} });
  const c = new AbortController();
  const ready = startVoiceConversation({ gateway: {}, model: 'openai/gpt-realtime', protocol: 'realtime', session: {}, history: [],
    liveClient: false, transcription: true, exposeInput: true, toolNames: new Set(), signal: c.signal,
    events: { publish: assert.fail, tools: assert.fail, delegate: assert.fail, failure: assert.fail, closed() {} } });
  c.abort();
  await assert.rejects(ready, { name: 'AbortError' });
  capture({ getTracks: () => [{ stop: () => stopped++ }] });
  await Promise.resolve();
  assert.equal(closed, 2);
  assert.equal(stopped, 1);
});
