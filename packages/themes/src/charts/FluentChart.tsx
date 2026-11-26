// Fluent Charts 9.3.30 imports @fluentui/react-menu without declaring it in its manifest.
import { DataVizPalette, DonutChart, GroupedVerticalBarChart, LineChart, getColorFromToken } from '@fluentui/react-charts';
import { useState } from 'react';
import type { ChartRendererProps } from '../contract';

const palette = [DataVizPalette.color1, DataVizPalette.color2, DataVizPalette.color3, DataVizPalette.color4,
  DataVizPalette.color5, DataVizPalette.color6, DataVizPalette.color7, DataVizPalette.color8];

export default function FluentChart({ spec, scheme }: ChartRendererProps) {
  const [parentRef, setParent] = useState<HTMLDivElement | null>(null);
  const { type, labels, series } = spec;
  const color = (index: number) => getColorFromToken(palette[index % palette.length], scheme === 'dark');
  const shared = { parentRef, height: 288 };
  const yMinValue = Math.min(0, ...series.flatMap(item => item.values));
  const ticks = labels.map((_, index) => index);
  return <div ref={setParent} className="streaik-fluent-chart">
    {parentRef && (type === 'bar' ? <GroupedVerticalBarChart {...shared} yMinValue={yMinValue} barWidth="auto" roundCorners
      data={labels.map((name, index) => ({ name, series: series.map(({ name: legend, values }, i) => ({
        key: `series-${i}`, legend, data: values[index], color: color(i), xAxisCalloutData: name,
      })) }))} />
      : type === 'line' ? <LineChart {...shared} yMinValue={yMinValue} strokeWidth={2.5} allowMultipleShapesForPoints
        tickValues={ticks.filter(index => index % Math.ceil(labels.length / 8) === 0 || index === labels.length - 1)}
        tickFormat={index => labels[Number(index)] ?? ''} data={{ lineChartData: series.map(({ name, values }, i) => ({
          legend: name, color: color(i), data: values.map((y, x) => ({ x, y, xAxisCalloutData: labels[x] })),
        })) }} />
        : <DonutChart {...shared} innerRadius={70} data={{ chartData: labels.map((legend, index) => ({
          legend, data: series[0].values[index], color: color(index),
        })) }} />)}
  </div>;
}
