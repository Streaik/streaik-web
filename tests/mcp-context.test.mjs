import assert from 'node:assert/strict';
import test from 'node:test';
import { forAssistant, forUser, mcpResourceCatalog, readResourceTool, resolveResourceRead } from '../packages/chat/src/mcpChatContext.ts';
import { activeChatTools, filterLocalToolReplay } from '../packages/chat/src/localPlugins.ts';

test('MCP catalogs and manual pickers match AI Happy audience rules', () => {
  const make = (name, annotations) => ({ name, uri: `fixture:${name}`, annotations, _meta: { secret: 'not for the model' } });
  const resources = [make('plain'), make('priority', { priority: 0.5 }), make('empty', { audience: [] }),
    make('assistant', { audience: ['assistant'] }), make('user', { audience: ['user'] }), make('both', { audience: ['assistant', 'user'] })];
  const userTemplate = { name: 'user template', uriTemplate: 'fixture:{id}', annotations: { audience: ['user'] } };
  const assistantTemplate = { name: 'assistant template', uriTemplate: 'fixture:{key}', annotations: { audience: ['assistant'] } };
  const server = { record: { id: 'server', title: 'Test server', endpoint: 'https://mcp.example.test' },
    discovery: { hasResources: true, resources, resourceTemplates: [userTemplate, assistantTemplate] } };
  assert.deepEqual(resources.filter(forUser).map(item => item.name), ['plain', 'user', 'both']);
  assert.deepEqual(resources.filter(forAssistant).map(item => item.name), ['plain', 'priority', 'empty', 'assistant', 'both']);
  const catalog = mcpResourceCatalog([server]);
  assert.deepEqual(catalog.mcpResourceCatalog.servers[0].resources.map(item => item.uri), ['fixture:plain', 'fixture:priority', 'fixture:empty', 'fixture:assistant', 'fixture:both']);
  assert.deepEqual(catalog.mcpResourceCatalog.servers[0].resourceTemplates.map(item => item.uriTemplate), ['fixture:{key}']);
  assert.doesNotMatch(JSON.stringify(catalog), /secret|mcp\.example/);
  assert.equal(mcpResourceCatalog([]), undefined);
});

test('read_resource resolves only resource-capable selections and drops tool replay after disconnect', () => {
  const entry = { record: { id: 'fixture' }, discovery: { hasResources: true } };
  const input = { serverId: 'fixture', uri: 'custom://item/1' };
  assert.deepEqual(resolveResourceRead([entry], input), { record: entry.record, uri: input.uri });
  assert.equal(resolveResourceRead([], input), undefined);
  assert.equal(resolveResourceRead([entry], { ...input, serverId: 'https://other.example.test' }), undefined);
  assert.equal(resolveResourceRead([entry], { ...input, uri: '/relative/path' }), undefined);
  const direct = { mode: 'direct', endpoint: '/v1/messages' };
  assert.deepEqual(activeChatTools(direct, [], false, [], false, readResourceTool).map(t => t.definition.name), ['read_resource']);
  const messages = [{ id: 'm', role: 'assistant', parts: [{ type: 'dynamic-tool', toolName: 'read_resource', toolCallId: 'r',
    state: 'output-available', input, output: 'approved content' }] }];
  assert.deepEqual(filterLocalToolReplay(messages, [readResourceTool], false, undefined, new Set(['fixture'])), messages);
  assert.deepEqual(filterLocalToolReplay(messages, [readResourceTool], false, undefined, new Set(['another'])), []);
});
