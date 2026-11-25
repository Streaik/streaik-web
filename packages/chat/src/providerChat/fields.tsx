import type { ChatModel } from '@streaik/gateway';
import { useId, useState } from 'react';
import type { ReactNode } from 'react';
import { useAppTranslation } from '../i18n';
import type { NativeOptions, NativeValue } from './settings';

export type ProviderFormProps = { value: NativeOptions; onChange: (value: NativeOptions) => void; models: readonly ChatModel[] };
export type OptionsEditor = Pick<ProviderFormProps, 'value' | 'onChange'>;

export function setOption(value: NativeOptions, key: string, next?: NativeValue): NativeOptions {
  const { [key]: _old, ...rest } = value;
  return next === undefined ? rest : { ...rest, [key]: next };
}

export function Card({ title, children }: { title: string; children: ReactNode }) {
  const { t } = useAppTranslation();
  return <section className="chat-tool-card"><h3>{t(title)}</h3>{children}</section>;
}

type Field = { label: string; value?: NativeValue; disabled?: boolean };
const asText = (value?: NativeValue) => typeof value === 'string' ? value : '';

export function Choice({ label, value, choices, onChange, disabled }: Field & {
  choices: readonly string[] | Readonly<Record<string, string>>; onChange: (value?: string) => void;
}) {
  const { t } = useAppTranslation();
  const id = useId();
  const pairs = Array.isArray(choices) ? choices.map(key => [key, key]) : Object.entries(choices);
  const current = typeof value === 'boolean' ? String(value) : asText(value);
  return <div className="chat-provider-select"><label htmlFor={id}>{t(label)}</label>
    <select id={id} value={current} disabled={disabled} onChange={event => onChange(event.currentTarget.value || undefined)}>
      <option value="">{t('Provider default')}</option>
      {current && !pairs.some(([key]) => key === current) && <option value={current}>{current}</option>}
      {pairs.map(([key, name]) => <option value={key} key={key}>{t(name)}</option>)}
    </select></div>;
}

export function Toggle({ label, checked, onChange, disabled }: {
  label: string; checked: boolean; onChange: (value: boolean) => void; disabled?: boolean;
}) {
  const { t } = useAppTranslation();
  return <label className="chat-provider-switch"><input type="checkbox" role="switch" checked={checked} disabled={disabled}
    onChange={event => onChange(event.currentTarget.checked)} />{t(label)}</label>;
}

export function Integer({ label, value, min, max, onChange, disabled }: Field & { min?: number; max?: number; onChange: (value?: number) => void }) {
  const { t } = useAppTranslation();
  const [input, setInput] = useState<string>();
  return <label>{t(label)}<input type="number" step={1} min={min} max={max} disabled={disabled}
    value={input ?? (typeof value === 'number' ? value : '')} onBlur={() => setInput(undefined)} onChange={event => {
      const { value, valueAsNumber, validity } = event.currentTarget;
      setInput(value);
      if (!value && !validity.badInput) onChange();
      else if (validity.valid && Number.isSafeInteger(valueAsNumber)) onChange(valueAsNumber);
    }} /></label>;
}

export function Text({ label, value, multiline, onChange, disabled }: Field & { multiline?: boolean; onChange: (value?: string) => void }) {
  const { t } = useAppTranslation();
  const props = { value: asText(value), disabled, onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    onChange(event.currentTarget.value || undefined) };
  return <label>{t(label)}{multiline ? <textarea rows={3} {...props} /> : <input type="text" {...props} />}</label>;
}

export function ListField({ label, value, onChange }: Field & { onChange: (value?: string[]) => void }) {
  const { t } = useAppTranslation();
  const [draft, setDraft] = useState<string>();
  const list = Array.isArray(value) ? value.filter(item => typeof item === 'string') : [];
  return <label>{t(label)}<textarea rows={3} value={draft ?? list.join('\n')} onBlur={() => setDraft(undefined)} onChange={event => {
    const input = event.currentTarget.value;
    setDraft(input);
    const lines = [...new Set(input.split(/[\n,]/).map(line => line.trim()).filter(Boolean))];
    onChange(lines.length ? lines : undefined);
  }} /></label>;
}

export function ParallelCalls({ value, onChange }: OptionsEditor) {
  return <Choice label="Parallel tool calls" value={value.parallel_tool_calls} choices={{ true: 'Enabled', false: 'Disabled' }}
    onChange={next => onChange(setOption(value, 'parallel_tool_calls', next === undefined ? undefined : next === 'true'))} />;
}
