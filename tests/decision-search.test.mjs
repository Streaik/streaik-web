import assert from 'node:assert/strict';
import test from 'node:test';
import { createGateway } from '../packages/gateway/src/index.ts';
import { searchModels } from '../packages/chat/src/searchSelection.ts';
import { searchClientTools, searchLocalToolCatalog } from '../packages/chat/src/clientToolSearch.ts';
import { searchClientResources } from '../packages/chat/src/clientResourceSearch.ts';

const id = 'openai/dual';
const decision = { id, type: 'decision' }, language = { id, type: 'language' };
const choices = [
  { name: 'lookup', description: 'Inventory', inputSchema: { type: 'object' }, defer_loading: true },
  { name: 'check', description: 'Stock counts', inputSchema: { type: 'object' }, defer_loading: true },
  { name: 'eager', description: 'Never a deferred result', inputSchema: { type: 'object' } },
];

test('search model variants survive catalog order, typed and untyped agent configuration', () => {
  for (const catalog of [[language, decision], [decision, language]]) {
    assert.deepEqual(searchModels([language], catalog, () => true), { language, decision: language });
    assert.deepEqual(searchModels([decision, language], catalog, () => true).decision, decision);
  }
  assert.deepEqual(searchModels([decision], [decision], () => true), { decision, language: undefined });
  assert.deepEqual(searchModels([language], [language, { ...decision, id: 'other/dual' }], () => true), { decision: undefined, language });
});

function fixture(endpoint, scores, status = 200) {
  const calls = [];
  const native = endpoint === '/v1/decisions';
  const gateway = createGateway(new URL('https://fixture.invalid/gateway/'), request => {
    assert.deepEqual(request, { kind: 'decision', provider: 'openai' });
    return { 'x-openai-key': 'fixture' };
  }, async (url, init) => {
    assert.equal(new URL(url).pathname, `/gateway${endpoint}`);
    assert.equal(new Headers(init.headers).get('x-openai-key'), 'fixture');
    const body = JSON.parse(init.body);
    calls.push(body);
    assert.equal(body.model, id);
    if (status !== 200) return new Response('private upstream details', { status });
    const ids = native ? body.questions.map(question => question.name) : Object.keys(body.questions);
    const answers = ids.map((name, i) => ({ name, type: native ? 'predicate' : 'boolean', probability: scores[i] }));
    return Response.json({ answers: native ? answers.reverse() : Object.fromEntries(answers.map(({ name, ...answer }) => [name, answer])) });
  });
  return { calls, agent: { decision: { model: id, endpoint, gateway, instructions: 'Match candidates to the goal.' } } };
}

for (const endpoint of ['/v1/decisions', '/api/decisions']) test(`${endpoint} ranks matches for native and generic tool search`, async () => {
  const { calls, agent } = fixture(endpoint, [.65, .95]);
  const signal = new AbortController().signal;
  const native = await searchClientTools(agent, { arguments: { goal: 'stock' } }, choices, { mode: 'gateway', endpoint: '/v1/responses' }, id, signal);
  assert.deepEqual(native.tools.map(tool => tool.name), ['check', 'lookup']);
  const generic = await searchLocalToolCatalog(agent, 'stock', choices, true, signal);
  assert.deepEqual(generic.map(tool => tool.name), ['check', 'lookup']);
  assert.equal(calls.length, 2);
  assert.doesNotMatch(JSON.stringify(calls), /eager|inputSchema/);
});

test('a valid empty decision succeeds; failed, malformed and cancelled decisions never retry', async () => {
  const signal = new AbortController().signal;
  assert.deepEqual(await searchLocalToolCatalog(fixture('/api/decisions', [.1, .5]).agent, 'Inventory', choices, true, signal), []);
  for (const { agent, calls } of [fixture('/api/decisions', [], 502), fixture('/api/decisions', [1])]) {
    await assert.rejects(searchLocalToolCatalog(agent, 'Inventory', choices, true, signal), /^Error: Decisions search could not be completed\.$/);
    assert.equal(calls.length, 1);
  }
  const aborted = fixture('/api/decisions', []);
  await assert.rejects(searchLocalToolCatalog(aborted.agent, 'Inventory', choices, true, AbortSignal.abort()), { name: 'AbortError' });
  assert.equal(aborted.calls.length, 0);
});

test('resource search selects assistant-visible resources and templates independently without a read', async () => {
  const { agent, calls } = fixture('/v1/decisions', [.9, .8]);
  const output = await searchClientResources(agent, { record: { id: 'inventory' }, discovery: {
    resources: [{ uri: 'fixture://guide', name: 'Guide' }, { uri: 'fixture://private', name: 'User only', annotations: { audience: ['user'] } }],
    resourceTemplates: [{ uriTemplate: 'fixture://template/{id}', name: 'Template' }],
  } }, 'manual', new AbortController().signal);
  assert.equal(output.serverId, 'inventory');
  assert.deepEqual(output.resources.map(item => item.uri), ['fixture://guide']);
  assert.deepEqual(output.resourceTemplates.map(item => item.uriTemplate), ['fixture://template/{id}']);
  assert.doesNotMatch(JSON.stringify(calls), /private/);
});
