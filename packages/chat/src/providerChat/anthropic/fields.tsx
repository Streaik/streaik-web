import { useId, useState } from 'react';
import type { ReactNode } from 'react';
import { useAppTranslation } from '../../i18n';
import { Card, Choice, setOption, Toggle } from '../fields';
import type { OptionsEditor } from '../fields';
import { nativeObject } from '../settings';
import type { NativeOptions, NativeValue } from '../settings';

export const object = (value: unknown) => nativeObject(value) ?? {};
export const array = (value: NativeValue | undefined): readonly NativeValue[] => Array.isArray(value) ? value : [];
export const cacheTtls = { '5m': '5 minutes', '1h': '1 hour' };
export const booleanOptions = { true: 'Enabled', false: 'Disabled' };

export function section({ value, onChange }: OptionsEditor, key: string): OptionsEditor {
  return { value: object(value[key]), onChange: next => onChange(setOption(value, key, Object.keys(next).length ? next : undefined)) };
}

export function edit({ value, onChange }: OptionsEditor, key: string) {
  return (next?: NativeValue) => onChange(setOption(value, key, next));
}

export function OptionalCard({ title, enabled, onToggle, children, disabled }: {
  title: string; enabled: boolean; onToggle: (enabled: boolean) => void; children?: ReactNode; disabled?: boolean;
}) {
  return <Card title={title}>
    <Toggle label={`Enable ${title}`} checked={enabled} onChange={onToggle} disabled={disabled} />
    {enabled && children}
  </Card>;
}

export function BooleanChoice({ label, value, onChange }: { label: string; value?: NativeValue; onChange: (value?: boolean) => void }) {
  return <Choice label={label} choices={booleanOptions} value={value} onChange={next => onChange(next === undefined ? undefined : next === 'true')} />;
}

export function CacheFields({ value, onChange, title, initial = {} }: OptionsEditor & { title: string; initial?: NativeOptions }) {
  const cache = nativeObject(value.cache_control);
  return <OptionalCard title={title} enabled={!!cache} onToggle={enabled => onChange(setOption(value, 'cache_control',
    enabled ? { ...initial, type: 'ephemeral' } : undefined))}>
    <Choice label="Cache duration" value={cache?.ttl} choices={cacheTtls}
      onChange={ttl => onChange(setOption(value, 'cache_control', setOption({ type: 'ephemeral', ...cache }, 'ttl', ttl)))} />
  </OptionalCard>;
}

export function JsonField({ label, value, onChange, shape }: {
  label: string; value?: NativeValue; onChange: (value?: NativeValue) => void; shape: 'object' | 'array';
}) {
  const { t } = useAppTranslation();
  const id = useId();
  const [draft, setDraft] = useState<string>();
  const [invalid, setInvalid] = useState(false);
  return <label>{t(label)}<textarea rows={4} aria-invalid={invalid} aria-describedby={invalid ? id : undefined}
    value={draft ?? (value === undefined ? '' : JSON.stringify(value, null, 2))}
    onBlur={() => { if (!invalid) setDraft(undefined); }} onChange={event => {
      const input = event.currentTarget.value;
      setDraft(input);
      try {
        const parsed = input.trim() ? JSON.parse(input) as NativeValue : undefined;
        if (parsed !== undefined && !(shape === 'array' ? Array.isArray(parsed) : nativeObject(parsed))) {
          setInvalid(true);
          return;
        }
        setInvalid(false);
        onChange(parsed);
      } catch { setInvalid(true); }
    }} />{invalid && <span id={id} role="alert">{t(shape === 'array' ? 'Enter a valid JSON array.' : 'Enter a valid JSON object.')}</span>}</label>;
}
