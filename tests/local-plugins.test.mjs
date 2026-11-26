import assert from 'node:assert/strict';
import test from 'node:test';
import { activeChatTools, filterLocalToolReplay, runLocalTool } from '../packages/chat/src/localPlugins.ts';
import { defaultChatPreferences, normalizeChatPreferences } from '../packages/chat/src/chatPreferences.ts';
import { buildRequestContext, withRequestContext } from '../packages/chat/src/chatContext.ts';
import { createConversationSearch } from '../packages/chat/src/conversationSearch.ts';

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

test('local plugins are opt-in and history-scoped on Gateway and all three Direct routes', () => {
  const mcp = { name: 'mcp_fixture_lookup', description: 'Fixture lookup', inputSchema: { type: 'object' },
    remoteName: 'lookup', server: { id: 'fixture', title: 'Fixture', path: '/fixture', provider: 'openai' } };
  for (const route of [gateway, direct, { ...direct, endpoint: '/v1/messages' }, { ...direct, endpoint: '/v1/chat/completions' }]) {
    assert.deepEqual(activeChatTools(route, [], true, []), []);
    assert.deepEqual(activeChatTools(route, selected, false, []), tools.filter(tool => !tool.plugin.requiresHistory));
    assert.deepEqual(activeChatTools(route, selected, true, [mcp]), [...tools, { source: 'mcp', tool: mcp, definition: mcp }]);
  }
  assert.deepEqual(normalizeChatPreferences({ delay: 496, plugins: [...selected, selected[0], 'unregistered'] }),
    { ...defaultChatPreferences, delay: 500, plugins: selected });
  assert.deepEqual(normalizeChatPreferences({ delay: -1, plugins: null, convertAttachmentsToText: true,
    remoteSkillIds: ['openai/skill_1', false, '  ', 'openai/skill_1', 'anthropic/skill_2'] }),
    { ...defaultChatPreferences, delay: 0, remoteSkillIds: ['openai/skill_1', 'anthropic/skill_2'], convertAttachmentsToText: true });
});

test('preferences only restore supported sidebar pins', () => {
  assert.deepEqual(normalizeChatPreferences({ pinnedViews: ['providers', 'chat', 'providers', 'models', 'skills', false] }).pinnedViews,
    ['models', 'providers']);
  assert.deepEqual(normalizeChatPreferences({ pinnedViews: 'models' }).pinnedViews, []);
});

test('catalog handlers search provider and model metadata, preserve filters, and reject invalid calls', async () => {
  const catalog = [
    { id: 'openai/test', name: 'Résumé Chat', type: 'language', provider: 'openai', tags: ['tools'], description: 'Extract key points from reports.' },
    { id: 'openai/image', name: 'Test Image', type: 'image', provider: 'openai', tags: [] },
    { id: 'unknown/vector', name: 'Vector', type: 'embedding', provider: 'unknown', tags: [] },
  ];
  const call = (name, args) => runLocalTool(tools.find(tool => tool.definition.name === name), args, { catalog, history: [] });
  const listed = await call('local_ai_providers_list', { country: 'us', inferenceRegion: 'world' });
  assert.deepEqual(listed.structuredContent.items.map(item => item.key), ['openai']);
  const searchProviders = args => call('local_ai_providers_search', args).then(hit => hit.structuredContent);
  assert.deepEqual(await searchProviders({ query: 'valuab OpenAI', country: 'US', inferenceRegion: 'World', limit: 1 }), listed.structuredContent);
  assert.equal((await searchProviders({ query: 'valuab OpenAI', country: 'NL' })).total, 0);
  assert.equal((await searchProviders({ query: 'anthropic' })).total, 0); // Directory-only providers are not returned.
  assert.equal((await searchProviders({ query: 'unk' })).items[0].key, 'unknown');
  assert.deepEqual((await call('local_ai_provider_countries_list', {})).structuredContent.items, [{ code: 'US', providerCount: 1 }]);
  const searchModels = args => call('local_ai_models_search', { limit: 1, ...args }).then(hit => hit.structuredContent.data);
  assert.deepEqual(await searchModels({ query: 'resum, extract TOOLS', provider: 'OpenAI', type: 'language' }), [catalog[0]]);
  assert.deepEqual(await searchModels({ query: 'resum extract', type: 'image' }), []);
  assert.deepEqual(await searchModels({ query: 'openai', type: 'image' }), [catalog[1]]);
  assert.deepEqual(await searchModels({ query: '---' }), []);
  assert.deepEqual(await searchModels({ query: '', provider: 'OpenAI', type: 'image' }), [catalog[1]]);
  assert.deepEqual((await call('local_ai_models_list_by_provider', { provider: 'OpenAI', type: 'image' })).structuredContent.data, [catalog[1]]);
  assert.equal((await call('local_ai_models_search', { query: 'Test' })).isError, true);
  assert.equal((await call('local_ai_providers_list', { inferenceRegion: 'elsewhere' })).isError, true);
});

test('Chat History tool matches indexed transcript parts and get excludes all non-transcript content', async () => {
  const history = [{ id: 'visible', metadata: { updatedAt: '2026-10-01', internal: 'hidden metadata' }, messages: [
    { id: 'sys', role: 'system', parts: [{ type: 'text', text: 'hidden system message' }] },
    { id: 'user', role: 'user', parts: [{ type: 'text', text: 'A café, juniper, and a cedar bench.' }, { type: 'file', url: 'hidden attachment' },
      { type: 'text', text: 'hidden converted attachment', providerMetadata: { streaik: { attachmentName: 'attached.txt' } } }] },
    { id: 'assistant', role: 'assistant', parts: [{ type: 'text', text: 'Cedar' }, { type: 'text', text: 'Juniper' },
      { type: 'reasoning', text: 'hidden reasoning' }, { type: 'dynamic-tool', output: 'hidden tool result' }] },
  ] }];
  const index = createConversationSearch();
  const call = (name, args) => runLocalTool(tools.find(tool => tool.definition.name === `local_conversations_${name}`), args, {
    catalog: [], history, searchConversationText: (term, limit) => index.searchText(history, term, limit),
  });
  assert.deepEqual((await call('list_all', {})).structuredContent.conversations.map(record => record.id), ['visible']);
  const search = (query, limit) => call('search_text', { query, ...(limit && { limit }) }).then(hit => hit.structuredContent);
  const searches = await search('CED, junip');
  assert.equal(searches.total, 1);
  assert.deepEqual(searches.results[0], { conversationId: 'visible', conversationName: 'A café, juniper, and a cedar bench.',
    messageId: 'user', messageIndex: 1, role: 'user', partIndex: 0, matchIndex: 8, snippet: 'A café, juniper, and a cedar bench.' });
  assert.equal((await search('CAFE')).results[0].matchIndex, 2);
  assert.equal((await search('hidden')).total, 0);
  assert.equal((await search('---')).total, 0);
  assert.equal((await search('edar')).total, 0);
  const capped = await search('cedar', 1);
  assert.equal(capped.total, 2);
  assert.equal(capped.results.length, 1);
  assert.equal((await search('cedar', 100)).limit, 50);
  const got = await call('get_conversation', { conversationId: 'visible' });
  assert.equal(got.structuredContent.messages.length, 2);
  assert.doesNotMatch(JSON.stringify(got), /hidden|attachment|reasoning|dynamic-tool/);
  assert.equal((await call('get_conversation', { conversationId: 'a different profile' })).isError, true);
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
  assert.equal(requested.length, 1);
  const directDefinitions = activeChatTools(direct, selected, true, []).map(tool => tool.definition);
  assert.deepEqual(filterLocalToolReplay(messages, directDefinitions, false)[0].parts, [mcpPart, localPart]);
  assert.deepEqual(filterLocalToolReplay(messages, [], false)[0].parts, [mcpPart]);
  const filtered = filterLocalToolReplay(messages, []);
  assert.deepEqual(filtered, []);
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
  const serverResult = { ...base, toolCallId: 'hosted', providerExecuted: true, state: 'output-available', output: 'provider result' };
  const messages = [{ id: 'assistant', role: 'assistant', parts: [approved, declined, abandoned, legacyProviderApproval, serverResult] }];
  assert.deepEqual(filterLocalToolReplay(messages, [])[0].parts, [approved, declined, serverResult]);
  const native = filterLocalToolReplay(messages, [], false)[0].parts;
  assert.deepEqual(native.map(part => part.state), ['output-available', 'output-available', 'output-available']);
  assert.deepEqual(native.map(part => part.output), [{ result: 'approved' }, 'The user declined to share this tool result.', 'provider result']);
  assert.doesNotMatch(JSON.stringify(native), /signed-|three|old-provider/);
});
