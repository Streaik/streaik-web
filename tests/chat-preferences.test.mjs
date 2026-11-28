import assert from 'node:assert/strict';
import test from 'node:test';
import { defaultChatPreferences, loadChatPreferences, normalizeChatPreferences, saveChatPreferences } from '../packages/chat/src/chatPreferences.ts';
import { chatHostedMcp, withMcpHeaders } from '../packages/chat/src/chatModelContext.ts';
import { apiChatHostedMcp, withResponsesHostedMcp } from '../packages/gateway/src/hostedMcp.ts';
import { defaultMcpPreferences } from '../packages/chat/src/mcpPreferences.ts';
import { conversationCost, latestContextUsage, messageCost } from '../packages/chat/src/messageMetadata.ts';
import { filterToolOutputContent } from '../packages/chat/src/toolOutputContent.ts';
import { chatProviderRequest } from '../packages/chat/src/providerChat/settings.ts';
import { encryptedReasoningInclude, updateTypedItem } from '../packages/chat/src/providerChat/openai/options.ts';

test('old profiles get Chat defaults; only explicit, valid booleans override each preference', () => {
  const defaults = { text: true, links: true, images: false, audio: false, video: false, documents: false };
  assert.deepEqual(normalizeChatPreferences(null), defaultChatPreferences);
  const { dictate, showContextSize, showMessageTokens, showProviderLogo, showMetrics, showDecisions, toolOutput } = normalizeChatPreferences({ delay: 50 });
  assert.deepEqual({ dictate, showContextSize, showMessageTokens, showProviderLogo, showMetrics, showDecisions, toolOutput },
    { dictate: true, showContextSize: true, showMessageTokens: true, showProviderLogo: true, showMetrics: false, showDecisions: false, toolOutput: defaults });
  assert.equal(normalizeChatPreferences({ showDecisions: true }).showDecisions, true);
  assert.deepEqual(normalizeChatPreferences({ dictate: false, showContextSize: 'false', showMetrics: true, showDecisions: false,
    toolOutput: { text: false, links: 0, images: true, documents: 'true', extra: true } }),
  { ...defaultChatPreferences, dictate: false, showMetrics: true, showDecisions: false, toolOutput: { ...defaults, text: false, images: true } });
});

test('the reasoning level defaults to Medium and all four choices persist per profile', (t) => {
  const storage = new Map();
  const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  t.after(() => { if (original) Object.defineProperty(globalThis, 'localStorage', original); else delete globalThis.localStorage; });
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value),
  } });
  assert.equal(normalizeChatPreferences({ delay: 50 }).reasoning, 'medium');
  assert.equal(normalizeChatPreferences({ reasoning: 'invalid' }).reasoning, 'medium');
  assert.equal(loadChatPreferences('alpha').reasoning, 'medium');
  for (const reasoning of ['low', 'medium', 'high', 'none']) {
    saveChatPreferences('alpha', { ...defaultChatPreferences, reasoning });
    assert.equal(loadChatPreferences('alpha').reasoning, reasoning);
    assert.equal(loadChatPreferences('beta').reasoning, 'medium');
  }
});

test('MCP defaults are backward compatible and saved settings remain scoped and bounded', (t) => {
  const storage = new Map();
  const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  t.after(() => { if (original) Object.defineProperty(globalThis, 'localStorage', original); else delete globalThis.localStorage; });
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value),
  } });
  assert.deepEqual(normalizeChatPreferences({ delay: 50 }).mcp, defaultMcpPreferences);
  const mcp = { formElicitation: false, toolTimeoutMinutes: 19, resetTimeoutOnProgress: false };
  saveChatPreferences('alpha', { ...defaultChatPreferences, mcp });
  assert.deepEqual(loadChatPreferences('alpha').mcp, mcp);
  assert.deepEqual(loadChatPreferences('beta').mcp, defaultMcpPreferences);
  assert.equal(normalizeChatPreferences({ mcp: { toolTimeoutMinutes: 70 } }).mcp.toolTimeoutMinutes, 60);
  assert.equal(normalizeChatPreferences({ mcp: { toolTimeoutMinutes: 0 } }).mcp.toolTimeoutMinutes, 1);
  assert.equal(normalizeChatPreferences({ mcp: { toolTimeoutMinutes: 2.7 } }).mcp.toolTimeoutMinutes, 3);
  assert.deepEqual(normalizeChatPreferences({ mcp: { toolTimeoutMinutes: NaN, formElicitation: 'false' } }).mcp, defaultMcpPreferences);
});

test('hosted MCP normalizes per-server callers and deferral, and honors a saved Local search selection', () => {
  const eager = 'https://eager.example/mcp';
  const configured = 'https://configured.example/mcp';
  const inherited = 'https://inherited.example/mcp';
  const { modelContext } = normalizeChatPreferences({ modelContext: {
    execution: 'hosted', toolSearch: true, resourceSearch: true, servers: {
      [eager]: { allowedCallers: ['programmatic', 'unsupported', 'programmatic'], deferLoading: false },
      [configured]: { deferLoading: true },
      [inherited]: { allowedCallers: ['unsupported'], deferLoading: 'true' },
    },
  } });
  assert.deepEqual(modelContext.servers, { [eager]: { allowedCallers: ['programmatic'], deferLoading: false }, [configured]: { deferLoading: true } });
  const servers = [eager, configured, inherited].map((endpoint, index) => ({ record: { id: `mcp-${index}`, title: new URL(endpoint).hostname, endpoint } }));
  const descriptors = servers.map(({ record }) => ({ type: 'mcp', server_label: record.title, server_url: record.endpoint }));
  const first = { ...descriptors[0], allowed_callers: ['programmatic'] };
  const deferred = { ...descriptors[1], defer_loading: true };
  const resourceSearch = { type: 'resource_search' };
  assert.deepEqual(chatHostedMcp(modelContext, servers), [first, deferred, { ...descriptors[2], defer_loading: true },
    { type: 'tool_search' }, resourceSearch]);
  assert.deepEqual(chatHostedMcp({ ...modelContext, toolSearch: undefined }, servers), [first, deferred, descriptors[2], resourceSearch]);
  assert.deepEqual(chatHostedMcp(modelContext, servers, true), [first, ...descriptors.slice(1), resourceSearch]);
  assert.deepEqual(chatHostedMcp({ ...modelContext, execution: 'client' }, servers), []);
});

test('provider MCP survives preference normalization and sends only the MCP descriptor with its own wire headers', async () => {
  const endpoint = 'https://inventory.example/mcp';
  const source = { execution: 'provider', toolSearch: true, resourceSearch: true, servers: {
    [endpoint]: { allowedTools: ['lookup'], requireApproval: 'always', headers: { Authorization: 'must-not-be-persisted' } },
  } };
  const { modelContext } = normalizeChatPreferences({ modelContext: source });
  assert.equal(modelContext.execution, 'provider');
  assert.doesNotMatch(JSON.stringify(modelContext), /must-not-be-persisted/);
  const servers = [{ record: { id: 'rest_countries', title: 'GitHub RESTCountries.NET', registryName: 'net.streaik.mcp/rest-countries', endpoint } }];
  const tools = chatHostedMcp(modelContext, servers);
  const descriptor = { server_label: 'net_streaik_mcp_rest-countries', server_url: endpoint, execution: 'server', allowed_tools: ['lookup'], require_approval: 'always' };
  assert.deepEqual(tools, [{ type: 'mcp', ...descriptor }]);
  assert.deepEqual(chatHostedMcp(undefined, servers), []);
  const headers = { authorization: 'Bearer mcp-fixture', 'x-region': 'eu' };
  const wire = await withMcpHeaders(tools, address => {
    assert.equal(address, endpoint);
    return new Headers(headers);
  });
  assert.equal(tools[0].headers, undefined);
  assert.deepEqual(apiChatHostedMcp(wire[0]), { name: 'mcp', inputSchema: { type: 'object', mcp: { ...descriptor, headers } } });
  assert.deepEqual(JSON.parse(withResponsesHostedMcp('{}', wire)).tools, [{ type: 'mcp', name: 'mcp', ...descriptor, headers }]);
});

test('provider MCP disambiguates normalized names and falls back to saved IDs, without changing hosted titles', () => {
  const servers = [
    { id: 'countries', title: 'Country Catalog', registryName: 'net.streaik.mcp/rest-countries' },
    { id: 'countries-2', title: 'Country Catalog', registryName: 'net.streaik.mcp/rest_countries' },
    { id: 'countries-3', title: 'Country Catalog', registryName: 'net.streaik.mcp/rest/countries' },
    { id: 'legacy_countries', title: 'Legacy Server' },
    { id: '123-fixture', title: 'Manual Server' },
  ].map(record => ({ record: { ...record, endpoint: `https://mcp.example/${record.id}` } }));
  const labels = execution => chatHostedMcp({ execution }, servers).map(tool => tool.server_label);
  assert.deepEqual(labels('provider'), ['net_streaik_mcp_rest-countries', 'net_streaik_mcp_rest_countries',
    'net_streaik_mcp_rest_countries_2', 'legacy_countries', 'mcp_123-fixture']);
  assert.deepEqual(labels('hosted'), ['Country Catalog', 'Country Catalog (2)', 'Country Catalog (3)', 'Legacy Server', 'Manual Server']);
});

test('browser tool choice, maximum and stop tools persist only in their profile', (t) => {
  const storage = new Map();
  const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  t.after(() => { if (original) Object.defineProperty(globalThis, 'localStorage', original); else delete globalThis.localStorage; });
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value),
  } });
  const toolPolicy = { toolChoice: 'required', maxToolCalls: 12, stopTools: ['mcp_lookup', 'local_ai_models_search'] };
  saveChatPreferences('alpha', { ...defaultChatPreferences, toolPolicy });
  assert.deepEqual(loadChatPreferences('alpha').toolPolicy, toolPolicy);
  assert.deepEqual(loadChatPreferences('beta').toolPolicy, { stopTools: [] });
  assert.deepEqual(normalizeChatPreferences({ toolPolicy: { toolChoice: 'required', maxToolCalls: -1 } }).toolPolicy, { stopTools: [] });
  saveChatPreferences('alpha', defaultChatPreferences);
  assert.deepEqual(loadChatPreferences('alpha').toolPolicy, { stopTools: [] });
});

test('native chat settings round-trip per profile and apply to the matching model only', (t) => {
  const storage = new Map();
  const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  t.after(() => { if (original) Object.defineProperty(globalThis, 'localStorage', original); else delete globalThis.localStorage; });
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value),
  } });
  const cerebras = { reasoning_effort: 'high', seed: 0, parallel_tool_calls: false, future_option: { nested: [null, true] } };
  saveChatPreferences('alpha', { ...defaultChatPreferences, providerSettings: { cerebras, together: [], groq: { seed: 1 } } });
  const settings = loadChatPreferences('alpha').providerSettings;
  assert.deepEqual(settings, { cerebras });
  assert.deepEqual(loadChatPreferences('beta').providerSettings, {});
  assert.deepEqual(chatProviderRequest(settings, 'cerebras/gpt-oss-120b')?.providerMetadata, { cerebras });
  const { reasoning_effort, ...other } = cerebras;
  assert.deepEqual(chatProviderRequest(settings, 'cerebras/llama-3.1-8b')?.providerMetadata, { cerebras: other });
  assert.equal(chatProviderRequest(settings, 'groq/gpt-oss-120b'), undefined);
});

test('OpenAI response options preserve native tool order, isolate session settings and never persist secret values', (t) => {
  const storage = new Map();
  const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  t.after(() => { if (original) Object.defineProperty(globalThis, 'localStorage', original); else delete globalThis.localStorage; });
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value),
  } });
  const future = { type: 'future_tool', extension: { flags: [0, false, null] } };
  const shell = { type: 'shell', environment: { type: 'container_auto', skills: [{ type: 'skill_reference', skill_id: 'skill_demo', version: '2' }],
    network_policy: { type: 'allowlist', allowed_domains: ['example.org'], domain_secrets: [{ domain: 'example.org', name: 'TOKEN', value: 'session-only-secret' }] } } };
  const tools = [future, shell, { type: 'web_search', search_context_size: 'medium' }, { type: 'apply_patch' }, { type: 'tool_search', execution: 'client' }];
  const changed = updateTypedItem(tools, 'web_search', { search_context_size: 'high' });
  assert.deepEqual(changed, [future, shell, { type: 'web_search', search_context_size: 'high' }, ...tools.slice(3)]);
  const multi_agent = { enabled: true, max_concurrent_subagents: 4 };
  const providerSettings = { openai: { tools: changed, agent: { model: 'agent-model' }, environment: { type: 'openai_hosted' }, multi_agent }, together: { reasoning_effort: 'high' } };
  const requested = chatProviderRequest(providerSettings, 'openai/gpt-5');
  assert.deepEqual(requested.providerMetadata.openai, { tools: changed.slice(0, 4), multi_agent });
  assert.deepEqual(requested.headers, { 'OpenAI-Beta': 'responses_multi_agent=v1' });
  assert.equal(chatProviderRequest(providerSettings, 'together/openai/gpt-oss-120b').headers, undefined);
  saveChatPreferences('alpha', { ...defaultChatPreferences, providerSettings });
  assert.ok([...storage.values()].every(value => !value.includes('session-only-secret')));
  const restored = loadChatPreferences('alpha').providerSettings;
  assert.deepEqual(restored.openai.agent, { model: 'agent-model' });
  const storedSecret = restored.openai.tools[1].environment.network_policy.domain_secrets[0];
  assert.deepEqual(storedSecret, { domain: 'example.org', name: 'TOKEN' });
  assert.equal(chatProviderRequest(restored, 'openai/gpt-5').providerMetadata.openai.tools[1].environment.network_policy.domain_secrets, undefined);
});

test('encrypted reasoning defaults on and a saved opt-out becomes a native include array, not an upstream flag', (t) => {
  const storage = new Map();
  const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  t.after(() => { if (original) Object.defineProperty(globalThis, 'localStorage', original); else delete globalThis.localStorage; });
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value),
  } });

  const request = openai => chatProviderRequest({ openai }, 'openai/gpt-5')?.providerMetadata;
  const include = ['web_search_call.action.sources', 'file_search_call.results'];
  assert.equal(request({}), undefined); // API Chat applies the default when include is absent.
  assert.deepEqual(request({ include }), { openai: { include: [...include, encryptedReasoningInclude] } });
  assert.deepEqual(request({ include: [encryptedReasoningInclude, ...include] }), { openai: { include: [encryptedReasoningInclude, ...include] } });

  const openai = { includeEncryptedReasoning: false, include: [encryptedReasoningInclude, ...include] };
  saveChatPreferences('alpha', { ...defaultChatPreferences, providerSettings: { openai } });
  assert.deepEqual(loadChatPreferences('alpha').providerSettings, { openai });
  assert.deepEqual(request(loadChatPreferences('alpha').providerSettings.openai), { openai: { include } });
  assert.deepEqual(request({ includeEncryptedReasoning: false }), { openai: { include: [] } });
});

const assistant = (metadata, parts = []) => ({ role: 'assistant', metadata, parts });
const tool = (output, fields = {}) => ({ type: 'dynamic-tool', toolName: 'lookup', toolCallId: 'fixture', state: 'output-available', output, ...fields });

test('only typed client tool content is filtered, without altering approvals, structured data or the transcript', () => {
  const link = { type: 'resource_link', mimeType: 'image/png', uri: 'fixture://image' };
  const future = { type: 'future' };
  const output = { content: [
    { type: 'text', text: 'result' }, link,
    { type: 'image', mimeType: 'image/png', data: 'AQID' },
    { type: 'audio', mimeType: 'audio/wav', data: 'BAUG' },
    { type: 'resource', resource: { uri: 'fixture://clip', mimeType: ' VIDEO/MP4 ', blob: 'BwgJ' } },
    { type: 'resource', resource: { uri: 'fixture://doc', mimeType: 'application/pdf', blob: 'CgsM' } },
    { type: 'resource', resource: { uri: 'fixture://json', mimeType: 'application/record+json; charset=utf-8', text: '{}' } },
    future,
  ], structuredContent: { number: 42 }, _meta: { gateway: { cost: 0 } }, isError: true };
  const signed = { id: 'review', approved: true, signature: 'fixture-signature' };
  const parts = [tool(output, { providerExecuted: false, approval: signed }), tool(output, { providerExecuted: true }),
    tool(output, { state: 'approval-responded', approval: { id: 'declined', approved: false } }), tool({ contents: output.content }), tool(output)];
  const messages = [assistant(undefined, parts)];
  const original = structuredClone(messages);
  const omitted = kind => ({ type: 'text', text: `${kind} content omitted by user settings.` });
  const [mapped] = filterToolOutputContent(messages, { ...defaultChatPreferences.toolOutput, text: false });
  assert.deepEqual(mapped.parts[0].output, { ...output, content: [omitted('Text'), link, omitted('Image'), omitted('Audio'),
    omitted('Video'), omitted('Document'), omitted('Text'), future] });
  assert.strictEqual(mapped.parts[0].approval, signed);
  assert.equal(mapped.parts[0].toolCallId, parts[0].toolCallId);
  assert.deepEqual(mapped.parts[4].output, mapped.parts[0].output, 'native client calls may omit providerExecuted');
  for (const index of [1, 2, 3]) assert.strictEqual(mapped.parts[index], parts[index]);
  assert.deepEqual(messages, original);
  const [replayed] = filterToolOutputContent(messages, { ...defaultChatPreferences.toolOutput, links: false, images: true });
  assert.deepEqual(replayed.parts[0].output.content.slice(0, 3), [output.content[0], omitted('Link'), output.content[2]]);
});

test('conversation cost adds Gateway and Direct replies once, regardless of order', () => {
  const direct = assistant({ providerMetadata: { gateway: { source: 'direct', cost: 0.5 } } });
  const gateway = assistant({ providerMetadata: { gateway: { cost: '0.125' } }, gateway: { cost: 4 }, cost: 8 });
  const legacyDirect = assistant({ gateway: { source: 'direct', cost: '0.25' } });
  assert.equal(conversationCost([gateway, direct]), 0.625);
  assert.equal(conversationCost([direct, gateway]), 0.625);
  assert.equal(conversationCost([direct, legacyDirect]), 0.75);
  assert.equal(conversationCost([gateway, assistant({ cost: 0.5 })]), 0.625);
});

test('message cost uses the canonical cost first, with legacy fallbacks for missing cost', () => {
  assert.deepEqual(messageCost({ providerMetadata: { gateway: { source: 'direct', cost: 0 } }, gateway: { cost: 4 }, cost: 8 }),
    { cost: 0, source: 'direct' });
  assert.deepEqual(messageCost({ providerMetadata: { gateway: { ttft: 1 } }, gateway: { source: 'direct', cost: '0.25' }, cost: 8 }),
    { cost: 0.25, source: 'direct' });
  assert.equal(messageCost({ providerMetadata: { gateway: { ttft: 1 } }, cost: '0.125' }).cost, 0.125);
});

test('conversation cost needs two valid costs, includes completed tool results and counts zero', () => {
  const invalid = [NaN, Infinity, -1, '', 'unknown'].map(cost => assistant({ cost }));
  const unpriced = assistant({ providerMetadata: { gateway: { source: 'direct', ttft: 1 } } });
  const user = { role: 'user', metadata: { cost: 4 }, parts: [] };
  const gatewayTool = tool({ _meta: { gateway: { cost: 0.25 } } });
  const directOutput = { _meta: { gateway: { source: 'direct', cost: '0.5' } } };
  const pending = tool(directOutput, { state: 'input-available' });
  const reply = assistant({ gateway: { cost: 0.125 } }, [pending]);
  assert.equal(conversationCost([reply, unpriced, user, ...invalid]), undefined);
  assert.equal(conversationCost([reply, assistant({ gateway: { cost: 0 } })]), 0.125);
  assert.equal(conversationCost([assistant(reply.metadata, [gatewayTool])]), 0.375);
  assert.equal(conversationCost([assistant(reply.metadata, [gatewayTool, tool(directOutput, { toolCallId: 'direct' })])]), 0.875);
});

test('context usage uses the replying model, not the first routing candidate or all conversation tokens', () => {
  const models = [{ id: 'provider/fallback', contextWindow: 128_000 }, { id: 'provider/winner', contextWindow: 2048, maxTokens: 256 }, { id: 'provider/unknown' }];
  const messages = [assistant({ model: models[0].id, usage: { totalTokens: 50 } }),
    assistant({ model: models[1].id, usage: { promptTokens: 2200, completionTokens: 48 } }), assistant({ model: models[1].id })];
  assert.deepEqual(latestContextUsage(messages, models), { used: 2248, window: 2048, maxOutput: 256 });
  assert.equal(latestContextUsage(messages, [models[0]]), undefined);
  assert.equal(latestContextUsage([...messages, assistant({ model: models[2].id, usage: { totalTokens: 10 } })], models), undefined);
  assert.equal(latestContextUsage([assistant({ model: models[1].id })], models), undefined);
  assert.deepEqual(latestContextUsage([assistant({ model: models[1].id, usage: { totalTokens: 0 } })], models), { used: 0, window: 2048, maxOutput: 256 });
});
