import assert from 'node:assert/strict';
import { test } from 'node:test';
import { googleLiveTranscriptionSetup, readNativeTranscript, transcriptionBody, transcriptionUploadLimit } from '../packages/gateway/src/transcriptions.ts';
import { loadChatPreferences, saveChatPreferences } from '../packages/chat/src/chatPreferences.ts';
import { mergeTranscriptionChunks, splitTranscription } from '../packages/chat/src/splitTranscription.ts';
import { transcriptionSettingsKey } from '../packages/chat/src/transcriptionSplitPreferences.ts';

const audio = new File(['audio'], 'test.wav', { type: 'audio/wav' });

test('Vercel routes send only selected and supported provider options', async () => {
  const settings = { providerOptions: {
    openai: { language: '  en ', prompt: 'Terms', temperature: 0, response_format: 'text' },
    deepgram: { detect_language: true, language: 'nl', smart_format: false, keyterm: 'Streaik', prompt: 'not supported' },
    google: { generation_config: { temperature: 0.4 } },
    gladia: { language_config: { languages: ['nl'], code_switching: true }, diarization: true },
  } };
  const json = async (route, model) => JSON.parse((await transcriptionBody(route, model, audio, settings)).body);
  const batch = '/api/transcriptions', stream = '/api/transcriptions/stream';
  for (const route of [batch, stream]) {
    const openai = await json(route, 'openai/gpt-4o-transcribe');
    assert.deepEqual(openai.providerOptions, { openai: { language: 'en', prompt: 'Terms', temperature: 0 } });
    const deepgram = await json(route, 'deepgram/nova-3');
    assert.deepEqual(deepgram.providerOptions, { deepgram: { detect_language: true, smart_format: false, keyterm: 'Streaik' } });
  }
  assert.deepEqual((await json(batch, 'google/gemini-3.5-flash')).providerOptions, { google: settings.providerOptions.google });
  assert.deepEqual((await json(batch, 'gladia/solaria-1')).providerOptions, { gladia: settings.providerOptions.gladia });
  assert.deepEqual((await json(batch, 'openai/gpt-4o-transcribe-diarize')).providerOptions, { openai: { language: 'en', chunking_strategy: 'auto' } });
  assert.equal((await json(batch, 'openrouter/example')).providerOptions, undefined);
});

test('native multipart keeps provider field names, repeated timestamps and model defaults', async () => {
  const route = '/v1/audio/transcriptions';
  const settings = { providerOptions: { openai: { language: 'nl', temperature: 0, 'timestamp_granularities[]': ['segment', 'word'] } } };
  const { body } = await transcriptionBody(route, 'openai/whisper-1', audio, settings);
  assert.equal(body.get('language'), 'nl');
  assert.equal(body.get('temperature'), '0');
  assert.equal(body.get('response_format'), 'verbose_json');
  assert.deepEqual(body.getAll('timestamp_granularities[]'), ['segment', 'word']);
  const diarized = (await transcriptionBody(route, 'openai/gpt-4o-transcribe-diarize', audio, settings)).body;
  assert.equal(diarized.get('response_format'), 'diarized_json');
  assert.equal(diarized.get('chunking_strategy'), 'auto');
  assert.equal(diarized.get('temperature'), null);
  assert.deepEqual(readNativeTranscript('WEBVTT\n\n00:01.000 --> 00:01.500\nHi there\n', 'vtt'), {
    text: 'Hi there', segments: [{ text: 'Hi there', startSecond: 1, endSecond: 1.5 }],
  });
});

test('Google Live uses native language codes, mode and vocabulary', () => {
  const options = { languageCodes: ['en-US', 'nl-NL'], mode: 'SMART', customVocabulary: ['Streaik'] };
  assert.deepEqual(googleLiveTranscriptionSetup('google/gemini-3.5-transcribe-live', options), {
    model: 'models/gemini-3.5-transcribe-live', generationConfig: { responseModalities: ['TEXT'] }, inputAudioTranscription: options,
  });
});

test('split settings migrate only the matching profile and use new defaults otherwise', () => {
  globalThis.localStorage = new Map();
  localStorage.getItem = localStorage.get.bind(localStorage);
  localStorage.setItem = localStorage.set.bind(localStorage);
  localStorage.setItem(transcriptionSettingsKey('a'), JSON.stringify({ split: false, overlap: 8 }));
  assert.deepEqual(loadChatPreferences('a').transcriptionSplit, { enabled: false, overlap: 8, maxChunkSizeMb: 15 });
  assert.deepEqual(loadChatPreferences('b').transcriptionSplit, { enabled: true, overlap: 5, maxChunkSizeMb: 15 });
  saveChatPreferences('a', { ...loadChatPreferences('a'), transcriptionSplit: { enabled: true, overlap: 60, maxChunkSizeMb: 1 } });
  assert.deepEqual(loadChatPreferences('a').transcriptionSplit, { enabled: true, overlap: 60, maxChunkSizeMb: 1 });
});

test('maximum overlap with a 1 MB chunk stays bounded and abort stops further work', async () => {
  const samples = new Float32Array(16_000 * 40);
  globalThis.OfflineAudioContext = class {
    async decodeAudioData() { return { duration: 40, length: samples.length, numberOfChannels: 1, getChannelData: () => samples }; }
  };
  const controller = new AbortController();
  const limit = Math.min(1024 * 1024, transcriptionUploadLimit('/api/transcriptions'));
  const chunks = splitTranscription(audio, limit, 60, controller.signal);
  const { value: first } = await chunks.next();
  const { value: second } = await chunks.next();
  assert.equal(first.file.size, limit);
  assert.ok(second.offset >= first.end / 2 && second.offset < first.end);
  assert.equal(second.end, 40);
  controller.abort();
  // A new split must not decode when already cancelled.
  await assert.rejects(splitTranscription(audio, limit, 60, controller.signal).next(), { name: 'AbortError' });
  await chunks.return();
});

test('merge drops real overlap, preserves unoverlapped repetition and offsets timestamps', () => {
  const part = (offset, end, text, segments = []) => ({ offset, end, transcript: { text, segments } });
  const merged = mergeTranscriptionChunks([
    part(0, 10, 'start same words', [{ text: 'same words', startSecond: 7, endSecond: 10 }]),
    part(7, 17, 'Same words. New thought', [{ text: 'Same words.', startSecond: 0, endSecond: 3 }, { text: 'New thought', startSecond: 3, endSecond: 8 }]),
    part(17, 19, 'New thought'),
  ]);
  assert.equal(merged.text, 'start same words New thought New thought');
  assert.deepEqual(merged.segments.map(({ startSecond, endSecond }) => [startSecond, endSecond]), [[7, 10], [10, 15]]);
  assert.equal(merged.durationInSeconds, 19);
});
