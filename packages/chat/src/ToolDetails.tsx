import { JsonViewer } from '@streaik/themes';
import { useId, useState } from 'react';
import type { ReactNode } from 'react';
import { DialogTabs } from './DialogTabs';
import { useAppTranslation } from './i18n';
import type { describeToolOutput } from './toolOutputContent';

export function ToolValue({ value }: { value: unknown }) {
  const { t } = useAppTranslation();
  return value !== null && typeof value === 'object' ? <JsonViewer value={value} />
    : <pre className="chat-tool-value">{value === undefined ? t('No data.') : String(value)}</pre>;
}

type Tab = 'input' | 'structured' | 'text' | 'images' | 'output';

export function ToolDetails({ input, result, mode = 'activity' }: {
  input: unknown; result?: ReturnType<typeof describeToolOutput>; mode?: 'activity' | 'result' | 'execution';
}) {
  const { t } = useAppTranslation();
  const id = useId();
  const [selected, select] = useState<Tab>();
  const panels: [Tab, string, ReactNode][] = [];
  if (input !== undefined || mode !== 'activity') panels.push(['input', t('Input'), <ToolValue value={input} />]);
  if (result?.structured) panels.push(['structured', t('Structured'), <ToolValue value={result.structured} />]);
  if (result?.text?.length) panels.push(['text', t('Text'), <ToolValue value={result.text.join('\n\n')} />]);
  if (result?.images?.length) panels.push(['images', t('Images'), <div className="chat-tool-images">
    {result.images.map((src, index) => <img className="chat-mcp-image" key={index} src={src} decoding="async"
      alt={t('MCP image {{index, number}}', { index: index + 1 })} />)}
  </div>]);
  const hasOutput = result?.output !== undefined;
  if (hasOutput) panels.push(['output', t('Output'), <ToolValue value={result.output} />]);

  const initial = mode === 'result' ? (hasOutput ? 'output' : panels.find(([key]) => key !== 'input')?.[0]) : undefined;
  const active = panels.some(([key]) => key === selected) ? selected : initial ?? panels[0]?.[0];
  if (!active) return null;
  return <div className="chat-tool-details">
    {mode === 'result' && result?.isError && <p className="chat-tool-error">{t('Tool returned an error.')}</p>}
    <DialogTabs id={id} label={t('Tool details')} tabs={panels.map(([key, label]) => [key, label])} value={active} onChange={select} />
    {panels.map(([key, , content]) => <div key={key} id={`${id}-${key}-panel`} className="chat-tool-panel" role="tabpanel" tabIndex={0}
      aria-labelledby={`${id}-${key}-tab`} hidden={key !== active}>{key === active ? content : null}</div>)}
  </div>;
}
