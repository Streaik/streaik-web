import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readUIMessageStream } from 'ai';
import { decisionActivity, isDecisionActivity, withDecisionActivity, withoutDecisionActivity } from '../packages/chat/src/decisionActivity.ts';

const choice = { endpoint: '/v1/decisions', model: 'example/router', instructions: 'Choose the best candidate.',
  choices: [{ value: 'example/a', description: 'First' }, { value: 'example/b', description: 'Second' }] };

test('decision chunks use the reply ID and save sanitized, provider-executed routing activity', async () => {
  const agent = { name: 'Agent', description: 'An agent', instructions: 'Explain the result.' };
  const frames = decisionActivity({ ...choice, input: 'private conversation' }, { ...agent, conversation: 'private history' },
    { selectedModel: 'example/b' });
  const metadata = { model: 'example/b', timestamp: '2026-01-01T00:00:00Z' };
  const reply = ReadableStream.from([{ type: 'start', messageId: 'reply-id', messageMetadata: metadata },
    { type: 'text-start', id: 'text' }, { type: 'text-delta', id: 'text', delta: 'Answer' }, { type: 'text-end', id: 'text' }]);
  let message;
  for await (const item of readUIMessageStream({ stream: withDecisionActivity({ stream: reply }, frames) })) message = item;
  assert.equal(message.id, 'reply-id');
  assert.deepEqual(message.metadata, metadata);
  const [part, text] = message.parts;
  assert.equal(isDecisionActivity(part), true);
  assert.deepEqual(part.input, { ...choice, agent });
  assert.deepEqual(part.output, { selectedModel: 'example/b' });
  assert.equal(text.text, 'Answer');

  const otherTool = { ...part, toolCallId: 'provider-tool-id' };
  const decisionOnly = { id: 'decision-only', role: 'assistant', parts: [{ type: 'step-start' }, part] };
  const history = [decisionOnly, { ...message, parts: [part, otherTool, text] }];
  assert.deepEqual(withoutDecisionActivity(history), [{ ...message, parts: [otherTool, text] }]);
  assert.equal(history[1].parts.length, 3);
});

test('failed decision activity is readable before the original error propagates', async () => {
  const failure = new Error('Routing failed');
  const frames = decisionActivity(choice, undefined);
  const stream = withDecisionActivity({ error: failure }, frames);
  let message;
  let reported;
  for await (const item of readUIMessageStream({ stream, onError: error => { reported = error; } })) message = item;
  assert.equal(reported, failure);
  const [part] = message.parts;
  assert.equal(isDecisionActivity(part), true);
  assert.equal(part.state, 'output-error');
  assert.deepEqual(part.input, choice);
});
