import assert from 'node:assert/strict';
import test from 'node:test';
import { createAgentBackend, gatewayChatEndpoints } from '../packages/gateway/src/index.ts';
import { browserAgentModel, resolveAgentChatRoute } from '../packages/chat/src/agentChat.ts';
import { agentProviderHeaders } from '../samples/byok/src/providerKeys.ts';

const base = new URL('https://agent.example.invalid/tenant/');
const modelId = 'openai/gpt-6-luna';
const definition = { name: 'Greeting', description: 'Greets', instructions: 'Say hello', model: { id: modelId } };
const message = { id: 'm1', role: 'user', parts: [{ type: 'text', text: 'Hi' }] };
const sse = (...events) => new Response(events.map(event => `data: ${JSON.stringify(event)}\n\n`).join('') + 'data: [DONE]\n\n', {
  headers: { 'content-type': 'text/event-stream', 'x-vercel-ai-ui-message-stream': 'v1' },
});
const read = async stream => sseText(await Array.fromAsync(stream));
const sseText = chunks => chunks.filter(chunk => chunk.type === 'text-delta').map(chunk => chunk.delta).join('');

test('agent routes default to hosted API Chat, then Gateway, then available Direct', () => {
  assert.deepEqual(resolveAgentChatRoute(undefined, true, true, ['/v1/messages']), { mode: 'agents', endpoint: '/api/chat' });
  assert.deepEqual(resolveAgentChatRoute(undefined, false, true, ['/v1/messages']), { mode: 'gateway', endpoint: '/api/chat' });
  assert.deepEqual(resolveAgentChatRoute(undefined, false, false, ['/v1/messages']), { mode: 'direct', endpoint: '/v1/messages' });
  const explicit = { mode: 'gateway', endpoint: '/v1/responses' };
  assert.equal(resolveAgentChatRoute(explicit, true, true, []), explicit);
  assert.equal(resolveAgentChatRoute(undefined, false, false, []), undefined);
});

test('browser fallback chooses a compatible agent model without replacing explicit configuration', () => {
  const compatible = [{ id: 'anthropic/example', provider: 'anthropic' }];
  assert.equal(browserAgentModel(definition, compatible), undefined);
  assert.equal(browserAgentModel({ ...definition, models: [definition.model, { id: compatible[0].id }] }, compatible), compatible[0]);
  assert.equal(browserAgentModel({ ...definition, model: undefined }, compatible), compatible[0]);
});

test('hosted catalog and API Chat scope credentials and serialize only the selected definition and transcript', async () => {
  const requests = [];
  const backend = createAgentBackend(base, request => request.kind === 'catalog' ? {}
    : agentProviderHeaders({ openai: 'selected-provider-key', anthropic: 'unrelated-provider-key' }, request.modelIds), async (url, init) => {
    requests.push(url);
    assert.equal(init.redirect, 'error');
    assert.equal(init.credentials, 'omit');
    assert.equal(init.headers.get('x-anthropic-key'), null);
    assert.equal(init.headers.get('authorization'), null);
    if (url.endsWith('/v1/models')) {
      assert.equal(init.headers.get('x-openai-key'), null);
      return Response.json({ data: [{ id: 'catalog/greeter', name: 'Greeting' }, { id: '..' }, { id: 'catalog/greeter' }] });
    }
    if (url.endsWith('/v1/models/catalog%2Fgreeter')) {
      assert.equal(init.headers.get('x-openai-key'), null);
      return Response.json({ agent: definition });
    }
    assert.equal(url, `${base.href}api/chat`);
    assert.equal(init.headers.get('x-openai-key'), 'selected-provider-key');
    assert.deepEqual(JSON.parse(init.body), { agent: definition, messages: [message] });
    return sse({ type: 'start' }, { type: 'text-start', id: '1' }, { type: 'text-delta', id: '1', delta: 'Hello' }, { type: 'text-end', id: '1' }, { type: 'finish' });
  });
  const agents = await backend.listAgents();
  assert.deepEqual(agents.map(agent => agent.id), ['catalog/greeter']);
  assert.deepEqual(await backend.getAgent(agents[0].id), definition);
  const stream = await backend.chatTransport('/api/chat', { id: definition.name, definition, modelIds: [modelId] }).sendMessages({
    chatId: 'chat', trigger: 'submit-message', messages: [message], headers: { authorization: 'Bearer ignored' }, body: { model: 'ignored', tools: ['ignored'] },
  });
  assert.equal(await read(stream), 'Hello');
  assert.equal(requests.length, 3);
});

test('hosted native routes send native payloads to the agent backend, without replaying failed endpoints', async () => {
  for (const endpoint of gatewayChatEndpoints.slice(1)) {
    let count = 0;
    const backend = createAgentBackend(base, () => ({}), async (url, init) => {
      count++;
      assert.equal(url, `${base.href}${endpoint.slice(1)}`);
      const body = JSON.parse(init.body);
      assert.deepEqual(body.agent, definition);
      assert.ok(!('model' in body));
      assert.equal(body.stream, true);
      assert.ok(Array.isArray(endpoint === '/v1/responses' ? body.input : body.messages));
      return new Response(null, { status: 404 });
    });
    const stream = await backend.chatTransport(endpoint, { id: definition.name, definition, modelIds: [modelId] }).sendMessages({
      chatId: 'native', trigger: 'submit-message', messages: [message],
    });
    const chunks = await Array.fromAsync(stream);
    assert.equal(count, 1);
    assert.ok(chunks.some(chunk => chunk.type === 'error'));
  }
});
