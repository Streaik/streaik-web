import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { createDirectChat, createGateway, nativeChatEndpoints } from '../packages/gateway/src/index.ts';

const { providers } = JSON.parse(readFileSync(new URL('../packages/chat/src/provider-directory.json', import.meta.url)));
const root = new URL('https://gateway.example.test/prefix/');
const keys = { openai: 'openai-key', anthropic: 'anthropic-key', openrouter: 'openrouter-key' };
const messages = [
  { id: 'user1', role: 'user', parts: [{ type: 'text', text: 'Hello' }] },
  { id: 'assistant1', role: 'assistant', parts: [{ type: 'text', text: 'Earlier reply' }] },
  { id: 'user2', role: 'user', parts: [{ type: 'text', text: 'Follow-up' }] },
];
const chat = '/v1/chat/completions', responses = '/v1/responses', messagesApi = '/v1/messages';
const metrics = { gateway: { ttft: 0.2, tps: 9, cost: 0 } };

function sse(frames) {
  const data = frames.map(value => `${value.type ? `event: ${value.type}\n` : ''}data: ${typeof value === 'string' ? value : JSON.stringify(value)}\n\n`).join('');
  return new Response(data, { headers: { 'content-type': 'text/event-stream' } });
}

function response(endpoint, model, bridged = false) {
  if (endpoint === chat) return sse([
    { id: 'c1', object: 'chat.completion.chunk', created: 1, model, choices: [{ index: 0, delta: { role: 'assistant', content: 'native reply' }, finish_reason: 'stop' }] },
    { id: 'c1', object: 'chat.completion.chunk', created: 1, model, choices: [], usage: { prompt_tokens: 5, completion_tokens: 2, total_tokens: 7 }, metadata: metrics },
    '[DONE]',
  ]);
  if (endpoint === messagesApi) return sse([
    { type: 'message_start', message: { type: 'message', id: 'm1', model, role: 'assistant', content: [], usage: { input_tokens: bridged ? 0 : 5, output_tokens: 0 } } },
    { type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: '', signature: '' } },
    { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'native reasoning' } },
    { type: 'content_block_delta', index: 0, delta: { type: 'signature_delta', signature: 'fixture-signature' } },
    { type: 'content_block_stop', index: 0 },
    { type: 'content_block_start', index: 1, content_block: { type: 'text', text: '' } },
    { type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: 'native reply' } },
    { type: 'content_block_stop', index: 1 },
    { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 2, ...(bridged && { input_tokens: 5 }) } },
    { type: 'message_stop', metadata: metrics },
  ]);
  const envelope = { id: 'r1', created_at: 1, model, usage: { input_tokens: 5, output_tokens: 2, total_tokens: 7 } };
  const item = { id: 'm1', type: 'message', role: 'assistant', status: 'in_progress', content: [] };
  return sse([
    { type: 'response.created', response: envelope },
    { type: 'response.output_item.added', output_index: 0, item },
    { type: 'response.output_text.delta', output_index: 0, content_index: 0, item_id: 'm1', delta: 'native reply' },
    { type: 'response.output_item.done', output_index: 0, item: { ...item, status: 'completed', content: [{ type: 'output_text', text: 'native reply', annotations: [] }] } },
    { type: 'response.completed', response: { ...envelope, metadata: metrics } },
  ]);
}

async function send(transport, model, extras = {}) {
  return Array.fromAsync(await transport.sendMessages({ chatId: 'conversation', messages, body: { model }, trigger: 'submit-message', ...extras }));
}

for (const endpoint of nativeChatEndpoints) {
  const provider = endpoint === messagesApi ? 'anthropic' : 'openai';
  const native = provider === 'anthropic' ? 'claude-sonnet-4-6' : 'gpt-4.1-mini';
  const qualified = `${provider}/${native}`;
  for (const direct of [false, true]) {
    test(`${direct ? 'Direct' : 'Gateway'} ${endpoint} sends native wire format and yields canonical UI chunks`, async () => {
      let request;
      const fetcher = async (url, init) => {
        request = { url, ...init, body: JSON.parse(init.body) };
        return response(endpoint, request.body.model);
      };
      const client = direct ? createDirectChat(providers, id => keys[id], fetcher)
        : createGateway(root, ({ provider: id }) => ({ Authorization: 'Bearer entra-token', [`x-selected-${id}`]: 'gateway-only' }), fetcher);
      const parts = await send(client.chatTransport(endpoint), qualified, direct
        ? { body: { model: qualified, instructions: ['Gateway-only context'] } } : {});
      assert.equal(request.url, direct ? `https://api.${provider}.com${endpoint}` : `${root.href}${endpoint.slice(1)}`);
      assert.equal(request.headers.get('authorization'), direct ? provider === 'openai' ? 'Bearer openai-key' : null : 'Bearer entra-token');
      assert.equal(request.headers.get('x-api-key'), direct && provider === 'anthropic' ? keys.anthropic : null);
      assert.equal(request.headers.get('anthropic-dangerous-direct-browser-access'), direct && provider === 'anthropic' ? 'true' : null);
      assert.equal(request.headers.get(`x-selected-${provider}`), direct ? null : 'gateway-only');
      assert.equal(request.redirect, 'error');
      assert.equal(request.credentials, 'omit');
      assert.equal(request.body.model, direct ? native : qualified);
      assert.equal(request.body.stream, true);
      const history = request.body.input ?? request.body.messages;
      assert.deepEqual(history.map(msg => msg.role), ['user', 'assistant', 'user']);
      assert.equal(request.body.system, undefined);
      assert.match(JSON.stringify(history), /Earlier reply/);
      if (endpoint === responses) {
        assert.equal(request.body.store, false);
        assert.equal(request.body.previous_response_id, undefined);
        assert.ok(history.every(msg => msg.type !== 'item_reference'));
      }
      if (endpoint === chat) assert.equal(request.body.stream_options.include_usage, true);
      assert.deepEqual(parts.filter(part => part.type === 'error'), []);
      assert.equal(parts.find(part => part.type === 'text-delta')?.delta, 'native reply');
      if (endpoint === messagesApi) assert.equal(parts.find(part => part.type === 'reasoning-delta')?.delta, 'native reasoning');
      const finish = parts.find(part => part.type === 'finish');
      assert.deepEqual(finish.messageMetadata.usage, { promptTokens: 5, completionTokens: 2, totalTokens: 7 });
      assert.equal(finish.messageMetadata.model, qualified);
      const saved = finish.messageMetadata.providerMetadata?.gateway;
      if (direct) {
        assert.equal(saved.source, 'direct');
        assert.ok(!('currency' in saved) && !('estimated' in saved));
        assert.ok(saved.ttft >= 0);
        assert.ok(Math.abs(saved.cost - (provider === 'anthropic' ? 0.000045 : 0.0000104)) < 1e-14);
        if (endpoint !== messagesApi) assert.equal(saved.tps, undefined, 'a single output chunk has no throughput interval');
      } else assert.deepEqual(saved, metrics.gateway);
    });
  }

  test(`Gateway ${endpoint} sends separate system instruction entries and accepts a legacy string`, async () => {
    const requests = [];
    const model = endpoint === messagesApi ? 'anthropic/claude-sonnet-4-6' : 'openai/gpt-4.1-mini';
    const gateway = createGateway(root, () => ({}), async (_url, init) => {
      requests.push(JSON.parse(init.body));
      return response(endpoint, model);
    });
    const instructions = [JSON.stringify({ availableSkills: { instructions: 'Use the exact skill ID.' } }),
      JSON.stringify({ systemInformation: { appName: 'Streaik' } }), JSON.stringify({ preferredLanguage: 'en' })];
    const transport = gateway.chatTransport(endpoint);
    const contextFrom = body => endpoint === messagesApi ? body.system.map(block => block.text)
      : (body.input ?? body.messages).filter(message => message.role === 'system').map(message => message.content);
    const parts = await send(transport, model, { body: { model, instructions } });
    assert.deepEqual(parts.filter(part => part.type === 'error'), []);
    assert.deepEqual(contextFrom(requests[0]), instructions);

    const legacy = 'Legacy instructions';
    await send(transport, model, { body: { model, instructions: legacy } });
    assert.deepEqual(contextFrom(requests[1]), [legacy]);

    const direct = createDirectChat(providers, provider => keys[provider], async (_url, init) => {
      const body = JSON.parse(init.body);
      requests.push(body);
      return response(endpoint, body.model);
    });
    const mcpInstructions = [JSON.stringify({ mcpResourceCatalog: { readTool: 'read_resource' } })];
    await send(direct.chatTransport(endpoint), model, { body: { model, instructions, mcpInstructions } });
    assert.deepEqual(contextFrom(requests[2]), mcpInstructions);
  });
}

for (const endpoint of nativeChatEndpoints) {
  test(`${endpoint} sends native image, document and text parts without downloading links`, async () => {
    const requests = [];
    const model = endpoint === messagesApi ? 'anthropic/claude-sonnet-4-6' : 'openai/gpt-4.1-mini';
    const gateway = createGateway(root, () => ({}), async (url, init) => {
      assert.equal(url, `${root.href}${endpoint.slice(1)}`);
      const body = JSON.parse(init.body);
      requests.push(body);
      return response(endpoint, body.model);
    });
    const image = 'https://files.example.test/image.png';
    const pdf = 'data:application/pdf;base64,JVBERg==';
    const page = 'https://files.example.test/wiki';
    const pdfLink = 'https://files.example.test/file.pdf';
    const docx = 'data:application/vnd.openxmlformats-officedocument.wordprocessingml.document;base64,UEs=';
    const attachments = [{ type: 'file', mediaType: 'image/png', url: image },
      { type: 'file', mediaType: 'application/pdf', filename: 'file.pdf', url: pdf },
      { type: 'file', mediaType: 'application/pdf', filename: 'remote.pdf', url: pdfLink },
      { type: 'file', mediaType: 'text/html', url: page }, { type: 'text', text: 'Converted file text' }];
    if (endpoint === responses) attachments.push({ type: 'file', mediaType: docx.split(':')[1].split(';')[0], filename: 'notes.docx', url: docx });
    const chunks = await send(gateway.chatTransport(endpoint), model, { messages: [{ id: 'attachments', role: 'user', parts: attachments }] });
    assert.deepEqual(chunks.filter(part => part.type === 'error'), []);
    assert.equal(requests.length, 1);
    const parts = (requests[0].input ?? requests[0].messages)[0].content;
    if (endpoint === responses) {
      assert.deepEqual(parts.map(part => part.type), ['input_image', 'input_file', 'input_file', 'input_text', 'input_text', 'input_file']);
      assert.equal(parts[0].image_url, image);
      assert.equal(parts[1].file_data, pdf);
      assert.equal(parts[1].filename, 'file.pdf');
      assert.equal(parts[2].file_url, pdfLink);
      assert.equal(parts[5].file_data, docx);
    } else if (endpoint === messagesApi) {
      assert.deepEqual(parts.map(part => part.type), ['image', 'document', 'document', 'text', 'text']);
      assert.deepEqual(parts[0].source, { type: 'url', url: image });
      assert.deepEqual(parts[1].source, { type: 'base64', media_type: 'application/pdf', data: 'JVBERg==' });
      assert.deepEqual(parts[2].source, { type: 'url', url: pdfLink });
    } else {
      assert.deepEqual(parts.map(part => part.type), ['image_url', 'file', 'text', 'text', 'text']);
      assert.equal(parts[0].image_url.url, image);
      assert.deepEqual(parts[1].file, { filename: 'file.pdf', file_data: pdf });
      assert.equal(parts[2].text.trim(), `Link: ${pdfLink}`);
    }
    assert.equal(parts[3].text.trim(), `Link: ${page}`);
    assert.equal(parts[4].text, 'Converted file text');
  });
}

test('Direct discovers models only from keyed catalog providers, with native pagination and path prefixes', async () => {
  const seen = [];
  const direct = createDirectChat(providers, id => ({ ...keys, deepgram: 'never-sent' })[id], async (url, init) => {
    seen.push(url);
    if (url === 'https://api.openai.com/v1/models') {
      assert.equal(init.headers.get('authorization'), 'Bearer openai-key');
      return Response.json({ data: [{ id: 'gpt-4.1-mini' }, { id: 'gpt-image-1' }] });
    }
    if (url === 'https://openrouter.ai/api/v1/models') {
      assert.equal(init.headers.get('authorization'), 'Bearer openrouter-key');
      return Response.json({ data: [{ id: 'vendor/model', architecture: { output_modalities: ['text'] } }, { id: 'vendor/image' }] });
    }
    assert.equal(init.headers.get('x-api-key'), 'anthropic-key');
    assert.equal(init.headers.get('authorization'), null);
    if (url === 'https://api.anthropic.com/v1/models') return Response.json({ data: [{ id: 'claude-one', type: 'model' }], has_more: true, last_id: 'id & suffix' });
    assert.equal(url, 'https://api.anthropic.com/v1/models?after_id=id%20%26%20suffix');
    return Response.json({ data: [{ id: 'claude-two', type: 'model' }], has_more: false });
  });
  assert.deepEqual(direct.endpoints(), [...nativeChatEndpoints]);
  assert.deepEqual((await direct.listModelCatalog()).map(model => model.id),
    ['anthropic/claude-one', 'anthropic/claude-two', 'openai/gpt-4.1-mini', 'openrouter/vendor/model']);
  assert.equal(seen.length, 4);
  await assert.rejects(send(direct.chatTransport(responses), 'openrouter/vendor/model'), /does not support/);
  assert.equal(seen.length, 4);
});

test('Gateway Messages consumes bridged streams that report input usage only at the end', async () => {
  const model = 'groq/vendor/model';
  const gateway = createGateway(root, () => ({}), async () => response(messagesApi, model, true));
  const parts = await send(gateway.chatTransport(messagesApi), model);
  assert.equal(parts.find(part => part.type === 'text-delta')?.delta, 'native reply');
  assert.deepEqual(parts.find(part => part.type === 'finish').messageMetadata.usage,
    { promptTokens: 5, completionTokens: 2, totalTokens: 7 });
});

test('Direct model IDs retain nested prefixes on the wire and credentials do not cross providers', async () => {
  const direct = createDirectChat(providers, id => id === 'openrouter' ? keys.openrouter : undefined, async (url, init) => {
    assert.equal(url, 'https://openrouter.ai/api/v1/chat/completions');
    assert.equal(init.headers.get('authorization'), 'Bearer openrouter-key');
    assert.equal(init.headers.get('x-api-key'), null);
    const body = JSON.parse(init.body);
    assert.equal(body.model, 'vendor/model');
    assert.equal(Object.hasOwn(body, 'store'), false);
    return response(chat, body.model);
  });
  assert.deepEqual(direct.endpoints(), [chat]);
  await assert.rejects(send(direct.chatTransport(chat), 'openai/gpt-4.1-mini'), /Set or unlock/);
  const parts = await send(direct.chatTransport(chat), 'openrouter/vendor/model');
  assert.equal(parts.find(part => part.type === 'finish').messageMetadata.model, 'openrouter/vendor/model');
});

test('OpenAI Direct uses the returned model rate with the reported cache read and write counts', async () => {
  const requested = 'openai/gpt-4.1-mini';
  const resolved = 'gpt-6.1-terra';
  const direct = createDirectChat(providers, id => keys[id], async () => sse([
    { id: 'c1', model: resolved, choices: [{ index: 0, delta: { content: 'native reply' }, finish_reason: 'stop' }] },
    { id: 'c1', model: resolved, choices: [], usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120,
      prompt_tokens_details: { cached_tokens: 30, cache_write_tokens: 10 } } },
    '[DONE]',
  ]));
  const parts = await send(direct.chatTransport(chat), requested);
  const metadata = parts.find(part => part.type === 'finish').messageMetadata;
  assert.equal(metadata.model, requested);
  const cost = 60 * 0.000001 + 20 * 0.000005 + 30 * 0.00000005 + 10 * 0.00000125;
  assert.ok(Math.abs(metadata.providerMetadata.gateway.cost - cost) < 1e-14);
});

for (const [reported, expected] of [['0.000125', 0.000125], [0, 0], ['invalid', undefined]]) {
  test(`OpenRouter Direct preserves late cost ${reported} without losing earlier usage`, async () => {
    let calls = 0;
    const model = 'openrouter/vendor/model';
    const direct = createDirectChat(providers, id => keys[id], async () => {
      calls++;
      const frame = { id: 'c1', model: 'vendor/model' };
      return sse([
        { ...frame, choices: [{ index: 0, delta: { content: 'native reply' }, finish_reason: 'stop' }] },
        { ...frame, choices: [], usage: { prompt_tokens: 5, completion_tokens: 2, total_tokens: 7 } },
        { ...frame, choices: [], usage: { cost: reported } },
        '[DONE]',
      ]);
    });
    const parts = await send(direct.chatTransport(chat), model);
    assert.deepEqual(parts.filter(part => part.type === 'error'), []);
    const metadata = parts.find(part => part.type === 'finish').messageMetadata;
    assert.deepEqual(metadata.usage, { promptTokens: 5, completionTokens: 2, totalTokens: 7 });
    assert.equal(metadata.providerMetadata.gateway.cost, expected);
    assert.ok(!('currency' in metadata.providerMetadata.gateway) && !('estimated' in metadata.providerMetadata.gateway));
    assert.equal(calls, 1);
  });
}

test('native transport replays a completed client tool inline and never exposes an upstream error body', async () => {
  const model = 'openai/gpt-4.1-mini';
  let request;
  const gateway = createGateway(root, () => ({}), async (_url, init) => {
    request = JSON.parse(init.body);
    return new Response('private-upstream-error-with-key', { status: 403 });
  });
  const parts = await send(gateway.chatTransport(responses), model, {
    messages: [messages[0], { id: 'assistant-tool', role: 'assistant', parts: [
      { type: 'dynamic-tool', toolName: 'lookup', toolCallId: 'call_1', state: 'output-available', input: { query: 'example' }, output: 'fixture result' },
    ] }],
    body: { model, tools: [{ name: 'lookup', inputSchema: { type: 'object' } }] },
  });
  assert.equal(request.tools[0].name, 'lookup');
  assert.ok(request.input.some(item => item.type === 'function_call' && item.call_id === 'call_1'));
  assert.ok(request.input.some(item => item.type === 'function_call_output' && item.call_id === 'call_1' && item.output === 'fixture result'));
  assert.match(parts.find(part => part.type === 'error').errorText, /gateway denied access/);
  assert.doesNotMatch(JSON.stringify(parts), /private-upstream/);
});

test('native cancellation aborts the scoped fetch without retry or reconnect', async () => {
  const controller = new AbortController();
  let calls = 0;
  const gateway = createGateway(root, () => ({}), async (_url, init) => {
    calls++;
    assert.ok(init.signal);
    controller.abort();
    assert.equal(init.signal.aborted, true);
    init.signal.throwIfAborted();
  });
  const transport = gateway.chatTransport(chat);
  const parts = await send(transport, 'openai/gpt-4.1-mini', { abortSignal: controller.signal });
  assert.ok(parts.some(part => part.type === 'abort'));
  assert.equal(calls, 1);
  assert.equal(await transport.reconnectToStream({ chatId: 'conversation' }), null);
});
