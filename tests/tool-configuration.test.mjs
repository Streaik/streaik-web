import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeChatPreferences } from '../packages/chat/src/chatPreferences.ts';
import { createAgentDraft, saveAgentDraft } from '../packages/chat/src/agentDraft.ts';
import { agentMcpAllows, agentMcpServers, enableAgentSearch, patchAgentMcp, patchAgentTool } from '../packages/chat/src/agentTools.ts';
import { apiChatTools, chatRequestTools, configureChatTools } from '../packages/chat/src/chatToolRequest.ts';
import { extendNativeTools } from '../packages/gateway/src/nativeToolOptions.ts';

const schema = { type: 'object', properties: {} };
const route = { mode: 'gateway', endpoint: '/api/chat' };
const endpoint = 'https://inventory.example/mcp';
const agent = {
  name: 'Inventory', description: 'Read inventory', instructions: 'Look up inventory.',
  model: { id: 'openai/test' },
  tools: [{ type: 'function', name: 'lookup', defer_loading: false, future: 2 }, { type: 'resource_search', future: 3 }],
  mcpServers: { 'Inventory EU': { type: 'http', url: endpoint, allowed_tools: ['lookup'], namespace: true,
    allowed_callers: ['direct', 'programmatic'], defer_loading: true, extension: { retained: true } } },
  futureField: 1,
};
const tool = { name: 'mcp_inventory_lookup', remoteName: 'lookup', inputSchema: schema, server: { id: 'inventory', title: 'Installed Inventory', endpoint } };
const tools = [{ source: 'mcp', tool, definition: tool }, { source: 'skill', definition: { name: 'activate_skill', inputSchema: schema } }];

test('scoped preference normalization preserves explicit off and clears malformed values', () => {
  const prefs = normalizeChatPreferences({ useToolNamespaces: true, toolRequestConfig: { lookup: {
    allowed_callers: ['direct', 'invalid', 'direct'], defer_loading: false }, untouched: null, malformed: { defer_loading: 1 } } });
  assert.deepEqual(prefs.toolRequestConfig, { lookup: { allowed_callers: ['direct'], defer_loading: false } });
  assert.deepEqual(normalizeChatPreferences(JSON.parse(JSON.stringify(prefs))), prefs);
  assert.deepEqual(normalizeChatPreferences({}).toolRequestConfig, {});
  assert.equal(normalizeChatPreferences({}).useToolNamespaces, false);
});

test('agent edits keep the AI Happey tool identities and unrelated blueprint options', () => {
  const draft = createAgentDraft(agent);
  draft.tools = patchAgentTool(enableAgentSearch(draft.tools, 'tool_search', true), { type: 'function', name: 'lookup' }, { allowed_callers: [] });
  draft.mcpServers = patchAgentMcp(draft.mcpServers, 'Inventory EU', { required: true });
  const saved = JSON.parse(JSON.stringify(saveAgentDraft(draft, agent)));
  assert.deepEqual(saved.tools, [
    { type: 'function', name: 'lookup', defer_loading: false, allowed_callers: [], future: 2 },
    { type: 'resource_search', future: 3 }, { type: 'tool_search' },
  ]);
  assert.equal(saved.futureField, 1);
  const declaration = agentMcpServers(saved.mcpServers)[0];
  assert.equal(declaration.endpoint, endpoint);
  assert.deepEqual(declaration.server.extension, { retained: true });
  assert.equal(declaration.server.required, true);
  assert.equal(agentMcpAllows(declaration.server, 'lookup'), true);
  assert.equal(agentMcpAllows(declaration.server, 'write'), false);
  assert.equal(agentMcpAllows({ allowed_tools: [] }, 'lookup'), false);
});

test('chat applies agent inheritance to the resolved MCP endpoint and retains client identities across provider shapes', () => {
  const definitions = chatRequestTools(configureChatTools(tools, { activate_skill: { defer_loading: true } }, false, agent));
  const openai = apiChatTools(definitions, route, 'openai/test');
  assert.deepEqual(openai.tools.map(t => t.name), ['activate_skill']);
  assert.equal(openai.tools[0].defer_loading, true);
  assert.deepEqual(openai.namespaces.map(ns => [ns.name, ns.tools]), [['inventory_eu', [
    { type: 'function', name: tool.name, description: undefined, parameters: schema, allowed_callers: ['direct', 'programmatic'] },
  ]]]);
  const anthropic = apiChatTools(definitions, route, 'anthropic/test');
  assert.deepEqual(anthropic.namespaces, []);
  assert.deepEqual(anthropic.tools[0].allowed_callers, ['direct', 'programmatic']);
  assert.equal(anthropic.tools[0].defer_loading, undefined);
  assert.equal(apiChatTools(definitions, route, 'groq/test').tools[0].allowed_callers, undefined);
  assert.equal('allowed_callers' in tool, false);
});

test('native Responses decorates client functions and replays their namespace without altering the call ID', () => {
  const body = JSON.stringify({ model: 'test', store: false,
    tools: [{ type: 'function', name: 'lookup', parameters: schema }, { type: 'web_search' }],
    input: [{ type: 'function_call', name: 'lookup', call_id: 'call-1', arguments: '{}' }, { type: 'function_call_output', call_id: 'call-1', output: 'ok' }] });
  const definitions = [{ name: 'lookup', namespace: { name: 'inventory' }, allowed_callers: ['programmatic'], defer_loading: true }];
  const native = JSON.parse(extendNativeTools(body, definitions, '/v1/responses', 'openai/test'));
  assert.equal(native.tools[0].type, 'web_search');
  assert.deepEqual(native.tools[1].tools, [{ type: 'function', name: 'lookup', parameters: schema, allowed_callers: ['programmatic'], defer_loading: true }]);
  assert.equal(native.input[0].namespace, 'inventory');
  assert.equal(native.input[1].call_id, 'call-1');
  assert.equal(extendNativeTools(body, definitions, '/v1/chat/completions', 'openai/test'), body);
});
