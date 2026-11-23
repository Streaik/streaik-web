import assert from 'node:assert/strict';
import test from 'node:test';
import { activeChatTools, filterLocalToolReplay, runLocalTool } from '../packages/chat/src/localPlugins.ts';
import { normalizeChatPreferences } from '../packages/chat/src/chatPreferences.ts';
import { buildRequestContext, withRequestContext } from '../packages/chat/src/chatContext.ts';

const gateway = { mode: 'gateway', endpoint: '/api/chat' };
const direct = { mode: 'direct', endpoint: '/v1/responses' };
const selected = ['local-artificial-intelligence', 'local-conversations'];
const tools = activeChatTools(gateway, selected, true, []);

test('the eight local tools preserve AIHappey names, types, required parameters, and region enum', () => {
  const contract = Object.fromEntries(tools.map(({ definition: { name, inputSchema: { type, properties, required } } }) => {
    assert.equal(type, 'object');
    return [name, [Object.fromEntries(Object.entries(properties).map(([key, value]) => [key, value.type])), required ?? null]];
  }));
  assert.deepEqual(contract, {
    local_ai_providers_list: [{ country: 'string', inferenceRegion: 'string', limit: 'integer' }, []],
    local_ai_provider_countries_list: [{}, []],
    local_ai_providers_search: [{ query: 'string', country: 'string', inferenceRegion: 'string', limit: 'integer' }, ['query']],
    local_ai_models_search: [{ query: 'string', provider: 'string', type: 'string', limit: 'integer' }, ['query', 'limit']],
    local_ai_models_list_by_provider: [{ provider: 'string', type: 'string', limit: 'integer' }, ['provider']],
    local_conversations_list_all: [{}, null],
    local_conversations_search_text: [{ query: 'string', limit: 'number' }, ['query']],
    local_conversations_get_conversation: [{ conversationId: 'string' }, ['conversationId']],
  });
  assert.deepEqual(tools[0].definition.inputSchema.properties.inferenceRegion.enum,
    ['World', 'Europe', 'Americas', 'Asia', 'Africa', 'Oceania']);
});

test('tools are opt-in, scoped, and Gateway-only; Direct and Gateway keep existing MCP registrations', () => {
  const mcp = { name: 'mcp_fixture_lookup', description: 'Fixture lookup', inputSchema: { type: 'object' },
    remoteName: 'lookup', server: { id: 'fixture', title: 'Fixture', path: '/fixture', provider: 'openai' } };
  assert.deepEqual(activeChatTools(gateway, [], true, []).map(tool => tool.definition.name), []);
  assert.equal(activeChatTools(gateway, selected, false, []).length, 5);
  assert.equal(activeChatTools(gateway, selected, true, [mcp]).length, 9);
  assert.deepEqual(activeChatTools(direct, selected, true, [mcp]), [{ source: 'mcp', tool: mcp, definition: mcp }]);
  assert.deepEqual(normalizeChatPreferences({ delay: 496, plugins: [...selected, selected[0], 'unregistered'] }),
    { delay: 500, plugins: selected, remoteSkillIds: [], convertAttachmentsToText: false });
  assert.deepEqual(normalizeChatPreferences({ delay: -1, plugins: null, convertAttachmentsToText: true,
    remoteSkillIds: ['openai/skill_1', false, '  ', 'openai/skill_1', 'anthropic/skill_2'] }),
    { delay: 0, plugins: [], remoteSkillIds: ['openai/skill_1', 'anthropic/skill_2'], convertAttachmentsToText: true });
});

test('catalog handlers expose Gateway providers and capabilities, and reject invalid calls', () => {
  const catalog = [
    { id: 'openai/test', name: 'Test Chat', type: 'language', provider: 'openai', tags: ['tools'] },
    { id: 'openai/image', name: 'Test Image', type: 'image', provider: 'openai', tags: [] },
    { id: 'unknown/vector', name: 'Vector', type: 'embedding', provider: 'unknown', tags: [] },
  ];
  const call = (name, args) => runLocalTool(tools.find(tool => tool.definition.name === name), args, { catalog, history: [] });
  const listed = call('local_ai_providers_list', { country: 'us', inferenceRegion: 'world' });
  assert.deepEqual(listed.structuredContent.items.map(item => item.key), ['openai']);
  assert.deepEqual(call('local_ai_provider_countries_list', {}).structuredContent.items, [{ code: 'US', providerCount: 1 }]);
  assert.deepEqual(call('local_ai_models_search', { query: 'TOOLS', limit: 1 }).structuredContent.data, [catalog[0]]);
  assert.deepEqual(call('local_ai_models_list_by_provider', { provider: 'OpenAI', type: 'image' }).structuredContent.data, [catalog[1]]);
  assert.equal(call('local_ai_models_search', { query: 'Test' }).isError, true);
  assert.equal(call('local_ai_providers_list', { inferenceRegion: 'elsewhere' }).isError, true);
});

test('Chat History search matches text parts only and get excludes all non-transcript content', () => {
  const history = [{ id: 'visible', metadata: { updatedAt: '2026-10-01', internal: 'hidden metadata' }, messages: [
    { id: 'sys', role: 'system', parts: [{ type: 'text', text: 'hidden system message' }] },
    { id: 'user', role: 'user', parts: [{ type: 'text', text: 'Juniper, and a cedar bench.' }, { type: 'file', url: 'hidden attachment' }] },
    { id: 'assistant', role: 'assistant', parts: [{ type: 'text', text: 'Cedar' }, { type: 'text', text: 'Juniper' },
      { type: 'reasoning', text: 'hidden reasoning' }, { type: 'dynamic-tool', output: 'hidden tool result' }] },
  ] }];
  const call = (name, args) => runLocalTool(tools.find(tool => tool.definition.name === `local_conversations_${name}`), args, { catalog: [], history });
  assert.deepEqual(call('list_all', {}).structuredContent.conversations.map(record => record.id), ['visible']);
  const searches = call('search_text', { query: 'CEDAR Juniper' }).structuredContent;
  assert.equal(searches.total, 1);
  assert.equal(searches.results[0].snippet, 'Juniper, and a cedar bench.');
  assert.equal(call('search_text', { query: 'hidden' }).structuredContent.total, 0);
  const got = call('get_conversation', { conversationId: 'visible' });
  assert.equal(got.structuredContent.messages.length, 2);
  assert.doesNotMatch(JSON.stringify(got), /hidden|attachment|reasoning|dynamic-tool/);
  assert.equal(call('get_conversation', { conversationId: 'a different profile' }).isError, true);
});

test('context is request-only and disabled local results do not leak through replay', () => {
  const context = buildRequestContext('Streak', 'nl', true);
  const mcpPart = { type: 'dynamic-tool', toolCallId: 'mcp', toolName: 'mcp_fixture_lookup', state: 'output-available', output: 'legacy text' };
  const localPart = { type: 'tool-local_conversations_get_conversation', toolCallId: 'local', state: 'output-available', output: 'local-private-text' };
  const pending = { type: 'dynamic-tool', toolCallId: 'pending', toolName: 'local_conversations_search_text', state: 'input-available' };
  const messages = [{ id: 'answer', role: 'assistant', parts: [mcpPart, localPart, pending] }];
  const requested = withRequestContext(filterLocalToolReplay(messages, tools.map(tool => tool.definition)), context);
  assert.equal(requested[0].role, 'system');
  assert.deepEqual(requested[0].parts.map(part => JSON.parse(part.text)), [context.system, context.user]);
  assert.deepEqual(requested[1].parts, [mcpPart, localPart]);
  const filtered = filterLocalToolReplay(messages, []);
  assert.deepEqual(filtered[0].parts, [mcpPart]);
  assert.equal(messages[0].parts.length, 3);
});

test('approved and declined client results replay with signatures only on API chat', () => {
  const base = { type: 'dynamic-tool', toolName: 'mcp_lookup', input: { term: 'query' } };
  const approved = { ...base, toolCallId: 'one', state: 'output-available', output: { result: 'approved' },
    approval: { id: 'first', signature: 'signed-first', approved: true } };
  const declined = { ...base, toolCallId: 'two', state: 'approval-responded', approval: { id: 'second', signature: 'signed-second', approved: false } };
  const abandoned = { ...base, toolCallId: 'three', state: 'approval-requested', approval: { id: 'third', signature: 'signed-third' } };
  const legacyProviderApproval = { ...base, toolCallId: 'old-provider', providerExecuted: true, state: 'approval-responded',
    approval: { id: 'old', signature: 'signed-old', approved: true } };
  const messages = [{ id: 'assistant', role: 'assistant', parts: [approved, declined, abandoned, legacyProviderApproval] }];
  assert.deepEqual(filterLocalToolReplay(messages, [])[0].parts, [approved, declined]);
  const native = filterLocalToolReplay(messages, [], false)[0].parts;
  assert.deepEqual(native.map(part => part.state), ['output-available', 'output-available']);
  assert.deepEqual(native.map(part => part.output), [{ result: 'approved' }, 'The user declined to share this tool result.']);
  assert.doesNotMatch(JSON.stringify(native), /signed-|three|old-provider/);
});
