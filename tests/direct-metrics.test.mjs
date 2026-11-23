import assert from 'node:assert/strict';
import test from 'node:test';
import { createDirectMetrics } from '../packages/gateway/src/directMetrics.ts';

const usage = { inputTokens: 100, outputTokens: 20, totalTokens: 120,
  inputTokenDetails: { noCacheTokens: 60, cacheReadTokens: 25, cacheWriteTokens: 15 }, outputTokenDetails: {} };
const rates = { input: 1e-6, output: 5e-6, cacheRead: 0.1e-6, cacheWrite: 1.25e-6 };

test('Direct timing only observes nonempty output between the provider POST and the last delta', () => {
  let time = 0;
  const direct = createDirectMetrics('/v1/responses', { provider: 'openai', rates: () => undefined }, () => time);
  direct.observe({ type: 'text-delta', text: 'before POST' });
  time = 500; direct.start();
  time = 550; direct.observe({ type: 'text-delta', text: '' });
  time = 600; direct.observe({ type: 'raw', rawValue: { type: 'response.created' } });
  time = 1000; direct.observe({ type: 'reasoning-delta', text: 'reasoning' });
  time = 1250; direct.observe({ type: 'text-delta', text: 'text' });
  time = 1500; direct.observe({ type: 'tool-input-delta', delta: '{"arg":1}' });
  time = 10000; direct.observe({ type: 'raw', rawValue: { type: 'response.completed' } });
  assert.deepEqual(direct.finish(usage).metrics, { source: 'direct', ttft: 0.5, tps: 40 });
  assert.deepEqual(direct.finish({ ...usage, outputTokens: undefined }).metrics, { source: 'direct', ttft: 0.5 });
});

test('Anthropic estimate uses ordinary input plus both cache buckets without billing cache tokens twice', () => {
  const direct = createDirectMetrics('/v1/messages', { provider: 'anthropic', rates: () => rates });
  const { metrics } = direct.finish(usage);
  assert.equal(metrics.estimated, true);
  assert.ok(Math.abs(metrics.cost - (60 * rates.input + 20 * rates.output + 25 * rates.cacheRead + 15 * rates.cacheWrite)) < 1e-14);
});

test('Direct estimates omit unpriced or invalid usage while keeping available timing', () => {
  const options = { provider: 'anthropic', rates: () => rates };
  for (const opaque of [
    { server_tool_use: { web_search_requests: 1 } },
    { service_tier: 'priority' },
    { cache_creation: { ephemeral_1h_input_tokens: 15 } },
    { iterations: [{ type: 'advisor_message' }] },
  ]) {
    const direct = createDirectMetrics('/v1/messages', options, () => 1);
    direct.start();
    direct.observe({ type: 'text-delta', text: 'only output' });
    direct.observe({ type: 'raw', rawValue: { usage: opaque } });
    assert.deepEqual(direct.finish(usage).metrics, { source: 'direct', ttft: 0 });
  }
  for (const invalid of [{ inputTokens: 2 }, { inputTokens: -1 }, { outputTokens: undefined }, { outputTokens: 1.5 }]) {
    const direct = createDirectMetrics('/v1/messages', options);
    assert.equal(direct.finish({ ...usage, ...invalid }).metrics, undefined);
  }
  const noWriteRate = createDirectMetrics('/v1/messages', { ...options, rates: () => ({ ...rates, cacheWrite: undefined }) });
  assert.equal(noWriteRate.finish(usage).metrics, undefined);
});

test('Direct aborts and errors do not publish timing or an estimated charge', () => {
  for (const terminal of [{ type: 'abort' }, { type: 'error' }, { type: 'finish', finishReason: 'interrupted' }]) {
    const direct = createDirectMetrics('/v1/responses', { provider: 'openai', rates: () => rates }, () => 1);
    direct.start();
    direct.observe({ type: 'text-delta', text: 'partial reply' });
    direct.observe(terminal);
    assert.equal(direct.finish(usage).metrics, undefined);
  }
});

test('OpenRouter timing counts reasoning-only frames but does not count the matching SDK delta twice', () => {
  let time = 1000;
  const direct = createDirectMetrics('/v1/chat/completions', { provider: 'openrouter', rates: () => undefined }, () => time);
  direct.start();
  time = 1500; direct.observe({ type: 'raw', rawValue: { choices: [{ delta: { reasoning: 'thinking' } }] } });
  time = 2000; direct.observe({ type: 'raw', rawValue: { choices: [{ delta: { content: 'answer' } }] } });
  time = 2100; direct.observe({ type: 'text-delta', text: 'answer' });
  time = 4000; direct.observe({ type: 'raw', rawValue: { usage: { prompt_tokens: 100, completion_tokens: 20, cost: 0 } } });
  assert.deepEqual(direct.finish(usage).metrics, { source: 'direct', ttft: 0.5, tps: 40, cost: 0, estimated: false, currency: 'USD' });
});
