import { Component, Suspense, useId } from 'react';
import type { ReactNode } from 'react';
import type { ThemeAdapter, ThemeEnv } from '../contract';
import type { ChartSpec } from './spec';

export type ChartProps = { spec: ChartSpec; translate?: (text: string) => string };

class PlotBoundary extends Component<{ fallback: ReactNode; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() { return this.state.failed ? this.props.fallback : this.props.children; }
}

export function ChartFigure({ spec, translate = text => text, renderer: Plot, env }: ChartProps & {
  renderer?: ThemeAdapter['Chart']; env: ThemeEnv;
}) {
  const caption = useId();
  const dataLabel = translate('Chart data');
  const table = <div className="streaik-chart-table"><table aria-label={dataLabel}>
    <thead><tr><th scope="col">{translate('Category')}</th>{spec.series.map(({ name }) => <th key={name} scope="col">{name}</th>)}</tr></thead>
    <tbody>{spec.labels.map((label, index) => <tr key={label}><th scope="row">{label}</th>
      {spec.series.map(({ name, values }) => <td key={name}>{values[index]}</td>)}</tr>)}</tbody>
  </table></div>;
  const loading = <div className="streaik-chart-loading" role="status">{translate('Loading chart…')}</div>;
  return <figure className="streaik-chart" aria-label={spec.title ? undefined : translate('Chart')} aria-labelledby={spec.title ? caption : undefined}>
    {spec.title && <figcaption id={caption}>{spec.title}</figcaption>}
    {Plot ? <PlotBoundary fallback={table}>
      <Suspense fallback={loading}>
        <Plot spec={spec} {...env} />
        <details><summary>{dataLabel}</summary>{table}</details>
      </Suspense>
    </PlotBoundary> : loading}
  </figure>;
}
