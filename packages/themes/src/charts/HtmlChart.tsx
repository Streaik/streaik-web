import {
  ArcElement, BarController, BarElement, CategoryScale, Chart as ChartJS, DoughnutController, Legend,
  LineController, LineElement, LinearScale, PointElement, Tooltip,
} from 'chart.js';
import type { ChartData, ChartOptions } from 'chart.js';
import { Chart } from 'react-chartjs-2';
import type { ChartRendererProps } from '../contract';

ChartJS.register(ArcElement, BarController, BarElement, CategoryScale, DoughnutController, Legend,
  LineController, LineElement, LinearScale, PointElement, Tooltip);

const colors = {
  light: ['#2563eb', '#0f766e', '#b45309', '#a21caf', '#be123c', '#4d7c0f', '#4338ca', '#0369a1'],
  dark: ['#60a5fa', '#2dd4bf', '#fbbf24', '#e879f9', '#fb7185', '#a3e635', '#a5b4fc', '#38bdf8'],
};

export default function HtmlChart({ spec, scheme }: ChartRendererProps) {
  const { type, labels, series } = spec;
  const pie = type === 'doughnut';
  const palette = colors[scheme];
  const color = (index: number) => palette[index % palette.length];
  const ink = scheme === 'dark' ? '#e4e4e7' : '#3f3f46';
  const grid = scheme === 'dark' ? '#303036' : '#e4e4e7';
  const data: ChartData<typeof type, number[], string> = {
    labels: [...labels],
    datasets: series.map(({ name, values }, index) => ({
      label: name, data: [...values], backgroundColor: pie ? labels.map((_, i) => color(i)) : color(index),
      borderColor: pie ? (scheme === 'dark' ? '#0b0b0d' : '#ffffff') : color(index), borderWidth: 2, borderRadius: 4,
    })),
  };
  const options: ChartOptions<typeof type> = {
    responsive: true, maintainAspectRatio: false, animation: false,
    plugins: { legend: { position: 'bottom', labels: { color: ink, boxWidth: 10, padding: 14 } } },
    ...(!pie && { scales: { x: { grid: { display: false }, ticks: { color: ink, maxRotation: 0 } },
      y: { grid: { color: grid }, ticks: { color: ink }, beginAtZero: type === 'bar' } } }),
  };
  return <div className="streaik-chart-plot"><Chart key={type} type={type} data={data} options={options}
    role="img" aria-label={spec.title ?? 'Chart'} /></div>;
}
