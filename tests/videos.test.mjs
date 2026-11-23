import assert from 'node:assert/strict';
import test from 'node:test';
import { createGateway, GatewayError } from '../packages/gateway/src/index.ts';

test('video start and status use the configured gateway and only the matching provider credentials', async () => {
  const calls = [];
  const credentialRequests = [];
  const operation = 'google/CfDJ8_a-b';
  const jobs = [{ operation }, { status: 'pending' }, { status: 'completed', videos: [
    { type: 'url', url: 'https://video.example/clip.mp4?signature=example', mediaType: 'video/mp4' },
    { type: 'base64', data: 'AQID', mediaType: 'video/mp4' },
    { type: 'binary', data: 'BAUG', mediaType: 'video/webm' },
    { type: 'binary', data: [7, 8, 9], mediaType: 'video/webm' },
    { type: 'url', url: 'javascript:alert(1)', mediaType: 'video/mp4' },
  ] }];
  const gateway = createGateway(new URL('https://gateway.example/tenant/'), request => {
    credentialRequests.push(request);
    return { 'X-Google-Key': 'fixture-key' };
  }, async (...args) => {
    calls.push(new Request(...args));
    return Response.json(jobs.shift());
  });
  const request = { model: 'google/veo-3.1-generate', prompt: 'A paper boat on a pond' };
  assert.equal(await gateway.startVideo(request), operation);
  assert.deepEqual(await gateway.getVideoStatus(operation), { status: 'pending' });
  const result = await gateway.getVideoStatus(operation);
  assert.equal(result.status, 'completed');
  assert.equal(result.videos.length, 4);
  assert.deepEqual(result.videos[0], { type: 'url', url: 'https://video.example/clip.mp4?signature=example' });
  assert.deepEqual(await Promise.all(result.videos.slice(1).map(async ({ blob }) => [blob.type, [...new Uint8Array(await blob.arrayBuffer())]])), [
    ['video/mp4', [1, 2, 3]], ['video/webm', [4, 5, 6]], ['video/webm', [7, 8, 9]],
  ]);
  assert.deepEqual(calls.map(({ url, method }) => [url, method]), [
    ['https://gateway.example/tenant/api/videos', 'POST'],
    ['https://gateway.example/tenant/api/videos/google/CfDJ8_a-b', 'GET'],
    ['https://gateway.example/tenant/api/videos/google/CfDJ8_a-b', 'GET'],
  ]);
  assert.deepEqual(await calls[0].json(), request);
  for (const call of calls) {
    assert.equal(call.headers.get('X-Google-Key'), 'fixture-key');
    assert.equal(call.credentials, 'omit');
    assert.equal(call.redirect, 'error');
  }
  assert.deepEqual(credentialRequests, Array.from({ length: 3 }, () => ({ kind: 'video', provider: 'google' })));
});

test('video references cannot redirect requests or switch providers', async () => {
  let credentialCalls = 0;
  const gateway = createGateway(new URL('https://gateway.example/'), () => { credentialCalls++; return {}; },
    async () => Response.json({ operation: 'openrouter/other-provider-token' }));
  await assert.rejects(gateway.startVideo({ model: 'google/veo', prompt: 'A pond' }), /invalid video job/);
  for (const operation of ['google/../models', 'google/%2e%2e', 'https://example.com/operation', 'google/job?target=elsewhere', 'google/job\n']) {
    await assert.rejects(gateway.getVideoStatus(operation), /invalid operation reference/);
  }
  assert.equal(credentialCalls, 1);
});

test('provider failure, missing media, and an expired reference are distinguishable from pending', async () => {
  const responses = [Response.json({ status: 'error', error: 'Generation stopped upstream.' }),
    Response.json({ status: 'completed', videos: [] }), new Response(null, { status: 404 })];
  const gateway = createGateway(new URL('https://gateway.example/'), () => ({}), async () => responses.shift());
  const operation = 'google/operation';
  assert.deepEqual(await gateway.getVideoStatus(operation), { status: 'error', error: 'Generation stopped upstream.' });
  assert.deepEqual(await gateway.getVideoStatus(operation), { status: 'error', error: 'The gateway returned no playable video.' });
  await assert.rejects(gateway.getVideoStatus(operation), error => error instanceof GatewayError && error.httpStatus === 404);
});
