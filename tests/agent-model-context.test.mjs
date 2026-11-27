import assert from 'node:assert/strict';
import test from 'node:test';
import { createAgentDraft, saveAgentDraft } from '../packages/chat/src/agentDraft.ts';
import { agentMcpClientSettings, setAgentElicitation, setAgentMcpPolicy } from '../packages/chat/src/agentMcpClient.ts';
import { agentMcpServers, patchAgentMcp } from '../packages/chat/src/agentTools.ts';

const base = { name: 'Inventory', description: 'Look up inventory', instructions: 'Find items.' };
const endpoint = 'https://inventory.example.test/mcp';

test('policy and elicitation patches keep unrelated MCP client fields and never add URL elicitation', () => {
  const mcpClient = { futureClient: 1, policy: { readOnlyHint: true }, capabilities: { futureCapability: {} } };
  const source = { ...base, mcpClient, tools: [{ type: 'tool_search' }] };
  const draft = createAgentDraft(source);
  const policy = setAgentMcpPolicy(draft.mcpClient, 'destructiveHint', false);
  assert.equal(setAgentElicitation(policy, 'form', true), policy);
  const enabled = setAgentElicitation(policy, 'elicitation', true);
  const form = setAgentElicitation(enabled, 'form', true);
  assert.deepEqual(agentMcpClientSettings(form).elicitation, { form: {} });
  assert.deepEqual(saveAgentDraft({ ...draft, mcpClient: form }, source), {
    ...source, mcpClient: { ...mcpClient, policy: { readOnlyHint: true, destructiveHint: false },
      capabilities: { futureCapability: {}, elicitation: { form: {} } } },
  });
  assert.deepEqual(setAgentElicitation(form, 'form', false), enabled);
  assert.deepEqual(setAgentElicitation(form, 'elicitation', false), policy);
  const imported = { capabilities: { elicitation: { form: {}, url: {} } } };
  assert.deepEqual(setAgentElicitation(imported, 'form', false), { capabilities: { elicitation: { url: {} } } });
});

test('agent MCP saves under tools, strips legacy flags, and only omits approval when Default is selected', () => {
  const search = { type: 'tool_search', execution: 'server' };
  const mcp = { type: 'mcp', server_label: 'Inventory', server_url: endpoint, disabled: true, required: true,
    namespace: true, allowed_callers: ['direct'], defer_loading: true, require_approval: { always: { tool_names: ['lookup'] } } };
  const source = { ...base, tools: [mcp, search] };
  const draft = createAgentDraft(source);
  const untouched = saveAgentDraft(draft, source);
  assert.equal(Object.hasOwn(untouched.tools[0], 'disabled'), false);
  assert.equal(Object.hasOwn(untouched.tools[0], 'required'), false);
  assert.equal(untouched.tools[0].require_approval, mcp.require_approval);
  for (const require_approval of ['always', 'never', undefined]) {
    const tools = patchAgentMcp(draft.tools, 'Inventory', { require_approval });
    const saved = saveAgentDraft({ ...draft, tools }, source);
    const [{ server }] = agentMcpServers(saved.tools);
    assert.equal(Object.hasOwn(server, 'require_approval'), require_approval !== undefined);
    assert.deepEqual(server, { type: 'mcp', server_label: 'Inventory', server_url: endpoint, namespace: true,
      allowed_callers: ['direct'], defer_loading: true, ...(require_approval && { require_approval }) });
    assert.equal(saved.tools[1], search);
  }
});

test('new malformed MCP endpoints are reported on the Model Context tab', () => {
  const draft = createAgentDraft(base);
  const tools = patchAgentMcp(draft.tools, 'Bad URL', { server_url: 'not an endpoint' });
  assert.throws(() => saveAgentDraft({ ...draft, tools }, base), { tab: 'model-context' });
});
