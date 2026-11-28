import assert from 'node:assert/strict';
import test from 'node:test';
import { defaultImagePreferences, imageOptionsForModel, readImagePreferences, writeImagePreferences } from '../packages/chat/src/imagePreferences.ts';
import { createGateway, imageBatchSizes, imageSource } from '../packages/gateway/src/index.ts';

const root = new URL('https://gateway.example/prefix/');
const model = 'openai/gpt-image-1';
const file = new File([new Uint8Array([1, 2, 3, 4])], 'seed.png', { type: 'image/png' });
const attachment = { file, mediaType: file.type };
const url = 'https://example.org/reference.webp';
const prompt = 'A blue glass bird';

test('Vercel image requests use scoped credentials and preserve the returned response', async () => {
  const result = { images: ['AQIDBA==', 'data:image/webp;base64,UklGRg=='], warnings: [{ type: 'other', message: 'Example' }],
    response: { timestamp: '2026-01-03T00:00:00.000Z', modelId: model }, providerMetadata: { gateway: { cost: 0.3 } },
    usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30 } };
  const gateway = createGateway(root, (auth) => {
    assert.deepEqual(auth, { kind: 'image', provider: 'openai' });
    return { 'x-openai-key': 'test-only' };
  }, async (destination, request) => {
    assert.equal(destination, `${root}api/images`);
    assert.equal(request.method, 'POST');
    assert.equal(request.redirect, 'error');
    assert.equal(request.credentials, 'omit');
    assert.equal(request.headers.get('x-openai-key'), 'test-only');
    assert.deepEqual(JSON.parse(request.body), { model, prompt, n: 1, files: [
      { type: 'file', mediaType: 'image/png', data: 'AQIDBA==' }, { type: 'url', url },
    ] });
    return Response.json(result);
  });
  assert.deepEqual(await gateway.generateImages('/api/images', { model, prompt, inputs: [attachment, { url }] }), result);
  assert.equal(imageSource(result.images[1]), result.images[1]);
  assert.equal(imageSource('/9j/4AAQ'), 'data:image/jpeg;base64,/9j/4AAQ');
});

test('native generations translate the timestamp, usage and media type to the Vercel image shape', async () => {
  const gateway = createGateway(root, () => ({}), async (destination, request) => {
    assert.equal(destination, `${root}v1/images/generations`);
    assert.deepEqual(JSON.parse(request.body), { model, prompt, n: 1 });
    return Response.json({ created: 1767312000, output_format: 'webp', data: [{ b64_json: 'UklGRg==' }, { b64_json: 'UklGRw==' }],
      usage: { input_tokens: 10, output_tokens: 20, total_tokens: 30 }, cost: 0.05 });
  });
  assert.deepEqual(await gateway.generateImages('/v1/images/generations', { model, prompt, inputs: [] }), {
    images: ['data:image/webp;base64,UklGRg==', 'data:image/webp;base64,UklGRw=='], warnings: [],
    response: { modelId: model, timestamp: '2026-01-02T00:00:00.000Z', headers: undefined },
    usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30 }, providerMetadata: { gateway: { cost: 0.05 } },
  });
});

test('native edits use multipart for local files and JSON for links or mixed inputs', async () => {
  let calls = 0;
  const gateway = createGateway(root, () => ({}), async (destination, request) => {
    assert.equal(destination, `${root}v1/images/edits`);
    if (++calls === 1) {
      assert.equal(request.headers.has('content-type'), false); // Browser supplies the boundary.
      assert.equal(request.body.get('model'), model);
      assert.equal(request.body.get('prompt'), prompt);
      assert.equal(request.body.get('image[]').name, file.name);
    } else {
      assert.deepEqual(JSON.parse(request.body), { model, prompt, n: 1, images: [
        { image_url: 'data:image/png;base64,AQIDBA==' }, { image_url: url },
      ] });
    }
    return Response.json({ data: [{ b64_json: 'AQIDBA==' }] });
  });
  for (const inputs of [[attachment], [attachment, { url }]]) {
    const response = await gateway.generateImages('/v1/images/edits', { model, prompt, inputs });
    assert.deepEqual(response.images, ['AQIDBA==']);
    assert.equal(response.response.modelId, model);
  }
  assert.equal(calls, 2);
});

test('invalid routes, inputs and aborted requests never reach the gateway', async () => {
  const gateway = createGateway(root, () => assert.fail('Unexpected credential request'), () => assert.fail('Unexpected fetch'));
  await assert.rejects(gateway.generateImages('/v1/images/edits', { model, prompt, inputs: [] }), /Add a reference image/);
  await assert.rejects(gateway.generateImages('/v1/images/generations', { model, prompt, inputs: [attachment] }), /Remove attachments/);
  await assert.rejects(gateway.generateImages('/api/images', { model, prompt, inputs: [{ url: 'https://user:password@example.com/' }] }), /without credentials/);
  await assert.rejects(gateway.generateImages('/not-an-image-route', { model, prompt, inputs: [] }), /route is unavailable/);
  await assert.rejects(gateway.generateImages('/api/images', { model, prompt, inputs: [] }, AbortSignal.abort()), { name: 'AbortError' });
});

test('malformed or non-inline image responses are not accepted for saving', async () => {
  const gateway = createGateway(root, () => ({}), async () => Response.json({ data: [{ url: 'https://example.org/temporary.png' }] }));
  await assert.rejects(gateway.generateImages('/v1/images/generations', { model, prompt, inputs: [] }), /valid image response/);
});

test('image settings use the Vercel and native property names, including masks and typed multipart data', async () => {
  const svg = { model: 'svg-model', reasoning: { effort: 'medium' } };
  const generationOptions = { quality: 'high', output_format: 'svg', svg };
  const editOptions = { output_format: 'webp', output_compression: 0, input_fidelity: 'high', safety_identifier: 'hashed-user' };
  const common = { model, prompt, n: 1, size: '1024x1024' };
  const settings = { ...common, aspectRatio: '1:1', seed: -12 };
  const mask = { ...attachment, file: new File(['mask'], 'mask.png', { type: attachment.mediaType }) };
  const reference = { image_url: 'data:image/png;base64,bWFzaw==' };
  const vercelFile = { type: 'file', data: 'bWFzaw==', mediaType: 'image/png' };
  const paths = [];
  const gateway = createGateway(root, () => ({}), async (destination, request) => {
    paths.push(destination.replace(root.href, '/'));
    if (request.body instanceof FormData) {
      assert.equal(request.body.get('mask').name, 'mask.png');
      assert.equal(request.body.get('seed'), '-12');
      assert.equal(request.body.get('aspect_ratio'), '1:1');
      assert.equal(request.body.get('output_compression'), '0');
      assert.equal(request.body.get('input_fidelity'), 'high');
      assert.equal(request.body.get('safety_identifier'), 'hashed-user');
      assert.equal(request.body.get('n'), '1');
    } else {
      const body = JSON.parse(request.body);
      if (destination.endsWith('api/images')) {
        assert.deepEqual(body, { ...common, aspectRatio: '1:1', seed: -12, files: [{ type: 'url', url }], mask: vercelFile,
          providerOptions: { openai: { ...editOptions, markup: reference } } });
        return Response.json({ images: ['AQIDBA=='], warnings: [], response: { modelId: model, timestamp: '2026-01-01T00:00:00Z' } });
      }
      if (destination.endsWith('/edits')) {
        assert.deepEqual(body, { ...common, aspect_ratio: '1:1', seed: -12, ...editOptions,
          images: [{ image_url: url }], markup: reference });
      } else {
        assert.deepEqual(body, { ...common, ...generationOptions, aspect_ratio: '1:1', seed: -12 });
      }
    }
    return Response.json({ data: [{ b64_json: 'AQIDBA==' }] });
  });
  await gateway.generateImages('/api/images', { ...settings, providerOptions: { openai: editOptions }, inputs: [{ url }], mask, markup: mask });
  await gateway.generateImages('/v1/images/generations', { ...settings, body: generationOptions, inputs: [] });
  await gateway.generateImages('/v1/images/edits', { ...settings, body: editOptions, inputs: [{ url }], markup: mask });
  await gateway.generateImages('/v1/images/edits', { ...settings, body: editOptions, inputs: [attachment], mask });
  assert.deepEqual(paths, ['/api/images', '/v1/images/generations', '/v1/images/edits', '/v1/images/edits']);
});

test('Vercel preserves provider JSON and native edits fall back to JSON for typed extensions', async () => {
  const model = 'openrouter/vendor/image-model';
  const extra = { steps: 12, flags: { preserve_faces: false, strength: 0 }, variants: ['ink', null] };
  const providerOptions = { openrouter: extra, google: { image_size: '2K' } };
  const image = { image_url: 'data:image/png;base64,AQIDBA==' };
  const requests = [];
  const gateway = createGateway(root, () => ({}), async (destination, request) => {
    assert.equal(request.headers.get('content-type'), 'application/json');
    requests.push(JSON.parse(request.body));
    return destination.endsWith('/api/images')
      ? Response.json({ images: ['AQIDBA=='], warnings: [], response: { modelId: model, timestamp: '2026-01-01T00:00:00Z' } })
      : Response.json({ data: [{ b64_json: 'AQIDBA==' }] });
  });
  await gateway.generateImages('/api/images', { model, prompt, inputs: [], providerOptions, body: { ignored: true } });
  await gateway.generateImages('/v1/images/edits', { model, prompt, inputs: [attachment], mask: attachment, providerOptions,
    body: { ...extra, Model: 'ignored', n: 20, size: 'ignored', images: [], mask: null, stream: true, providerMetadata: { ignored: true } } });
  assert.deepEqual(requests, [
    { model, prompt, n: 1, providerOptions },
    { model, prompt, n: 1, images: [image], mask: image, ...extra },
  ]);
});

test('v1 General settings merge with only the selected provider, while Vercel keeps its own envelope', async () => {
  const selected = { id: 'imagerouter/vendor/image', provider: 'imagerouter' };
  const native = { n: 2, size: '1536x864' };
  const options = { quality: 'low', seed: 0, hints: { keep: false, extra: null } };
  const settings = { ...defaultImagePreferences, size: '512x512', aspectRatio: '16:9', seed: 22, native,
    byProvider: {
      openai: { quality: 'high', background: 'opaque', output_format: 'gif', frame_count: 3, frame_duration_ms: 200, input_fidelity: 'high', safety_identifier: 'previously-saved' },
      imagerouter: { ...options, background: undefined, model: 'not-the-model', providerOptions: { ignored: true } },
      openrouter: { complexity: 'high' },
    },
  };
  const requests = [];
  const gateway = createGateway(root, () => ({}), async (destination, request) => {
    requests.push(JSON.parse(request.body));
    return destination.endsWith('/api/images')
      ? Response.json({ images: ['AQIDBA=='], warnings: [], response: { modelId: selected.id, timestamp: '2026-01-01T00:00:00Z' } })
      : Response.json({ data: [{ b64_json: 'AQIDBA==' }] });
  });
  for (const [endpoint, inputs] of [['/api/images', []], ['/v1/images/generations', []], ['/v1/images/edits', [attachment]]]) {
    const edit = endpoint === '/v1/images/edits';
    await gateway.generateImages(endpoint, { ...imageOptionsForModel(endpoint, selected, settings, edit), model: selected.id, prompt, inputs,
      n: endpoint === '/api/images' ? settings.n : native.n });
  }
  const base = { model: selected.id, prompt };
  const expected = { ...base, ...native, ...options, background: 'opaque', output_format: 'gif', frame_count: 3, frame_duration_ms: 200 };
  assert.deepEqual(requests, [
    { ...base, n: 1, size: '512x512', aspectRatio: '16:9', seed: 22, providerOptions: { imagerouter: {
      ...options, model: 'not-the-model', providerOptions: { ignored: true },
    } } },
    expected,
    { ...expected, input_fidelity: 'high', images: [{ image_url: 'data:image/png;base64,AQIDBA==' }] },
  ]);
});

test('saved image profiles migrate legacy settings and keep v1 sizing and count independent of Vercel', (t) => {
  const storage = new Map([['streaik.images.settings.v1:old', JSON.stringify({
    n: 3, size: '1024x1024', maxImagesPerCall: 2, byProvider: { openai: { quality: 'hd', moderation: 'auto' } },
  })]]);
  const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  t.after(() => { if (original) Object.defineProperty(globalThis, 'localStorage', original); else delete globalThis.localStorage; });
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value),
  } });
  const migrated = readImagePreferences('old');
  assert.deepEqual(migrated.native, { n: 3, size: '1024x1024' });
  assert.equal(migrated.dallE3Quality, 'hd');
  assert.equal(migrated.byProvider.openai.quality, undefined);
  assert.equal(migrated.byProvider.openai.moderation, 'auto');
  writeImagePreferences('old', { ...migrated, native: { n: 4 }, mask: attachment, markup: attachment });
  const restored = readImagePreferences('old');
  assert.deepEqual(restored.native, { n: 4, size: undefined });
  assert.equal(restored.size, '1024x1024');
  assert.equal(restored.n, 3);
  assert.equal(restored.maxImagesPerCall, 2);
  assert.equal(restored.mask, undefined);
  assert.equal(restored.markup, undefined);
  assert.deepEqual(readImagePreferences('different-profile'), defaultImagePreferences);
});

test('native image requests reject out-of-range counts, multi-image SVG, or incompatible masks', async () => {
  const gateway = createGateway(root, () => assert.fail('Unexpected credential request'), () => assert.fail('Unexpected fetch'));
  const generation = { model, prompt, inputs: [] };
  const edit = { ...generation, inputs: [attachment], mask: attachment };
  await assert.rejects(gateway.generateImages('/v1/images/generations', { ...generation, n: 11 }), /between 1 and 10/);
  await assert.rejects(gateway.generateImages('/v1/images/generations', { ...generation, n: 2, body: { output_format: 'svg' } }), /SVG output requires one image/);
  await assert.rejects(gateway.generateImages('/v1/images/edits', { ...edit, markup: attachment }), /either a mask or a markup image/);
  await assert.rejects(gateway.generateImages('/v1/images/edits', { ...edit, body: { output_format: 'gif' } }), /GIF output does not support masks/);
});

test('image batches respect the total, configured maximum, and model limits', () => {
  assert.deepEqual(imageBatchSizes(model, 7, 3), [3, 3, 1]);
  assert.deepEqual(imageBatchSizes(model, 20, 20), [10, 10]);
  assert.deepEqual(imageBatchSizes('google/imagen-4', 5, 8), [4, 1]);
  assert.deepEqual(imageBatchSizes('google/gemini-image', 3, 5), [1, 1, 1]);
  assert.deepEqual(imageBatchSizes('openai/dall-e-3', 3, 3), [1, 1, 1]);
  assert.throws(() => imageBatchSizes(model, 21, 3), /between 1 and 20/);
  assert.throws(() => imageBatchSizes(model, 1, 0), /between 1 and 20/);
});
