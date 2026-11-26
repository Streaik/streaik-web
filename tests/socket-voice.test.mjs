import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createGateway, isVoiceCatalogModel, voiceProtocolForModel } from '../packages/gateway/src/index.ts';
import { normalizeRealtimeSettings } from '../packages/chat/src/realtimeSettings.ts';
import { socketVoiceSetup } from '../packages/chat/src/socketVoiceSettings.ts';
import { createSocketVoiceProtocol } from '../packages/chat/src/socketVoiceProtocol.ts';
import { decodeVoiceAudio, encodeVoiceAudio } from '../packages/chat/src/socketVoiceAudio.ts';
import { voiceHistory } from '../packages/chat/src/voiceConversation.ts';

const google = 'google/gemini-2.5-flash-native-audio-preview';
const xai = 'xai/grok-voice-latest';
const googleSocket = 'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContentConstrained';
const xaiSocket = 'wss://api.x.ai/v1/realtime?model=grok-voice-latest';
const wire = value => JSON.parse(JSON.stringify(value));
const collect = [{ type: 'function', name: 'lookup', parameters: { type: 'object', properties: { query: { type: 'string' } } } }];

test('voice gating requires a supported provider model, audio type and realtime capability', () => {
  for (const [id, protocol] of [[google, 'google'], ['google/gemini-3.1-flash-live-preview', 'google'], [xai, 'xai'], ['openai/gpt-live-1', 'live']]) {
    assert.equal(voiceProtocolForModel(id), protocol);
    assert.ok(isVoiceCatalogModel({ id, type: 'audio', tags: ['realtime'] }));
    assert.ok(!isVoiceCatalogModel({ id, type: 'transcription', tags: ['realtime'] }));
    assert.ok(!isVoiceCatalogModel({ id, type: 'audio', tags: [] }));
  }
  for (const id of ['google/gemini-3.5-transcribe-live', 'google/gemini-flash-liveblog', 'xai/grok-4', 'cartesia/agents/agent-id']) {
    assert.equal(voiceProtocolForModel(id), undefined);
    assert.ok(!isVoiceCatalogModel({ id, type: 'audio', tags: ['realtime'] }));
  }
});

test('browser lease requests contain only the selected provider’s native token fields', async () => {
  const sent = [];
  const client = createGateway(new URL('https://gateway.example/api-root/'), async scope => {
    sent.push(scope);
    return {};
  }, async (url, init) => {
    sent.push([url, JSON.parse(init.body), init.cache]);
    return Response.json(url.includes('/google/') ? { url: googleSocket, token: 'auth_tokens/google-fixture' } : { url: xaiSocket, token: 'xai-fixture' });
  });
  const signal = new AbortController().signal;
  const settings = normalizeRealtimeSettings({ google: { uses: 1, bidiGenerateContentSetup: { inputAudioTranscription: {}, tools: [{ googleSearch: {} }] } },
    xai: { expires_after: { seconds: 90 }, session: { voice: 'sal', turn_detection: null } }, realtime: { voice: 'alloy' } });
  const g = socketVoiceSetup('google', google, settings, [], 'Context', collect, true);
  const x = socketVoiceSetup('xai', xai, settings, [], 'Context', collect, true);
  assert.deepEqual(wire(g.tokenOptions).bidiGenerateContentSetup, wire(g.session));
  assert.equal(wire(g.session).outputAudioTranscription, undefined);
  assert.deepEqual(wire(g.session).tools, [{ googleSearch: {} }, { functionDeclarations: [{ name: 'lookup', parametersJsonSchema: collect[0].parameters }] }]);
  assert.equal(x.session.voice, 'sal');
  assert.equal(x.session.turn_detection, null);
  assert.equal(x.session.outputAudioTranscription, undefined);
  const googleResult = await client.realtimeVoiceCredential(google, g.tokenOptions, signal);
  assert.equal(new URL(googleResult.url).searchParams.get('access_token'), 'auth_tokens/google-fixture');
  assert.deepEqual(await client.realtimeVoiceCredential(xai, x.tokenOptions, signal), { url: xaiSocket, protocols: ['xai-client-secret.xai-fixture'] });
  assert.deepEqual(sent, [{ kind: 'realtime', provider: 'google' },
    [`https://gateway.example/api-root/api/realtime/token/${google}`, { sessionConfig: { providerOptions: { google: wire(g.tokenOptions) } } }, 'no-store'],
    { kind: 'realtime', provider: 'xai' },
    [`https://gateway.example/api-root/api/realtime/token/${xai}`, { sessionConfig: { providerOptions: { xai: { expires_after: { anchor: 'created_at', seconds: 90 } } } } }, 'no-store']]);
});

test('voice leases reject cross-provider destinations, raw keys, and expired credentials', async () => {
  for (const [model, payload] of [[google, { url: xaiSocket, token: 'auth_tokens/fixture' }],
    [google, { url: googleSocket, token: 'AIza-fixture' }], [google, { url: `${googleSocket}?extra=1`, token: 'auth_tokens/fixture' }],
    [xai, { url: xaiSocket, token: 'fixture', expiresAt: 1 }], [xai, { url: xaiSocket.replace('api.x.ai', 'api.x.ai.example'), token: 'fixture' }]]) {
    const client = createGateway(new URL('https://gateway.example/'), async () => ({}), async () => Response.json(payload));
    await assert.rejects(client.realtimeVoiceCredential(model, {}, new AbortController().signal), /invalid or expired voice credential/);
  }
});

function fixture(provider, options, history = []) {
  const sent = [], messages = new Map(), batches = [], cancelled = [], playback = [];
  const protocol = createSocketVoiceProtocol(socketVoiceSetup(provider, provider === 'google' ? google : xai, options, history, undefined, collect, false), {
    publish: message => messages.set(message.id, message), tools: (message, calls) => batches.push({ message, calls }),
    cancelTools: id => cancelled.push(id), failure: assert.fail, closed: () => {}, delegate: assert.fail,
  }, { send: event => sent.push(wire(event)), interrupt: () => playback.push('clear'), play: (data, mime) => playback.push([data, mime]), ready: () => {} });
  return { protocol, sent, messages, batches, cancelled, playback };
}

test('Gemini Live speaks its native wire protocol and produces stable, portable text parts', () => {
  const { protocol, sent, messages, batches, playback } = fixture('google', { google: { bidiGenerateContentSetup: {
    inputAudioTranscription: {}, outputAudioTranscription: {}, realtimeInputConfig: { automaticActivityDetection: { disabled: true } },
  } } }, [{ role: 'assistant', text: 'Prior answer' }]);
  protocol.open();
  protocol.audio('before-setup', 2048);
  assert.equal(sent.length, 1);
  protocol.receive({ setupComplete: {} });
  assert.deepEqual(sent[1], { clientContent: { turns: [{ role: 'model', parts: [{ text: 'Prior answer' }] }], turnComplete: false } });
  protocol.audio('audio', 2048);
  protocol.manualTurn(); protocol.manualTurn();
  assert.deepEqual(sent.slice(2), [{ realtimeInput: { activityStart: {} } },
    { realtimeInput: { audio: { data: 'audio', mimeType: 'audio/pcm;rate=16000' } } }, { realtimeInput: { activityEnd: {} } }]);
  protocol.receive({ serverContent: { inputTranscription: { text: 'Look ' } } });
  protocol.receive({ serverContent: { inputTranscription: { text: 'up coffee' } } });
  protocol.receive({ toolCall: { functionCalls: [{ id: 'c1', name: 'lookup', args: { query: 'coffee' } }, { id: 'c2', name: 'not-registered' }] } });
  assert.deepEqual(batches[0].calls, [{ id: 'c1', name: 'lookup', input: { query: 'coffee' } }]);
  protocol.toolResult('c1', 'found'); protocol.continueTools();
  assert.deepEqual(sent.at(-1), { toolResponse: { functionResponses: [{ id: 'c1', name: 'lookup', response: { result: 'found' } }] } });
  protocol.receive({ serverContent: { outputTranscription: { text: 'Coffee options' }, modelTurn: { parts: [{ inlineData: { data: 'pcm', mimeType: 'audio/pcm;rate=24000' } }] } } });
  protocol.receive({ serverContent: { interrupted: true, turnComplete: true } });
  assert.deepEqual(playback, [['pcm', 'audio/pcm;rate=24000'], 'clear']);
  assert.deepEqual(voiceHistory([...messages.values()]), [{ role: 'user', text: 'Look up coffee' }, { role: 'assistant', text: 'Coffee options' }]);
});

test('Gemini cancels pending approvals and never submits cancelled tool results', () => {
  const { protocol, sent, batches, cancelled } = fixture('google');
  protocol.receive({ setupComplete: {} });
  protocol.receive({ toolCall: { functionCalls: [{ id: 'c1', name: 'lookup' }] } });
  protocol.receive({ toolCallCancellation: { ids: ['c1'] } });
  protocol.toolResult('c1', {}); protocol.continueTools();
  assert.deepEqual(cancelled, [batches[0].message.id]);
  assert.deepEqual(sent, []);
});

test('Grok Voice imports universal history, plays audio, and returns tools in xAI events', () => {
  const { protocol, sent, messages, batches, playback } = fixture('xai', { xai: { session: { turn_detection: null } } },
    [{ role: 'user', text: 'Portable question' }, { role: 'assistant', text: 'Portable answer' }]);
  protocol.open();
  protocol.receive({ type: 'session.updated' });
  assert.deepEqual(sent.map(event => event.type), ['session.update', 'conversation.item.create', 'conversation.item.create']);
  assert.equal(sent[2].item.content[0].text, 'Portable answer');
  for (let i = 0; i < 3; i++) protocol.audio('chunk', 2048);
  protocol.manualTurn();
  protocol.receive({ type: 'input_audio_buffer.committed', item_id: 'u1' });
  assert.deepEqual(sent.slice(-2).map(event => event.type), ['input_audio_buffer.commit', 'response.create']);
  protocol.receive({ type: 'response.created', response: { id: 'r1' } });
  protocol.receive({ type: 'response.output_audio.delta', delta: 'encoded' });
  protocol.receive({ type: 'response.output_audio_transcript.delta', delta: 'Finding' });
  protocol.receive({ type: 'conversation.item.input_audio_transcription.completed', item_id: 'u1', transcript: 'My question' });
  protocol.receive({ type: 'response.function_call_arguments.done', call_id: 'c1', name: 'lookup', arguments: '{"query":"hours"}' });
  protocol.receive({ type: 'response.done', response: { id: 'r1', status: 'completed', output: [] } });
  assert.equal(playback[0][0], 'encoded');
  assert.deepEqual(batches[0].calls[0].input, { query: 'hours' });
  protocol.toolResult('c1', { open: true }); protocol.continueTools();
  assert.deepEqual(sent.slice(-2), [{ type: 'conversation.item.create', item: { type: 'function_call_output', call_id: 'c1', output: '{"open":true}' } }, { type: 'response.create' }]);
  assert.deepEqual(voiceHistory([...messages.values()]), [{ role: 'user', text: 'My question' }, { role: 'assistant', text: 'Finding' }]);
});

test('xAI codec settings are reflected in actual PCM and G.711 wire bytes', () => {
  const pcm = new ArrayBuffer(6), view = new DataView(pcm);
  view.setInt16(2, 10000, true); view.setInt16(4, -10000, true);
  for (const [type, bytes, zero] of [['audio/pcm', 6, 0], ['audio/pcma', 3, 0xd5], ['audio/pcmu', 3, 0xff]]) {
    const format = { type, rate: 8000 }, encoded = encodeVoiceAudio(pcm, format);
    assert.equal(atob(encoded).length, bytes);
    assert.equal(atob(encoded).charCodeAt(0), zero);
    const result = decodeVoiceAudio(encoded, format);
    assert.ok(Math.abs(result[0]) < 0.001 && Math.abs(result[1] - 10000 / 32768) < 0.01 && Math.abs(result[2] + 10000 / 32768) < 0.01);
  }
});
