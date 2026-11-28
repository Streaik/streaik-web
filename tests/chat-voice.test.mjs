import assert from 'node:assert/strict';
import test from 'node:test';
import { chatVoiceSpeech, chatVoiceTranscription, transcriptionVoiceOptions } from '../packages/chat/src/chatVoiceModels.ts';
import { chatTranscriptionTurns, commitOnSilence } from '../packages/chat/src/chatTranscriptionTurns.ts';
import { withReplyMetadata } from '../packages/chat/src/messageMetadata.ts';

const model = (id, type, tags = ['realtime']) => ({ id, type, tags, provider: id.split('/')[0] });
const peer = model('openai/gpt-realtime-transcribe', 'transcription');
const socket = model('deepgram/nova-3', 'transcription');
const file = model('openai/gpt-transcribe', 'transcription', []);
const speech = model('deepgram/aura-2-asteria-en', 'speech');
const capture = { socket: true, peer: true };

test('voice uses a supported agent transcription first, and only ordinary fallback agent model entries', () => {
  const catalog = [peer, socket, file];
  const agent = { transcription: { id: peer.id }, model: { id: socket.id } };
  const fallback = { transcription: { id: peer.id }, models: [{ id: file.id }, { id: socket.id }] };
  assert.equal(chatVoiceTranscription(catalog, capture, agent, fallback).id, peer.id);
  assert.equal(chatVoiceTranscription(catalog, { ...capture, peer: false }, agent, fallback).id, socket.id);
  assert.equal(chatVoiceTranscription(catalog, capture, { transcription: { id: file.id } }, fallback).id, socket.id);
  assert.equal(chatVoiceTranscription(catalog, capture, { transcription: { id: 'openai/missing' } }, { model: { id: socket.id } }).id, socket.id);
  assert.equal(chatVoiceTranscription(catalog, capture, { model: { id: socket.id } }), undefined);
  assert.equal(chatVoiceTranscription(catalog, capture, { transcription: { id: file.id } }), undefined);
  assert.equal(chatVoiceTranscription(catalog, capture, undefined, { transcription: { id: peer.id } }), undefined);
  assert.equal(chatVoiceTranscription([model('unknown/transcriber', 'transcription')], capture, { transcription: { id: 'unknown/transcriber' } }), undefined);
  assert.deepEqual(transcriptionVoiceOptions({ id: peer.id,
    providerMetadata: { openai: { session: { audio: { input: { transcription: { language: 'nl' } } } } } } }), { language: 'nl' });
});

test('speech is optional, interprets the portable agent settings, and can fall back to an ordinary speech model', () => {
  const batchSpeech = model('openai/gpt-4o-mini-tts', 'speech', []);
  const catalog = [batchSpeech, speech];
  const agent = { speech: { model: { id: speech.id }, voice: 'voice name', language: 'en', outputFormat: { type: 'audio/wav', rate: 24000 } } };
  const fallback = { model: { id: batchSpeech.id } };
  assert.deepEqual(chatVoiceSpeech(catalog, agent, fallback), { model: speech, rate: 24000,
    options: { voice: 'voice name', language: 'en', outputFormat: 'audio/wav', speed: undefined, instructions: undefined } });
  assert.equal(chatVoiceSpeech([batchSpeech], agent, fallback).model.id, batchSpeech.id);
  assert.equal(chatVoiceSpeech(catalog, { model: fallback.model }), undefined);
});

function collect(provider) {
  const previews = [], turns = [];
  const event = chatTranscriptionTurns(provider, { preview: text => previews.push(text), turn: text => turns.push(text) });
  return { previews, turns, event };
}

test('OpenAI submits only completed items, in commit order and at most once', () => {
  const { event, previews, turns } = collect('openai');
  const completed = (id, transcript) => event({ type: 'conversation.item.input_audio_transcription.completed', item_id: id, transcript });
  event({ type: 'input_audio_buffer.committed', item_id: '1' });
  event({ type: 'input_audio_buffer.committed', item_id: '2' });
  event({ type: 'conversation.item.input_audio_transcription.delta', item_id: '1', delta: 'partial' });
  completed('2', 'second');
  assert.deepEqual(turns, []);
  assert.equal(previews.at(-1), 'partial second');
  completed('1', 'first');
  completed('2', 'second');
  completed('3', ' ');
  assert.deepEqual(turns, ['first', 'second']);
  assert.equal(previews.at(-1), '');
});

test('Deepgram waits for an utterance boundary and does not duplicate final fragments', () => {
  const { event, previews, turns } = collect('deepgram');
  const result = (transcript, start, is_final, speech_final = false) => event({
    type: 'Results', channel: { alternatives: [{ transcript }] }, start, duration: 1, is_final, speech_final,
  });
  result('Hi', 0, true);
  result('Hi', 0, true);
  result('how are', 1, false);
  assert.equal(previews.at(-1), 'Hi how are');
  assert.deepEqual(turns, []);
  result('how are you?', 1, true, true);
  result('how are you?', 1, true, true);
  event({ type: 'UtteranceEnd', last_word_end: 2 });
  assert.deepEqual(turns, ['Hi how are you?']);
});

test('AssemblyAI, Gladia and Google normalize native turn boundaries without sending provider output', () => {
  const assembly = collect('assemblyai');
  for (const end_of_turn of [false, true, true]) assembly.event({ type: 'Turn', turn_order: 1, transcript: 'one', end_of_turn });
  assert.deepEqual(assembly.turns, ['one']);
  const gladia = collect('gladia');
  for (const is_final of [false, true, true]) gladia.event({ type: 'transcript', data: { is_final, utterance: { start: 0, text: 'one' } } });
  assert.deepEqual(gladia.turns, ['one']);
  const google = collect('google');
  google.event({ serverContent: { inputTranscription: { text: 'one' }, interimInputTranscription: { text: 'two?' } } });
  assert.equal(google.previews.at(-1), 'one two?');
  assert.deepEqual(google.turns, []);
  google.event({ serverContent: { inputTranscription: { text: 'two' }, outputTranscription: { text: 'not input' }, turnComplete: true } });
  google.event({ serverContent: { modelTurn: { parts: [{ text: 'not input' }] }, turnComplete: true } });
  assert.deepEqual(google.turns, ['one two']);
});

test('manual OpenAI socket commits once per voiced take, never idle silence', () => {
  const quiet = new Int16Array(2400).buffer, loud = new Int16Array(2400).fill(4000).buffer;
  let sends = 0, commits = 0;
  const write = commitOnSilence(() => { sends++; }, () => { commits++; });
  const frames = (pcm, count) => { for (let i = 0; i < count; i++) write(pcm); };
  frames(quiet, 12);
  assert.deepEqual([sends, commits], [0, 0]);
  frames(loud, 3);
  frames(quiet, 5);
  assert.equal(commits, 0);
  frames(quiet, 20);
  assert.equal(commits, 1);
  frames(loud, 3);
  frames(quiet, 6);
  assert.equal(commits, 2);
});

test('provider reply ID collisions do not reuse a prior chat message', async () => {
  const id = 'provider-constant';
  const read = async (previous) => withReplyMetadata(new ReadableStream({ start(controller) {
    controller.enqueue({ type: 'start', messageId: id }); controller.close();
  } }), 'openai/model', previous, new Set([id])).getReader().read();
  assert.notEqual((await read()).value.messageId, id);
  assert.equal((await read({ id: 'continuation' })).value.messageId, 'continuation');
});
