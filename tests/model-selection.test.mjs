import assert from 'node:assert/strict';
import test from 'node:test';
import { defaultAgentModelIds, resolveModelSelection } from '../packages/chat/src/modelSelection.ts';
import { requestContextText, withRequestContext } from '../packages/chat/src/chatContext.ts';

const models = ['first-in-catalog', 'alternate', 'preferred'].map(id => ({ id }));
const defaults = ['missing', 'preferred', 'alternate', 'preferred'];
const selectedIds = (ids, multiple = true, defaultIds = defaults) =>
  resolveModelSelection(models, ids, multiple, defaultIds).selected.map(({ id }) => id);

test('model defaults select only catalog matches in agent order', () => {
  assert.deepEqual(selectedIds(undefined), ['preferred', 'alternate']);
  assert.deepEqual(selectedIds(undefined, false), ['preferred']);
  assert.deepEqual(selectedIds(undefined, true, ['missing']), []);
  assert.deepEqual(resolveModelSelection(models, undefined, true).selected, []);
});

test('explicit picks, including clearing and a now-unavailable saved pick, do not fall back', () => {
  assert.deepEqual(selectedIds(['first-in-catalog']), ['first-in-catalog']);
  assert.deepEqual(selectedIds([]), []);
  assert.deepEqual(selectedIds(['missing']), []);
});

test('app agent defaults use model or models without including a decision-only entry', () => {
  assert.deepEqual(defaultAgentModelIds(), []);
  assert.deepEqual(defaultAgentModelIds({ model: { id: 'preferred' } }), ['preferred']);
  assert.deepEqual(defaultAgentModelIds({ model: { id: 'ignored' }, models: [
    { id: 'router', type: 'decision' }, { id: 'preferred' }, { id: 'alternate' },
  ] }), ['preferred', 'alternate']);
});

test('chat agent instructions are a text block in system context, not a transcript message', () => {
  const messages = [{ id: 'opening', role: 'user', parts: [{ type: 'text', text: 'Hi' }] }];
  const context = { chatInstructions: 'Keep it concise.\nUse examples.', user: { preferredLanguage: 'en', darkMode: false } };
  const text = requestContextText(context);
  assert.deepEqual(text, [JSON.stringify(context.user), context.chatInstructions]);
  assert.deepEqual(withRequestContext(messages, context), [
    { id: 'streaik-request-context', role: 'system', parts: text.map(text => ({ type: 'text', text })) }, ...messages,
  ]);
  assert.equal(messages.length, 1);
});
