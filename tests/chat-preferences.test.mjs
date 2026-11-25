import assert from 'node:assert/strict';
import test from 'node:test';
import { defaultChatPreferences, loadChatPreferences, normalizeChatPreferences, saveChatPreferences } from '../packages/chat/src/chatPreferences.ts';
import { defaultMcpPreferences } from '../packages/chat/src/mcpPreferences.ts';
import { conversationGatewayCost, latestContextUsage } from '../packages/chat/src/messageMetadata.ts';
import { filterToolOutputContent } from '../packages/chat/src/toolOutputContent.ts';
import { chatProviderRequest } from '../packages/chat/src/providerChat/settings.ts';

test('old profiles get Chat defaults; only explicit, valid booleans override each preference', () => {
  const defaults = { text: true, links: true, images: false, audio: false, video: false, documents: false };
  assert.deepEqual(normalizeChatPreferences(null), defaultChatPreferences);
  const { dictate, showContextSize, showMessageTokens, showProviderLogo, showMetrics, toolOutput } = normalizeChatPreferences({ delay: 50 });
  assert.deepEqual({ dictate, showContextSize, showMessageTokens, showProviderLogo, showMetrics, toolOutput },
    { dictate: true, showContextSize: true, showMessageTokens: true, showProviderLogo: true, showMetrics: false, toolOutput: defaults });
  assert.deepEqual(normalizeChatPreferences({ dictate: false, showContextSize: 'false', showMetrics: true,
    toolOutput: { text: false, links: 0, images: true, documents: 'true', extra: true } }),
  { ...defaultChatPreferences, dictate: false, showMetrics: true, toolOutput: { ...defaults, text: false, images: true } });
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

test('conversation cost needs two gateway-priced results and ignores Direct, duplicates and invalid values', () => {
  const direct = assistant({ providerMetadata: { gateway: { source: 'direct', cost: 0.8 } } });
  const gateway = assistant({ providerMetadata: { gateway: { cost: '0.125' } }, gateway: { cost: 4 }, cost: 8 });
  assert.equal(conversationGatewayCost([direct, gateway, assistant({ cost: NaN }), { role: 'user', metadata: { cost: 4 }, parts: [] }]), undefined);
  assert.equal(conversationGatewayCost([gateway, direct, assistant({ gateway: { cost: 0 } })]), 0.125);
  assert.equal(conversationGatewayCost([assistant(gateway.metadata, [tool({ _meta: { gateway: { cost: 0.25 } } })])]), 0.375);
  assert.equal(conversationGatewayCost([gateway, assistant({ cost: 0.5 })]), 0.625);
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
