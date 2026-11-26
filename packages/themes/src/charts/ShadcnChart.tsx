import { Bar, BarChart, CartesianGrid, Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { TooltipContentProps } from 'recharts';
import type { ComponentProps } from 'react';
import type { ChartRendererProps } from '../contract';
import './shadcn-chart.css';

// shadcn chart primitives, adapted to this adapter's CSS tokens rather than Tailwind utilities.
function ChartContainer({ children }: { children: ComponentProps<typeof ResponsiveContainer>['children'] }) {
  return <div className="streaik-chart-plot shadcn-chart"><ResponsiveContainer minWidth={0} initialDimension={{ width: 320, height: 288 }}>
    {children}
  </ResponsiveContainer></div>;
}

function ChartTooltipContent({ active, payload, label }: Pick<TooltipContentProps, 'active' | 'payload' | 'label'>) {
  if (!active || !payload.length) return null;
  return <div className="shadcn-chart-tooltip">
    {label != null && <strong>{label}</strong>}
    {payload.map(({ name, value, color }, index) => <div key={index}>
      <i style={{ backgroundColor: color }} />{name}<b>{String(value ?? '')}</b>
    </div>)}
  </div>;
}

const color = (index: number) => `var(--chart-${index % 8 + 1})`;
const shorten = (label: string) => label.length > 14 ? `${label.slice(0, 13)}…` : label;

export default function ShadcnChart({ spec }: ChartRendererProps) {
  const { type, labels, series } = spec;
  const doughnut = type === 'doughnut';
  const chartRows = labels.map((label, index) => ({ label, values: series.map(item => item.values[index]) }));
  const Component = type === 'bar' ? BarChart : LineChart;
  return <div className="shadcn-chart">
    <ChartContainer>{doughnut
      ? <PieChart accessibilityLayer>
          <Tooltip content={ChartTooltipContent} />
          <Pie data={labels.map((name, index) => ({ name, value: series[0].values[index], fill: color(index) }))}
            dataKey="value" nameKey="name" innerRadius="56%" outerRadius="90%" paddingAngle={1}
            stroke="var(--surface)" isAnimationActive={false} />
        </PieChart>
      : <Component data={chartRows} margin={{ top: 12, right: 16, bottom: 4, left: 4 }} accessibilityLayer>
          <CartesianGrid vertical={false} stroke="var(--border)" />
          <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={8} tickFormatter={shorten} />
          <YAxis tickLine={false} axisLine={false} width="auto" />
          <Tooltip content={ChartTooltipContent} cursor={type === 'bar' ? { fill: 'var(--soft)' } : { stroke: 'var(--muted)' }} />
          {series.map(({ name }, index) => type === 'bar'
            ? <Bar key={name} dataKey={`values.${index}`} name={name} fill={color(index)} radius={3} isAnimationActive={false} />
            : <Line key={name} dataKey={`values.${index}`} name={name} stroke={color(index)} strokeWidth={2}
                dot={labels.length < 16} isAnimationActive={false} />)}
        </Component>}
    </ChartContainer>
    <div className="shadcn-chart-legend">{(doughnut ? labels : series.map(({ name }) => name)).map((name, index) =>
      <span key={name}><i style={{ backgroundColor: color(index) }} />{name}</span>)}</div>
  </div>;
}
