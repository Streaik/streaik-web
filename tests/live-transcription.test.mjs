import assert from 'node:assert/strict';
import test from 'node:test';
import { assemblyAITranscript, deepgramTranscript } from '../packages/chat/src/binaryTranscription.ts';
import { isLiveTranscriptionModel, readLiveTranscriptionCredential, supportsFileTranscription, usesTranscriptionWebSocket } from '../packages/gateway/src/transcriptions.ts';

const deepgram = 'deepgram/nova-3';
const assemblyAI = 'assemblyai/assemblyai-stt-3-7-realtime';
const deepgramUrl = 'wss://api.deepgram.com/v1/listen?model=nova-3';
const assemblyAIUrl = 'wss://streaming.assemblyai.com/v3/ws?sample_rate=16000&speech_model=assemblyai-stt-3-7-realtime';

test('live model gating preserves Deepgram uploads without exposing AssemblyAI as a file model', () => {
  for (const model of [deepgram, 'deepgram/nova-2', assemblyAI, 'assemblyai/universal-streaming-english', 'assemblyai/universal-streaming-multilingual']) {
    assert.equal(isLiveTranscriptionModel(model), true);
    assert.equal(usesTranscriptionWebSocket(model), true);
  }
  assert.equal(isLiveTranscriptionModel('deepgram/flux-general-en'), false);
  assert.equal(isLiveTranscriptionModel('assemblyai/assemblyai-stt-3-7-realtime-agent'), false);
  assert.equal(supportsFileTranscription('/api/transcriptions/stream', deepgram), true);
  assert.equal(supportsFileTranscription('/api/transcriptions', assemblyAI), false);
});

test('binary transcription credentials bind tokens to the expected provider socket and model', () => {
  const expiresAt = Math.floor(Date.now() / 1000) + 30;
  const dg = readLiveTranscriptionCredential(deepgram, { url: deepgramUrl, token: 'ey.test.token', expiresAt }, 'en-GB');
  assert.equal(dg.secret, 'ey.test.token');
  assert.deepEqual(Object.fromEntries(new URL(dg.url).searchParams), {
    model: 'nova-3', encoding: 'linear16', sample_rate: '16000', channels: '1', interim_results: 'true', punctuate: 'true', language: 'en-GB',
  });
  const aai = readLiveTranscriptionCredential(assemblyAI, { url: assemblyAIUrl, token: 'temporary+token=', expiresAt }, 'nl');
  assert.equal(new URL(aai.url).searchParams.get('token'), 'temporary+token=');
  assert.equal(new URL(aai.url).searchParams.get('language_codes'), '["nl"]');
  assert.equal(new URL(aai.url).searchParams.get('encoding'), 'pcm_s16le');
  for (const [model, url] of [[deepgram, deepgramUrl], [assemblyAI, assemblyAIUrl]]) {
    assert.throws(() => readLiveTranscriptionCredential(model, { url, token: 'temporary', expiresAt: 1 }), /credential expired/);
    assert.throws(() => readLiveTranscriptionCredential(model, { url, token: '', expiresAt }), /valid microphone session credential/);
    assert.throws(() => readLiveTranscriptionCredential(model, { url, token: 'temporary' }), /valid microphone session credential/);
    for (const wrong of [url.replace('wss:', 'ws:'), url.replace('://', '://elsewhere.example/'), url + '&token=unexpected', url + '-wrong']) {
      assert.throws(() => readLiveTranscriptionCredential(model, { url: wrong, token: 'temporary', expiresAt }), /valid microphone session credential/);
    }
  }
});

test('Deepgram persists only is_final results and reconciles timing and terminal metadata', () => {
  let last;
  const receive = deepgramTranscript((transcript, partial) => { last = { transcript, partial }; });
  const result = (transcript, extra = {}, alternative = {}) => receive({ type: 'Results', start: 0, duration: 1,
    channel: { alternatives: [{ transcript, ...alternative }] }, ...extra });
  result('Draft', { speech_final: true });
  assert.equal(last.partial, 'Draft');
  assert.equal(last.transcript.text, '');
  result('Repeat.', { is_final: true }, { words: [{ start: 0.2, end: 0.8 }] });
  result('Repeat.', { is_final: true }, { words: [{ start: 0.2, end: 0.8 }] });
  result('Repeat.', { is_final: true, start: 1 });
  result('Unsaved draft', { start: 2 });
  receive({ type: 'Metadata', duration: 3 });
  assert.deepEqual(last, { partial: '', transcript: { text: 'Repeat. Repeat.', durationInSeconds: 3, language: undefined, segments: [
    { text: 'Repeat.', startSecond: 0.2, endSecond: 0.8 }, { text: 'Repeat.', startSecond: 1, endSecond: 2 },
  ] } });
});

test('AssemblyAI replaces interim and finalized turn revisions instead of appending duplicates', () => {
  let last;
  const receive = assemblyAITranscript((transcript, partial) => { last = { transcript, partial }; });
  const turn = (turn_order, transcript, extra) => receive({ type: 'Turn', turn_order, transcript, ...extra });
  turn(0, 'one');
  turn(0, 'one two');
  assert.equal(last.partial, 'one two');
  turn(0, 'one two', { end_of_turn: true, words: [{ start: 100, end: 900 }], language_code: 'en' });
  turn(1, 'Three.', { end_of_turn: true });
  turn(0, 'One, two.', { end_of_turn: true, turn_is_formatted: true });
  turn(0, 'one two', { end_of_turn: true });
  turn(2, 'Discarded draft');
  receive({ type: 'Termination', audio_duration_seconds: 3 });
  assert.deepEqual(last, { partial: '', transcript: { text: 'One, two. Three.', durationInSeconds: 3, language: 'en',
    segments: [{ text: 'One, two.', startSecond: 0.1, endSecond: 0.9 }] } });
});
