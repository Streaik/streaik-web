export const chartFence = 'chart';
export const chartTypes = ['bar', 'line', 'doughnut'] as const;
export const chartLimits = { source: 64 * 1024, labels: 60, series: 8, text: 120 } as const;

export type ChartSpec = {
  type: typeof chartTypes[number];
  title?: string;
  labels: readonly string[];
  series: readonly { name: string; values: readonly number[] }[];
};

const example = {
  type: 'bar', title: 'Conversations by month', labels: ['Jan', 'Feb', 'Mar'],
  series: [{ name: 'Conversations', values: [12, 19, 15] }],
} satisfies ChartSpec;

export const chartInstructions = {
  instructions: [
    `To display a chart, put one strict JSON object in a fenced Markdown block tagged ${chartFence}. Use one fence per chart.`,
    `Use type (${chartTypes.join(', ')}), optional title, labels (distinct category strings) and series (objects with a distinct name and a values array).`,
    `Use 1–${chartLimits.labels} labels and 1–${chartLimits.series} series. Keep text nonempty and at most ${chartLimits.text} characters.`,
    'Provide one finite number per label in order. A doughnut requires exactly one series with nonnegative values and at least one positive value.',
    'Use only these fields, no chart-library options. Use the provided data and identify any illustrative data as such.',
  ].join(' '),
  example: `\`\`\`${chartFence}\n${JSON.stringify(example)}\n\`\`\``,
};

function object(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).every(key => keys.includes(key));
}

function text(value: unknown): value is string {
  return typeof value === 'string' && value.length <= chartLimits.text && value.trim().length > 0;
}

export function parseChartSpec(source: string): ChartSpec | undefined {
  if (source.length > chartLimits.source) return;
  let value: unknown;
  try { value = JSON.parse(source); } catch { return; }
  if (!object(value, ['type', 'title', 'labels', 'series'])) return;
  const { type, title, labels, series } = value;
  if (type !== 'bar' && type !== 'line' && type !== 'doughnut') return;
  if (title !== undefined && !text(title)) return;
  if (!Array.isArray(labels) || !labels.length || labels.length > chartLimits.labels ||
    !labels.every(text) || new Set(labels).size !== labels.length) return;
  if (!Array.isArray(series) || !series.length || series.length > chartLimits.series || (type === 'doughnut' && series.length !== 1)) return;

  const data: ChartSpec['series'][number][] = [];
  const names = new Set<string>();
  for (const item of series) {
    if (!object(item, ['name', 'values'])) return;
    const { name, values } = item;
    if (!text(name) || names.has(name) || !Array.isArray(values) || values.length !== labels.length ||
      !values.every((point): point is number => typeof point === 'number' && Number.isFinite(point))) return;
    if (type === 'doughnut' && (values.some(point => point < 0) || !values.some(point => point > 0) ||
      !Number.isFinite(values.reduce((sum, point) => sum + point, 0)))) return;
    names.add(name);
    data.push({ name, values });
  }
  return { type, ...(title === undefined ? {} : { title }), labels, series: data };
}
