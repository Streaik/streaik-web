import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import test from 'node:test';
import { createGateway, normalizeGatewayBase, pickChatModels, readChatModels, readModelCatalog } from '../packages/gateway/src/index.ts';
import { providerHeaders } from '../samples/byok/src/providerKeys.ts';

const root = normalizeGatewayBase('/gateway', 'http://localhost:5173');
const model = 'openai/gpt-4.1-mini';
const keys = { openai: 'test-openai', anthropic: 'test-anthropic' };
const messages = [
  { id: 'first', role: 'user', parts: [{ type: 'text', text: 'Hello' }] },
  { id: 'answer', role: 'assistant', parts: [{ type: 'text', text: 'World' }], metadata: { model } },
  { id: 'second', role: 'user', parts: [{ type: 'text', text: 'Follow-up' }] },
];

const examples = {
  data: [
    { id: model, object: 'model', type: null, name: model },
    { id: 'anthropic/claude-sonnet-4-6', type: 'model' },
    { id: 'openai/gpt-4o-realtime-preview' },
    { id: 'openai/gpt-5-chat-latest' },
    { id: 'openai/gpt-image-1', type: 'image' },
    { id: 'openai/text-embedding-3-small' },
    { id: 'openrouter/openai/gpt-4.1', type: 'language' },
    { id: 'google/gemini-2.5-flash', type: 'language' },
    { id: 'xai/grok-4', type: 'language' },
    { id: 'assemblyai/universal-streaming-english', type: 'transcription' },
    { id: 'imagerouter/model', type: 'language' },
    null,
  ],
};

test('only model families usable with the current API Chat route appear', () => {
  assert.deepEqual(readChatModels(examples).map(({ id }) => id),
    ['anthropic/claude-sonnet-4-6', 'google/gemini-2.5-flash', model, 'openrouter/openai/gpt-4.1', 'xai/grok-4']);
  assert.throws(() => readChatModels({ data: {} }), /invalid model list/);
});

test('gateway chat accepts Google agents and Fireworks chat without admitting transcription or decisions', () => {
  const data = [
    { id: 'google/agents/trip-planner', type: 'language', tags: ['agent'] },
    { id: 'fireworks/accounts/team/models/chat', type: 'language' },
    { id: 'fireworks/accounts/fireworks/models/rune', type: 'decision' },
    { id: 'gladia/solaria-1', type: 'transcription', tags: ['realtime'] },
    { id: 'gladia/solaria-3', type: 'transcription' },
  ];
  assert.deepEqual(readChatModels({ data }).map(({ id }) => id),
    ['fireworks/accounts/team/models/chat', 'google/agents/trip-planner']);
});

test('catalog preserves non-chat models, types, capabilities, limits and nested qualified IDs', async () => {
  const payload = { data: [
    { id: 'assemblyai/live', name: 'Live ASR', type: 'transcription', tags: [' real-time ', 'REALTIME', 'ASR', 1] },
    { id: 'imagerouter/vendor/a', type: 'image', context_window: 4096, max_tokens: 128 },
    { id: 'imagerouter/vendor/a', type: 'video', context_window: -1 },
    { id: 'google/gemini-live-previous', type: 'realtime' },
    { id: 'openai/gpt-4o-realtime-preview', type: 'language', tags: ['realtime'] },
    { id: 'openai/gpt-5-chat-latest', type: 'language' },
    { id: model, type: 'language' }, { id: '/invalid' }, { id: 'unqualified' },
  ] };
  let requests = 0;
  const gateway = createGateway(root, () => ({}), async () => { requests++; return Response.json(payload); });
  const catalog = await gateway.listModelCatalog();
  assert.deepEqual(catalog, readModelCatalog(payload));
  assert.equal(requests, 1);
  assert.equal(catalog.length, 7);
  assert.deepEqual(catalog.find(({ id }) => id === 'assemblyai/live').tags, ['realtime', 'asr']);
  assert.deepEqual(catalog.filter(({ provider }) => provider === 'imagerouter').map(({ type, contextWindow }) => [type, contextWindow]),
    [['image', 4096], ['video', undefined]]);
  assert.equal(catalog.find(({ provider }) => provider === 'google').type, 'audio');
  assert.deepEqual(pickChatModels(catalog).map(({ id }) => id), [model]);
});

test('catalog keeps valid USD-per-token prices isolated by model type and preserves zero rates', () => {
  const data = [
    { id: model, type: 'language', description: ' A published chat description. ',
      pricing: { input: ' 8e-7 ', output: 0, input_cache_read: '0', input_cache_write: '0.000001', other: 'ignored' } },
    { id: model, type: 'language', description: ' ', pricing: { input: false, output: 0 } },
    { id: model, type: 'decision', pricing: { input: 1e-6, output: 5e-6, input_cache_read: -1, input_cache_write: ' ' } },
  ];
  const catalog = readModelCatalog({ data });
  const chat = catalog.find(({ type }) => type === 'language');
  assert.equal(chat.description, 'A published chat description.');
  assert.deepEqual(chat.pricing, { input: 8e-7, output: 0, cacheRead: 0, cacheWrite: 1e-6 });
  assert.deepEqual(catalog.find(({ type }) => type === 'decision').pricing, { input: 1e-6, output: 5e-6 });
  for (const pricing of [null, [], '1e-6', { input: 0 }, { input: null, output: 0 }, { input: '0x10', output: 0 },
    { input: ' ', output: 0 }, { input: 0, output: -1 }, { input: 0, output: '1e999' }]) {
    assert.equal(readModelCatalog({ data: [{ id: model, pricing }] })[0].pricing, undefined);
  }
});

test('model listing gets both headers; chat gets only the selected provider and inline history', async () => {
  const gateway = createGateway(root, (request) => providerHeaders(keys, request), async (url, init) => {
    assert.equal(init.credentials, 'omit');
    assert.equal(init.redirect, 'error');
    assert.equal(init.headers.get('authorization'), null);
    assert.equal(init.headers.get('x-openai-key'), keys.openai);
    if (url.endsWith('/v1/models')) {
      assert.equal(url, 'http://localhost:5173/gateway/v1/models');
      assert.equal(init.headers.get('x-anthropic-key'), keys.anthropic);
      return Response.json(examples);
    }
    assert.equal(url, 'http://localhost:5173/gateway/api/chat');
    assert.equal(init.headers.get('x-anthropic-key'), null);
    assert.deepEqual(JSON.parse(init.body), { model, messages });
    const chunks = [{ type: 'start', messageId: 'reply' }, { type: 'text-start', id: '1' }, { type: 'text-delta', id: '1', delta: 'Reply' }, { type: 'text-end', id: '1' }, { type: 'finish' }];
    return new Response(chunks.map((part) => `data: ${JSON.stringify(part)}\n\n`).join('') + 'data: [DONE]\n\n', {
      headers: { 'Content-Type': 'text/event-stream', 'x-vercel-ai-ui-message-stream': 'v1' },
    });
  });
  assert.equal((await gateway.listModels()).length, 5);
  const stream = await gateway.chatTransport().sendMessages({ chatId: 'local', messages, body: { model }, trigger: 'submit-message' });
  const parts = await Array.fromAsync(stream);
  assert.equal(parts.find((part) => part.type === 'text-delta').delta, 'Reply');
});

test('request cancellation is preserved and errors omit upstream response bodies', async () => {
  const controller = new AbortController();
  let observed;
  const gateway = createGateway(root, () => ({}), async (_url, init) => {
    observed = init.signal;
    controller.abort();
    init.signal.throwIfAborted();
  });
  await assert.rejects(gateway.listModels(controller.signal), { name: 'AbortError' });
  assert.equal(observed, controller.signal);
  const bad = createGateway(root, () => ({}), async () => new Response('test-private-upstream-details', { status: 401 }));
  await assert.rejects(bad.listModels(), { message: /^Authentication failed\./ });
});

const decision = {
  model: 'anthropic/router', input: 'Follow-up text', instructions: 'Pick from the offered models.',
  choices: [{ value: model, description: 'OpenAI model' }, { value: 'anthropic/claude-example', description: 'Anthropic model' }],
};

test('both Decisions routes use their own wire format and scope auth to the decision model', async () => {
  const gateway = createGateway(root, (request) => {
    assert.deepEqual(request, { kind: 'decision', provider: 'anthropic' });
    return providerHeaders(keys, request);
  }, async (url, init) => {
    assert.equal(init.method, 'POST');
    assert.equal(init.credentials, 'omit');
    assert.equal(init.redirect, 'error');
    assert.equal(init.headers.get('x-anthropic-key'), keys.anthropic);
    assert.equal(init.headers.get('x-openai-key'), null);
    const { model: router, input, instructions, choices } = decision;
    if (url === `${root.href}v1/decisions`) {
      assert.deepEqual(JSON.parse(init.body), { model: router, input, questions: [{ type: 'choice', name: 'chat_model', instructions, choices }] });
      return Response.json({ answers: [{ name: 'chat_model', type: 'choice', choice: model }] });
    }
    assert.equal(url, `${root.href}api/decisions`);
    assert.deepEqual(JSON.parse(init.body), { model: router, state: input, questions: { chat_model: { type: 'choice', instructions,
      criteria: { [model]: 'OpenAI model', 'anthropic/claude-example': 'Anthropic model' } } } });
    return Response.json({ answers: { chat_model: { type: 'choice', choice: model } } });
  });
  assert.equal(await gateway.decideChoice('/v1/decisions', decision), model);
  assert.equal(await gateway.decideChoice('/api/decisions', decision), model);
  assert.deepEqual(await gateway.decideChoiceResult('/v1/decisions', decision), { choice: model });
  assert.deepEqual(await gateway.decideChoiceResult('/api/decisions', decision), { choice: model });
  await assert.rejects(gateway.decideChoice('https://invalid.example/', decision), /route is unavailable/);
});

test('decision results preserve valid optional scores without overriding the returned choice', async () => {
  const other = 'anthropic/claude-example';
  const probabilities = [{ value: model, probability: 0 }, { value: other, probability: 1 }];
  const answer = { type: 'choice', choice: model };
  const gateway = createGateway(root, () => ({}), async url => Response.json({ answers: url.endsWith('/v1/decisions')
    ? [{ ...answer, name: 'chat_model', confidence: 0, probabilities: [...probabilities,
      { value: 'not/offered', probability: 1 }, { value: model, probability: 1 }, null] }]
    : { chat_model: { ...answer, confidence: 2, probabilities: { [model]: 0, [other]: 1, 'not/offered': 1 } } },
  }));
  assert.deepEqual(await gateway.decideChoiceResult('/v1/decisions', decision), { choice: model, confidence: 0, probabilities });
  assert.deepEqual(await gateway.decideChoiceResult('/api/decisions', decision), { choice: model, probabilities });
});

test('Decisions rejects missing, refused, duplicate, and unoffered answers', async () => {
  const answer = { name: 'chat_model', type: 'choice', choice: model };
  for (const [endpoint, payload] of [
    ['/v1/decisions', { answers: [{ ...answer, choice: 'openai/not-offered' }] }],
    ['/v1/decisions', { answers: [{ ...answer, type: 'refusal' }] }],
    ['/v1/decisions', { answers: [answer, answer] }],
    ['/api/decisions', { answers: { other_question: answer } }],
    ['/api/decisions', { answers: { chat_model: { ...answer, choice: true } } }],
  ]) {
    const gateway = createGateway(root, () => ({}), async () => Response.json(payload));
    await assert.rejects(gateway.decideChoice(endpoint, decision), /did not return one of the selected/);
  }
  const controller = new AbortController();
  const gateway = createGateway(root, () => ({}), async (_url, init) => {
    assert.equal(init.signal, controller.signal);
    controller.abort();
    return Response.json({ answers: [answer] });
  });
  await assert.rejects(gateway.decideChoice('/v1/decisions', decision, controller.signal), { name: 'AbortError' });
});

test('credentials are not forwarded on redirects and insecure remote URLs are rejected', async (t) => {
  assert.throws(() => normalizeGatewayBase('http://gateway.example', root.href), /HTTPS/);
  assert.throws(() => normalizeGatewayBase('https://user:password@gateway.example/', root.href), /without credentials/);
  let redirected = 0;
  const server = createServer((req, res) => {
    if (req.url === '/v1/models') res.writeHead(302, { Location: '/other' }).end();
    else { redirected++; res.end(); }
  });
  await new Promise((resolve, reject) => server.once('error', reject).listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  const base = normalizeGatewayBase(`http://127.0.0.1:${server.address().port}/`, root.href);
  const gateway = createGateway(base, (request) => providerHeaders(keys, request));
  await assert.rejects(gateway.listModels(), /Could not reach/);
  assert.equal(redirected, 0);
});
