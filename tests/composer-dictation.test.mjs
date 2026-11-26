import assert from 'node:assert/strict';
import test from 'node:test';
import { appendDictation, selectDictationTarget } from '../packages/chat/src/composerDictation.ts';

const recorded = 'openai/gpt-transcribe';
const realtime = 'openai/gpt-live-transcribe';
const deepgram = 'deepgram/nova-3';
const assemblyai = 'assemblyai/assemblyai-stt-3-7-realtime';
const taggedWithoutAdapter = 'assemblyai/unsupported';
const fileOnly = 'openai/whisper-1';
const models = [
  { id: recorded, type: 'transcription', tags: [] },
  { id: realtime, type: 'transcription', tags: ['realtime'] },
  { id: deepgram, type: 'transcription', tags: ['realtime'] },
  { id: assemblyai, type: 'transcription', tags: ['realtime'] },
  { id: taggedWithoutAdapter, type: 'transcription', tags: ['realtime'] },
  { id: fileOnly, type: 'transcription', tags: [] },
];
const capture = { socket: true, peer: true, recorder: true };

test('dictation requires a configured, available transcription model and a compatible route', () => {
  assert.equal(selectDictationTarget(models, [], capture), undefined);
  assert.equal(selectDictationTarget(models, ['missing', fileOnly], capture), undefined);
  assert.equal(selectDictationTarget([{ ...models[1], type: 'audio' }], [realtime], capture), undefined);
  assert.deepEqual(selectDictationTarget(models, [recorded, realtime], capture), { mode: 'realtime', model: realtime });
  assert.deepEqual(selectDictationTarget(models, [recorded, realtime], { ...capture, socket: false }), { mode: 'recorded', model: recorded });
  assert.deepEqual(selectDictationTarget(models, [taggedWithoutAdapter, recorded], capture), { mode: 'recorded', model: recorded });
  assert.deepEqual(selectDictationTarget(models, [deepgram, recorded], capture), { mode: 'realtime', model: deepgram });
  assert.deepEqual(selectDictationTarget(models, [deepgram, recorded], { ...capture, socket: false }), { mode: 'recorded', model: deepgram });
  assert.deepEqual(selectDictationTarget(models, [assemblyai], capture), { mode: 'realtime', model: assemblyai });
  assert.equal(selectDictationTarget(models, [assemblyai], { ...capture, socket: false }), undefined);
  assert.deepEqual(selectDictationTarget([models[0], { ...models[1], tags: [] }], [realtime, recorded], capture), { mode: 'recorded', model: recorded });
});

test('a dictation take appends without rewriting existing draft whitespace', () => {
  assert.equal(appendDictation('First', '  second  '), 'First second');
  assert.equal(appendDictation('First\n', 'second'), 'First\nsecond');
  assert.equal(appendDictation('First  ', '   '), 'First  ');
});
