import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { readUIMessageStream } from 'ai';
import { createDirectChat, createGateway, gatewayChatEndpoints, nativeChatEndpoints } from '../packages/gateway/src/index.ts';
import { isClientToolSearch, searchClientTools, searchLocalToolCatalog } from '../packages/chat/src/clientToolSearch.ts';
import { activeChatTools, runLocalTool } from '../packages/chat/src/localPlugins.ts';
import { chatRequestTools, configureChatTools } from '../packages/chat/src/chatToolRequest.ts';
import { chatProviderRequest } from '../packages/chat/src/providerChat/settings.ts';
import { agentProviderRequest, withAgentProviderOptions } from '../packages/chat/src/agentProviderSettings.ts';

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

test('Gateway Responses streams hosted call cards and excludes them from the next stateless request', async () => {
  const model = 'mistral/mistral-large-latest';
  const requests = [];
  const hostedMcp = [{ type: 'mcp', server_label: 'inventory', server_url: 'https://inventory.example.test/mcp', require_approval: 'never' }];
  const activity = { callId: 'fixture_hosted_call', name: 'streaik_inventory_lookup', input: { sku: 'A-1' }, output: null, error: null };
  const frame = fields => new TextEncoder().encode(`event: streaik.hosted_tool_activity\ndata: ${JSON.stringify({
    type: 'streaik.hosted_tool_activity', activity: { ...activity, ...fields },
  })}\n\n`);
  let downstream;
  const gateway = createGateway(root, () => ({ authorization: 'Bearer model-key' }), async (_url, init) => {
    assert.equal(new Headers(init.headers).get('x-streaik-hosted-tool-activity'), '1');
    const body = JSON.parse(init.body);
    requests.push(body);
    if (requests.length > 1) return response(responses, model);
    return new Response(new ReadableStream({ start(controller) {
      downstream = controller;
      controller.enqueue(frame({ callId: 'unmatched', output: 'Not a result to render' }));
      controller.enqueue(frame({}));
    } }), { headers: { 'content-type': 'text/event-stream' } });
  });
  const transport = gateway.chatTransport(responses);
  const body = { model, hostedMcp };
  const user = messages[0];
  const chunks = await transport.sendMessages({ chatId: 'conversation', messages: [user], body, trigger: 'submit-message', abortSignal: AbortSignal.timeout(5000) });
  const replies = readUIMessageStream({ stream: chunks, terminateOnError: true })[Symbol.asyncIterator]();
  try {
    let reply;
    do {
      const next = await replies.next();
      assert.equal(next.done, false, 'expected hosted tool activity before the model reply');
      reply = next.value;
    } while (!reply.parts.some(part => part.type === 'dynamic-tool'));
    const [part] = reply.parts;
    assert.equal(part.state, 'input-available');
    assert.equal(part.providerExecuted, true);
    assert.equal(part.toolMetadata.streaikHosted, true);
    assert.deepEqual(part.input, { sku: 'A-1' });
    downstream.enqueue(frame({ name: 'wrong_tool', output: 'Wrong name' }));
    downstream.enqueue(frame({ output: { result: 'Found' } }));
    downstream.enqueue(frame({ output: 'Duplicate' }));
    downstream.enqueue(new Uint8Array(await response(responses, model).arrayBuffer()));
    downstream.close();
    for (;;) {
      const next = await replies.next();
      if (next.done) break;
      reply = next.value;
    }
    assert.deepEqual(reply.parts.filter(part => part.type === 'dynamic-tool').map(part => part.output), [{ result: 'Found' }]);
    assert.ok(reply.parts.some(part => part.type === 'text' && part.text === 'native reply'));

    await send(transport, model, { messages: [user, reply, messages[2]], body });
    assert.equal(requests.length, 2);
    assert.equal(requests[1].store, false);
    assert.match(JSON.stringify(requests[1].input), /native reply/);
    assert.doesNotMatch(JSON.stringify(requests[1].input), /fixture_hosted_call|streaik_inventory_lookup|Found|function_call/);
  } finally {
    await replies.return();
  }
});

for (const endpoint of gatewayChatEndpoints) test(`Gateway sends named hosted skills on ${endpoint} and scopes the skill key`, async () => {
  const api = endpoint === '/api/chat';
  const model = endpoint === messagesApi ? 'anthropic/claude-sonnet-4-6' : 'openai/gpt-4.1-mini';
  const modelProvider = model.split('/')[0];
  const skillProvider = modelProvider === 'openai' ? 'anthropic' : 'openai';
  const hostedSkills = [{ type: 'skill_reference', skill_id: `${skillProvider}/skill_test` },
    { type: 'inline', name: 'meeting-notes', description: 'Help with meetings.', source: { type: 'base64', media_type: 'application/zip', data: 'AQ==' } }];
  const tools = [{ name: 'lookup', inputSchema: { type: 'object', properties: {} } }];
  const authRequests = [];
  const observed = [];
  const gateway = createGateway(root, auth => {
    authRequests.push(auth);
    return auth.kind === 'skill' ? { authorization: 'must-not-override', [`x-${skillProvider}-key`]: 'scoped-skill-key', 'x-unrelated-key': 'no' }
      : { authorization: 'Bearer model-key' };
  }, async (url, init) => {
    assert.equal(url, new URL(endpoint.slice(1), root).href);
    const body = JSON.parse(init.body);
    observed.push({ body, headers: new Headers(init.headers) });
    return api ? sse([{ type: 'start' }, { type: 'finish', finishReason: 'stop' }, '[DONE]']) : response(endpoint, body.model);
  });
  const chunks = await send(gateway.chatTransport(endpoint), model, { body: { model, tools, hostedSkills, toolChoice: 'none' } });
  assert.equal(observed.length, 1);
  assert.deepEqual(chunks.filter(chunk => chunk.type === 'error'), []);
  const [{ body, headers }] = observed;
  assert.equal(body.hostedSkills, undefined);
  assert.equal(body.tools[0].name ?? body.tools[0].function.name, 'lookup');
  assert.deepEqual(body.tools[1], api ? { name: 'skills', inputSchema: { type: 'object', skills: { skills: hostedSkills } } }
    : { type: 'skills', name: 'skills', skills: hostedSkills });
  assert.deepEqual(api ? body.toolChoice : body.tool_choice, endpoint === messagesApi ? { type: 'none' } : 'none');
  assert.equal(headers.get('authorization'), 'Bearer model-key');
  assert.equal(headers.get(`x-${skillProvider}-key`), 'scoped-skill-key');
  assert.equal(headers.has('x-unrelated-key'), false);
  assert.deepEqual(authRequests, [{ kind: 'chat', provider: modelProvider }, { kind: 'skill', provider: skillProvider }]);
});

for (const endpoint of nativeChatEndpoints) test(`Direct never serializes hosted skills on ${endpoint}`, async () => {
  const model = endpoint === messagesApi ? 'anthropic/claude-sonnet-4-6' : 'openai/gpt-4.1-mini';
  const hostedSkills = [{ type: 'skill_reference', skill_id: 'anthropic/skill_private' }];
  const observed = [];
  const direct = createDirectChat(providers, id => keys[id], async (_url, init) => {
    const body = JSON.parse(init.body);
    observed.push(body);
    return response(endpoint, body.model);
  });
  const chunks = await send(direct.chatTransport(endpoint), model, { body: { model, hostedSkills } });
  assert.equal(observed.length, 1);
  assert.deepEqual(chunks.filter(chunk => chunk.type === 'error'), []);
  assert.doesNotMatch(JSON.stringify(observed[0]), /skill_private|hostedSkills/);
});

test('Local Tool search is opt-in, stays eager, and searches the current catalog', async () => {
  const route = { mode: 'gateway', endpoint: '/api/chat' };
  const empty = activeChatTools(route, [], true, []);
  assert.deepEqual(empty, []);
  const local = activeChatTools(route, ['local-tool-search', 'local-conversations'], true, []);
  const plugin = local.find(tool => tool.definition.name === 'client_tool_search');
  assert.ok(plugin);
  const definitions = chatRequestTools(configureChatTools(local, { client_tool_search: { defer_loading: true, allowed_callers: ['programmatic'] },
    local_conversations_list_all: { defer_loading: true } }, true));
  const search = definitions.find(tool => tool.name === 'client_tool_search');
  assert.equal(search.defer_loading, undefined);
  assert.equal(search.namespace, undefined);
  assert.equal(search.allowed_callers, undefined);
  const result = await runLocalTool(plugin, { goal: 'conversation summaries' }, { catalog: [], history: [],
    searchTools: goal => searchLocalToolCatalog(undefined, goal, definitions, true, new AbortController().signal) });
  assert.deepEqual(result.structuredContent.selectedTools.map(tool => tool.name), ['local_conversations_list_all']);
});

for (const direct of [false, true]) {
  test(`${direct ? 'Direct' : 'Gateway'} Anthropic Messages sends explicit version, tokens and opaque native settings`, async () => {
    const model = 'anthropic/claude-sonnet-4-6';
    const request = chatProviderRequest(undefined, model);
    assert.deepEqual(request, { headers: { 'anthropic-version': '2026-10-21' }, providerMetadata: { anthropic: { max_tokens: 128000 } } });
    const nativeTool = { type: 'web_fetch_20260318', name: 'web_fetch', response_inclusion: 'excluded', future_tool_setting: null };
    const future = { flags: [null, false, 0], shape: {} };
    const agent = withAgentProviderOptions({ id: model }, { 'anthropic-version': '2023-06-01', 'anthropic-beta': 'custom-beta',
      max_tokens: 512, tools: [nativeTool], budget: future });
    assert.deepEqual(agent.providerHeaders, { 'anthropic-version': '2023-06-01', 'anthropic-beta': 'custom-beta' });
    assert.deepEqual(agent.providerMetadata, { max_tokens: 512, tools: [nativeTool], budget: future });
    const edited = agentProviderRequest(agent);
    const requests = [];
    const fetcher = async (_url, init) => {
      const body = JSON.parse(init.body);
      requests.push({ body, version: init.headers.get('anthropic-version'), beta: init.headers.get('anthropic-beta') });
      return response(messagesApi, body.model);
    };
    const client = direct ? createDirectChat(providers, id => keys[id], fetcher) : createGateway(root, () => ({}), fetcher);
    for (const settings of [request, edited]) {
      const chunks = await send(client.chatTransport(messagesApi), model, { headers: settings.headers,
        body: { model, providerMetadata: settings.providerMetadata } });
      assert.deepEqual(chunks.filter(chunk => chunk.type === 'error'), []);
    }
    assert.equal(requests[0].version, '2026-10-21');
    assert.equal(requests[0].body.max_tokens, 128000);
    assert.equal(requests[1].version, '2023-06-01');
    assert.equal(requests[1].beta, 'custom-beta');
    assert.equal(requests[1].body.max_tokens, 512);
    assert.deepEqual(requests[1].body.tools, [nativeTool]);
    assert.deepEqual(requests[1].body.budget, future);
    assert.equal(requests[1].body.providerMetadata, undefined);
  });

  test(`${direct ? 'Direct' : 'Gateway'} Anthropic Messages replays Local Tool search as native references`, async () => {
    const model = 'anthropic/claude-sonnet-4-6';
    const inputSchema = { type: 'object', properties: {} };
    const tools = [{ name: 'client_tool_search', inputSchema }, { name: 'lookup', inputSchema, defer_loading: true }, { name: 'eager', inputSchema }];
    const tool = { type: 'dynamic-tool', toolName: 'client_tool_search', toolCallId: 'toolu_search', input: { goal: 'inventory' }, state: 'output-available',
      output: { content: [], structuredContent: { selectedTools: [{ name: 'lookup' }, { name: 'lookup' }, { name: 'unknown' }, { name: 'eager' }] } } };
    let sent;
    const fetcher = async (_url, init) => {
      sent = { body: JSON.parse(init.body), beta: init.headers.get('anthropic-beta') };
      return response(messagesApi, sent.body.model);
    };
    const client = direct ? createDirectChat(providers, id => keys[id], fetcher) : createGateway(root, () => ({}), fetcher);
    const replay = [messages[0], { id: 'search', role: 'assistant', parts: [tool] }, messages[2]];
    const chunks = await send(client.chatTransport(messagesApi), model, { body: { model, tools }, messages: replay });
    assert.deepEqual(chunks.filter(chunk => chunk.type === 'error'), []);
    assert.equal(sent.beta, 'advanced-tool-use-2025-11-20');
    assert.equal(sent.body.tools.find(tool => tool.name === 'client_tool_search').defer_loading, undefined);
    assert.equal(sent.body.tools.find(tool => tool.name === 'lookup').defer_loading, true);
    const blocks = sent.body.messages.flatMap(message => message.content);
    assert.equal(blocks.find(block => block.type === 'tool_use').name, 'client_tool_search');
    assert.deepEqual(blocks.find(block => block.type === 'tool_result').content, [{ type: 'tool_reference', tool_name: 'lookup' }]);
  });
}

for (const direct of [false, true]) {
  test(`${direct ? 'Direct' : 'Gateway'} Responses merges hosted search and replays both native items`, async () => {
    const requests = [];
    const model = 'openai/gpt-6-luna';
    const history = [messages[0]];
    const namespace = { id: 'inventory', name: 'inventory' };
    const inputSchema = { type: 'object', properties: {} };
    const lookup = { type: 'function', name: 'lookup', parameters: inputSchema, defer_loading: true };
    const search = { type: 'tool_search', execution: 'server' };
    const loaded = { type: 'namespace', name: 'inventory', description: 'Inventory tools', tools: [lookup] };
    const call = { type: 'tool_search_call', id: 'tsc_1', status: 'completed', call_id: null, execution: 'server', arguments: { paths: ['inventory'] } };
    const output = { type: 'tool_search_output', id: 'tso_1', status: 'completed', call_id: null, execution: 'server', tools: [loaded] };
    const fetcher = async (_url, init) => {
      const body = JSON.parse(init.body);
      requests.push(body);
      if (requests.length !== 1) return response(responses, body.model);
      const envelope = { id: 'r1', created_at: 1, model: body.model, usage: { input_tokens: 5, output_tokens: 2, total_tokens: 7 } };
      return sse([{ type: 'response.created', response: envelope }, ...[call, output].flatMap((item, output_index) => [
        { type: 'response.output_item.added', output_index, item: { ...item, status: 'in_progress' } },
        { type: 'response.output_item.done', output_index, item },
      ]), { type: 'response.completed', response: { ...envelope, output: [call, output] } }]);
    };
    const client = direct ? createDirectChat(providers, id => keys[id], fetcher) : createGateway(root, () => ({}), fetcher);
    const body = { model, tools: [{ name: 'lookup', inputSchema, namespace, defer_loading: true }, { name: 'eager', inputSchema }],
      providerMetadata: { openai: { tools: [search], reasoning: { effort: 'medium', summary: 'auto' }, include: ['reasoning.encrypted_content'],
        store: true, previous_response_id: 'never', model: 'never' } } };
    const stream = await client.chatTransport(responses).sendMessages({ chatId: 'conversation', messages: history, body, trigger: 'submit-message' });
    const reply = (await Array.fromAsync(readUIMessageStream({ stream, terminateOnError: true }))).at(-1);
    const part = reply.parts.find(part => part.toolName === 'tool_search' || part.type === 'tool-tool_search');
    assert.equal(part?.state, 'output-available');
    assert.equal(part.providerExecuted, true);
    assert.deepEqual(part.output, { tools: [loaded] });
    assert.equal(requests[0].model, direct ? 'gpt-6-luna' : model);
    assert.deepEqual(requests[0].reasoning, { effort: 'medium', summary: 'auto' });
    assert.deepEqual(requests[0].tools.filter(tool => tool.type === 'tool_search'), [search]);
    assert.equal(requests[0].tools.find(tool => tool.type === 'namespace').tools[0].defer_loading, true);
    assert.equal(requests[0].tools.find(tool => tool.name === 'eager').defer_loading, undefined);
    const chunks = await send(client.chatTransport(responses), model, { body, messages: [...history, JSON.parse(JSON.stringify(reply)), messages[2]] });
    assert.deepEqual(chunks.filter(chunk => chunk.type === 'error'), []);
    for (const request of requests) {
      assert.equal(request.store, false);
      assert.equal(request.previous_response_id, undefined);
      assert.ok(request.input.every(item => item.type !== 'item_reference'));
    }
    assert.deepEqual(requests[1].input.filter(item => item.type?.startsWith('tool_search')), [call, output]);
  });

  test(`${direct ? 'Direct' : 'Gateway'} Responses continues client search with only the selected deferred tools`, async () => {
    const requests = [];
    const model = 'openai/gpt-6-luna';
    const route = { mode: direct ? 'direct' : 'gateway', endpoint: responses };
    const scope = { id: 'inventory', name: 'inventory' };
    const tools = [{ name: 'lookup', defer_loading: true, namespace: scope, inputSchema: { type: 'object' } },
      { name: 'eager', inputSchema: { type: 'object' } }];
    const body = { model, tools, providerMetadata: { openai: { tools: [{ type: 'tool_search', execution: 'client',
      description: 'Search the catalog', parameters: { type: 'object', properties: { goal: { type: 'string' } } } }] } } };
    const call = { type: 'tool_search_call', id: 'tsc_client', call_id: 'call_search', execution: 'client', status: 'completed', arguments: { goal: 'stock levels' } };
    const fetcher = async (_url, init) => {
      const request = JSON.parse(init.body);
      requests.push(request);
      if (requests.length !== 1) return response(responses, request.model);
      const envelope = { id: 'r1', created_at: 1, model: request.model, usage: { input_tokens: 5, output_tokens: 2, total_tokens: 7 } };
      return sse([{ type: 'response.created', response: envelope },
        { type: 'response.output_item.added', output_index: 0, item: { ...call, status: 'in_progress' } },
        { type: 'response.output_item.done', output_index: 0, item: call },
        { type: 'response.completed', response: { ...envelope, output: [call] } }]);
    };
    const client = direct ? createDirectChat(providers, id => keys[id], fetcher) : createGateway(root, () => ({}), fetcher);
    const stream = await client.chatTransport(responses).sendMessages({ chatId: 'conversation', messages: [messages[0]], body, trigger: 'submit-message' });
    const reply = (await Array.fromAsync(readUIMessageStream({ stream, terminateOnError: true }))).at(-1);
    const part = reply.parts.find(part => part.toolName === 'tool_search' || part.type === 'tool-tool_search');
    assert.equal(part?.state, 'input-available');
    assert.ok(!part.providerExecuted);
    assert.ok(isClientToolSearch(part.input, part.toolCallId, part.callProviderMetadata));
    assert.deepEqual(requests[0].tools.map(tool => tool.type === 'function' ? tool.name : tool.type), ['eager', 'tool_search']);
    const transport = { async sendMessages({ messages, body }) {
      assert.equal(body.tools, undefined);
      const input = JSON.parse(messages.at(-1).parts[0].text);
      assert.equal(input.goal, 'stock levels');
      assert.deepEqual(input.catalog.map(tool => tool.name), ['lookup']);
      return new ReadableStream({ start(controller) {
        controller.enqueue({ type: 'text-delta', delta: '{"selectedToolNames":["not_in_catalog","lookup","lookup","eager"]}' });
        controller.enqueue({ type: 'finish', finishReason: 'stop' });
        controller.close();
      } });
    } };
    const output = await searchClientTools({ model, instructions: 'Select tools', context: {}, transport }, part.input, tools, route, model, new AbortController().signal);
    assert.deepEqual(output.tools[0].tools.map(tool => tool.name), ['lookup']);
    Object.assign(part, { state: 'output-available', output });
    const chunks = await send(client.chatTransport(responses), model, { body, messages: [messages[0], JSON.parse(JSON.stringify(reply))] });
    assert.deepEqual(chunks.filter(chunk => chunk.type === 'error'), []);
    assert.deepEqual(requests[1].input.filter(item => item.type?.startsWith('tool_search')), [call,
      { type: 'tool_search_output', execution: 'client', call_id: 'call_search', status: 'completed', tools: JSON.parse(JSON.stringify(output.tools)) }]);
  });
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
    const instructions = [JSON.stringify({ skills: [{ name: 'notes', skill_id: 'openai/notes', description: 'Summarize notes.' }] }),
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
      return Response.json({ data: [{ id: 'gpt-4.1-mini', created: 1700000000 }, { id: 'gpt-image-1' }] });
    }
    if (url === 'https://openrouter.ai/api/v1/models') {
      assert.equal(init.headers.get('authorization'), 'Bearer openrouter-key');
      return Response.json({ data: [{ id: 'vendor/model', architecture: { output_modalities: ['text'] } }, { id: 'vendor/image' }] });
    }
    assert.equal(init.headers.get('x-api-key'), 'anthropic-key');
    assert.equal(init.headers.get('authorization'), null);
    if (url === 'https://api.anthropic.com/v1/models') return Response.json({ data: [{ id: 'claude-one', type: 'model' }], has_more: true, last_id: 'id & suffix' });
    assert.equal(url, 'https://api.anthropic.com/v1/models?after_id=id%20%26%20suffix');
    return Response.json({ data: [{ id: 'claude-two', type: 'model', created_at: '2025-01-01T00:00:00Z' }], has_more: false });
  });
  assert.deepEqual(direct.endpoints(), [...nativeChatEndpoints]);
  assert.deepEqual((await direct.listModelCatalog()).map(({ id, created }) => [id, created]),
    [['anthropic/claude-one', undefined], ['anthropic/claude-two', 1735689600], ['openai/gpt-4.1-mini', 1700000000], ['openrouter/vendor/model', undefined]]);
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
    body: { model, tools: [{ name: 'lookup', inputSchema: { type: 'object' } }], toolChoice: 'none' },
  });
  assert.equal(request.tools[0].name, 'lookup');
  assert.equal(request.tool_choice, 'none');
  assert.ok(request.input.some(item => item.type === 'function_call' && item.call_id === 'call_1'));
  assert.ok(request.input.some(item => item.type === 'function_call_output' && item.call_id === 'call_1' && item.output === 'fixture result'));
  assert.match(parts.find(part => part.type === 'error').errorText, /gateway denied access/);
  assert.doesNotMatch(JSON.stringify(parts), /private-upstream/);
});

test('native gateway returns a readable error part for structured HTTP and SSE failures', async () => {
  const model = 'openai/gpt-4.1-mini';
  const message = 'Unsupported parameter: reasoning.effort is not supported with this model.';
  const failed = { type: 'response.failed', sequence_number: 2, response: { error: { code: 'invalid_request_error', message } } };
  for (const [endpoint, upstream] of [
    [responses, Response.json({ error: { message } }, { status: 400 })],
    [responses, sse([failed])],
    [responses, sse([{ type: 'error', sequence_number: 1, code: 'upstream_error', message }])],
    [chat, sse([{ error: { type: 'api_error', message } }, '[DONE]'])],
    [messagesApi, sse([{ type: 'error', error: { type: 'api_error', message } }])],
  ]) {
    const gateway = createGateway(root, () => ({}), async () => upstream);
    const parts = await send(gateway.chatTransport(endpoint), endpoint === messagesApi ? 'anthropic/claude-sonnet-4-6' : model);
    assert.equal(parts.find(part => part.type === 'error')?.errorText, message, endpoint);
  }
});

for (const endpoint of nativeChatEndpoints) test(`Direct ${endpoint} translates the tool choice to the native protocol`, async () => {
  const model = endpoint === messagesApi ? 'anthropic/claude-sonnet-4-6' : 'openai/gpt-4.1-mini';
  const requests = [];
  const direct = createDirectChat(providers, id => keys[id], async (_url, init) => {
    const body = JSON.parse(init.body);
    requests.push(body);
    return response(endpoint, body.model);
  });
  const transport = direct.chatTransport(endpoint);
  const tools = [{ name: 'lookup', inputSchema: { type: 'object' } }];
  for (const toolChoice of ['required', 'none']) await send(transport, model, { body: { model, tools, toolChoice } });
  if (endpoint === messagesApi) {
    assert.equal(requests[0].tool_choice.type, 'any');
    assert.ok(requests[1].tool_choice?.type === 'none' || !requests[1].tools?.length);
  } else {
    assert.equal(requests[0].tool_choice, 'required');
    assert.equal(requests[1].tool_choice, 'none');
  }
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
