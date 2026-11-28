import assert from 'node:assert/strict';
import test from 'node:test';
import { chartFence, chartLimits, parseChartSpec } from '@streaik/themes/chart-spec';
import { defaultChatPreferences, normalizeChatPreferences } from '../packages/chat/src/chatPreferences.ts';
import { activeChatTools, filterLocalToolReplay, runLocalTool } from '../packages/chat/src/localPlugins.ts';

const bar = { type: 'bar', labels: ['Jan', 'Feb'], series: [{ name: 'Tokens', values: [12, 19] }] };
const parse = value => parseChartSpec(JSON.stringify(value));

test('one chart contract accepts bar, line and doughnut data without renderer options', () => {
  assert.deepEqual(parse(bar), bar);
  const line = { ...bar, type: 'line', title: 'Balance', series: [...bar.series, { name: 'Delta', values: [-2.5, 0] }] };
  assert.deepEqual(parse(line), line);
  const doughnut = { ...bar, type: 'doughnut', series: [{ name: 'Count', values: [0, 10] }] };
  assert.deepEqual(parse(doughnut), doughnut);
});

test('chart JSON rejects unsupported shapes, invalid or mismatched data and excessive input', () => {
  const invalid = [
    null, [], { ...bar, type: 'radar' }, { ...bar, options: {} }, { ...bar, title: 0 },
    { ...bar, labels: ['Jan', 'Jan'] }, { ...bar, labels: [' ', 'Feb'] }, { ...bar, labels: ['Jan'] },
    { ...bar, labels: ['x'.repeat(chartLimits.text + 1), 'Feb'] }, { ...bar, series: [] },
    { ...bar, series: [{ name: 'Tokens', values: [12, '19'] }] },
    { ...bar, series: [{ name: 'Tokens', values: [12, null] }] },
    { ...bar, series: [{ name: 'Tokens', values: [12, 19], color: 'red' }] },
    { ...bar, series: [...bar.series, ...bar.series] },
    { ...bar, type: 'doughnut', series: [{ name: 'Bad', values: [-1, 2] }] },
    { ...bar, type: 'doughnut', series: [{ name: 'Bad', values: [0, 0] }] },
    { ...bar, type: 'doughnut', series: [...bar.series, { name: 'Other', values: [1, 2] }] },
  ];
  for (const value of invalid) assert.equal(parse(value), undefined, JSON.stringify(value));
  assert.equal(parseChartSpec(JSON.stringify(bar).replace('19', '1e999')), undefined);
  assert.equal(parseChartSpec(JSON.stringify(bar).replace('19', '/* comment */ 19')), undefined);
  assert.equal(parseChartSpec(' '.repeat(chartLimits.source) + JSON.stringify(bar)), undefined);
});

test('Charts opts in to one instructions tool without history and the tool example parses', async () => {
  const route = { mode: 'gateway', endpoint: '/api/chat' };
  assert.deepEqual(activeChatTools(route, defaultChatPreferences.plugins, false, []), []);
  const { plugins } = normalizeChatPreferences({ plugins: ['local-charts'] });
  const tools = activeChatTools(route, plugins, false, []);
  assert.equal(tools.length, 1);
  const [tool] = tools;
  assert.equal(tool.source, 'local');
  assert.equal(tool.definition.name, 'local_chart_instructions');
  assert.deepEqual(tool.definition.inputSchema.properties, {});
  const result = await runLocalTool(tool, {}, { catalog: [], history: [] });
  assert.deepEqual(Object.keys(result.structuredContent), ['instructions', 'example']);
  const [opening, source, closing] = result.structuredContent.example.split('\n');
  assert.equal(opening, '```' + chartFence);
  assert.equal(closing, '```');
  assert.equal(parseChartSpec(source)?.type, 'bar');

  const reply = { type: 'text', text: result.structuredContent.example };
  const message = { id: 'reply', role: 'assistant', parts: [
    { type: 'dynamic-tool', toolName: tool.definition.name, toolCallId: 'tool', state: 'output-available', output: result }, reply,
  ] };
  assert.deepEqual(filterLocalToolReplay([message], [], false), [{ ...message, parts: [reply] }]);
});
