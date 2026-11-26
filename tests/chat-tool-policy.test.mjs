import assert from 'node:assert/strict';
import test from 'node:test';
import { continueToolPolicy, normalizeToolPolicy, toolPolicyForTurn } from '../packages/chat/src/chatToolPolicy.ts';

const result = (toolCallId, toolName = 'lookup', state = 'output-available') => ({ type: 'dynamic-tool', toolName, toolCallId, state });

test('only positive whole call counts and real tool selections can enable Required', () => {
  const defaults = { stopTools: [] };
  for (const maxToolCalls of [undefined, 0, -2, 1.5, Infinity, Number.MAX_SAFE_INTEGER + 1, '3']) {
    assert.deepEqual(normalizeToolPolicy({ maxToolCalls, toolChoice: 'required', stopTools: [null, ' ', 2] }), defaults);
  }
  assert.deepEqual(normalizeToolPolicy({ toolChoice: 'none' }), { ...defaults, toolChoice: 'none' });
  assert.deepEqual(normalizeToolPolicy({ toolChoice: 'some-tool' }), defaults);
  assert.deepEqual(normalizeToolPolicy({ toolChoice: 'required', maxToolCalls: 30 }), { ...defaults, toolChoice: 'required', maxToolCalls: 30 });
  const policy = normalizeToolPolicy({ toolChoice: 'required', stopTools: [' lookup ', 'lookup', 'finish'] });
  assert.deepEqual(policy, { toolChoice: 'required', stopTools: ['lookup', 'finish'] });
  assert.deepEqual(toolPolicyForTurn(policy, new Set(['search'])), defaults);
  assert.deepEqual(toolPolicyForTurn(policy, new Set(['finish'])), { toolChoice: 'required', stopTools: ['finish'] });
});

test('an unlimited turn can continue after any number of completed batches', () => {
  const policy = normalizeToolPolicy(null);
  const progress = { seen: new Set(['previous-turn']), completed: 0 };
  const parts = [result('previous-turn')];
  for (let i = 0; i < 20; i++) {
    parts.push(result(`this-turn-${i}`));
    assert.equal(continueToolPolicy(policy, parts, progress), undefined);
  }
  assert.equal(progress.completed, 20);
});

test('a maximum counts each completed call once across batches and keeps the last parallel results', () => {
  const policy = normalizeToolPolicy({ maxToolCalls: 2, toolChoice: 'required' });
  const progress = { seen: new Set(['previous-turn']), completed: 0 };
  const parts = [result('previous-turn'), result('first'), result('pending', 'lookup', 'approval-requested')];
  assert.equal(continueToolPolicy(policy, parts, progress), 'required');
  assert.equal(progress.completed, 1);
  assert.equal(continueToolPolicy(policy, [...parts, result('second', 'lookup', 'output-error'), result('third', 'lookup', 'approval-responded')], progress), 'none');
  assert.equal(progress.completed, 3);
  assert.deepEqual([...progress.seen], ['previous-turn', 'first', 'second', 'third']);
  assert.equal(continueToolPolicy(policy, [result('new-turn-first')], { seen: new Set(), completed: 0 }), 'required');
});

test('a stop tool triggers only on a terminal outcome in the current turn', () => {
  const policy = normalizeToolPolicy({ stopTools: ['finish'], maxToolCalls: 20 });
  const progress = { seen: new Set(['prior-finish']), completed: 0 };
  const parts = [result('prior-finish', 'finish'), result('one'), result('two', 'finish', 'approval-requested')];
  assert.equal(continueToolPolicy(policy, parts, progress), undefined);
  assert.equal(continueToolPolicy(policy, [{ type: 'tool-finish', toolCallId: 'two', state: 'output-available' }, result('three')], progress), 'none');
  assert.equal(progress.completed, 3);
});
