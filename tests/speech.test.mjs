import assert from 'node:assert/strict';
import test from 'node:test';
import { createGateway } from '../packages/gateway/src/index.ts';
import { importSpeechText } from '../packages/chat/src/speechFiles.ts';
import { normalizeSpeechPreferences, speechOptionsForModel } from '../packages/chat/src/speechPreferences.ts';
import { chatLocation } from '../packages/chat/src/chatLocation.ts';
import { defaultAgentModelIds, resolveModelSelection } from '../packages/chat/src/modelSelection.ts';

const endpoint = 'https://example.test/app/';
const text = 'One two.';
const model = 'openai/gpt-4o-mini-tts';
const req = { model, text };
const event = object => `data: ${JSON.stringify(object)}\r\n\r\n`;
const sse = body => new Response(body, { headers: { 'content-type': 'text/event-stream' } });
function gateway(fetcher, auth = () => ({})) { return createGateway(new URL(endpoint), auth, fetcher); }
const bytes = async blob => [...new Uint8Array(await blob.arrayBuffer())];

test('speech requests match each route and scope credentials and provider settings to the selected model', async () => {
  const calls = [];
  const client = gateway(async (url, init) => {
    calls.push([url, JSON.parse(init.body)]);
    assert.equal(init.headers.get('X-OpenAI-Key'), 'fixture');
    assert.equal(init.redirect, 'error');
    if (url.endsWith('/api/speech')) return Response.json({ audio: { base64: 'AQID', mediaType: 'audio/mpeg', format: 'mp3' },
      warnings: ['First', { message: 'Second' }], response: { timestamp: '2026-11-26T00:00:00Z' } });
    if (url.endsWith('/stream')) return sse(event({ type: 'audio', audio: 'AQID', audioFormat: { type: 'mp3' } }) + event({ type: 'finish' }));
    return new Response(new Uint8Array([1, 2, 3]), { headers: { 'content-type': 'audio/mpeg' } });
  }, request => {
    assert.deepEqual(request, { kind: 'speech', provider: 'openai' });
    return { 'X-OpenAI-Key': 'fixture' };
  });
  const options = { ...req, outputFormat: 'mp3', voice: 'alloy', speed: 1.2, language: 'en',
    providerOptions: { openai: { extra: 'value', input: 'cannot override native input' }, google: { other: true } } };
  const json = await client.generateSpeech('/api/speech', options);
  assert.deepEqual(await bytes(json.audio), [1, 2, 3]);
  assert.deepEqual(json.warnings, ['First', 'Second']);
  assert.equal(json.timestamp, '2026-11-26T00:00:00Z');
  await client.generateSpeech('/api/speech/stream', options);
  await client.generateSpeech('/v1/audio/speech', { ...options, streamFormat: 'audio' });
  const shared = { model, voice: 'alloy', speed: 1.2 };
  const sdk = { ...shared, language: 'en', providerOptions: { openai: options.providerOptions.openai } };
  assert.deepEqual(calls, [
    [`${endpoint}api/speech`, { ...sdk, text, outputFormat: 'mp3' }],
    [`${endpoint}api/speech/stream`, { ...sdk, text: [{ type: 'text', text }], outputFormat: { type: 'mp3' } }],
    [`${endpoint}v1/audio/speech`, { ...shared, input: text, response_format: 'mp3', stream_format: 'audio', extra: 'value' }],
  ]);
  await assert.rejects(client.generateSpeech('/api/speech/other', req), /route is unavailable/);
});

test('speech delivers decoded deltas in order and only completes after a terminal frame', async () => {
  for (const native of [false, true]) {
    const part = (audio) => native ? { type: 'speech.audio.delta', audio } : { type: 'audio', audio, audioFormat: { type: 'mp3' } };
    const wire = event(part('AQI=')) + event(part('AwQ=')) + event({ type: native ? 'speech.audio.done' : 'finish' });
    const body = new ReadableStream({ start(controller) {
      // Split the CRLF boundaries and the JSON to verify stream framing.
      for (let index = 0; index < wire.length; index += 7) controller.enqueue(new TextEncoder().encode(wire.slice(index, index + 7)));
      controller.close();
    } });
    const chunks = [];
    const route = native ? '/v1/audio/speech' : '/api/speech/stream';
    const result = await gateway(() => sse(body)).generateSpeech(route, req, undefined, (chunk, type) => chunks.push([[...chunk], type]));
    assert.deepEqual(chunks, [[[1, 2], 'audio/mpeg'], [[3, 4], 'audio/mpeg']]);
    assert.deepEqual(await bytes(result.audio), [1, 2, 3, 4]);
    await assert.rejects(gateway(() => sse(event(part('AQI=')))).generateSpeech(route, req), /before it completed/);
  }
});

test('speech cancellation releases a pending reader; invalid and empty responses fail', async () => {
  const cancellation = new AbortController();
  const started = Promise.withResolvers();
  const canceled = Promise.withResolvers();
  const body = new ReadableStream({ start(controller) {
    controller.enqueue(new TextEncoder().encode(event({ type: 'audio', audio: 'AQI=', audioFormat: { type: 'mp3' } })));
  }, cancel() { canceled.resolve(); } });
  const result = gateway(() => sse(body)).generateSpeech('/api/speech/stream', req, cancellation.signal, () => started.resolve());
  await started.promise;
  cancellation.abort();
  await assert.rejects(result, { name: 'AbortError' });
  await canceled.promise;
  await assert.rejects(gateway(() => Response.json({ audio: { base64: '!' } })).generateSpeech('/api/speech', req), /invalid speech audio/);
  await assert.rejects(gateway(() => sse(event({ type: 'finish' }))).generateSpeech('/api/speech/stream', req), /did not return speech audio/);
});

test('speech defaults stay live until explicitly overridden and only selected provider settings are sent', () => {
  assert.deepEqual(chatLocation('/speech'), { kind: 'page', view: 'speech' });
  const google = 'google/gemini-3.8-flash-tts';
  const models = [google, model].map(id => ({ id }));
  const select = (ids, id) => resolveModelSelection(models, ids, false, defaultAgentModelIds({ model: { id } })).selected;
  assert.equal(select(undefined, google)[0].id, google);
  assert.equal(select(undefined, model)[0].id, model);
  assert.equal(select([google], model)[0].id, google);
  const preferences = normalizeSpeechPreferences({ general: { speed: 1.2, language: 'nl' }, native: { voice: 'cedar', streamFormat: 'sse' },
    providers: { google: { temperature: 0, input: 'do not accept' }, elevenlabs: { stability: 0.4, use_speaker_boost: false } } });
  const gemini = speechOptionsForModel('/api/speech', google, preferences);
  assert.equal(gemini.outputFormat, 'wav');
  assert.equal(gemini.language, 'nl');
  assert.deepEqual(gemini.providerOptions, { google: { generation_config: { temperature: 0 } } });
  const compatible = speechOptionsForModel('/v1/audio/speech', model, preferences);
  assert.equal(compatible.streamFormat, 'sse');
  assert.equal(compatible.voice, 'cedar');
  assert.equal(compatible.language, undefined);
  assert.equal(compatible.providerOptions, undefined);
  const vercel = speechOptionsForModel('/api/speech/stream', model, preferences);
  assert.equal(vercel.voice, 'cedar');
  assert.equal(vercel.streamFormat, undefined);
});

test('speech imports editable text in order without returning uploaded files', async () => {
  const files = [new File(['  First '], 'first.txt'), new File([new Uint8Array([0xff, 0xf0])], 'broken.txt'),
    new File([' Second\n'], 'second.md'), new File(['%PDF'], 'report.pdf', { type: 'application/pdf' })];
  assert.deepEqual(await importSpeechText(files), { text: 'First\n\nSecond', issue: 'Some files could not be imported as text.' });
  assert.match((await importSpeechText(Array(11).fill(files[0]))).issue, /up to 10 text files/);
});
