import { Select } from '@streaik/themes';
import { useId } from 'react';
import type { ComponentProps } from 'react';
import { useAppTranslation } from './i18n';

export function AgentSelectField(props: ComponentProps<typeof Select>) {
  const id = useId();
  return <div className="agent-field">
    <label htmlFor={id}>{props.label}</label>
    <Select {...props} id={id} />
  </div>;
}

export function AgentExecutionField({ execution, allowProvider, onChange }: {
  execution: unknown; allowProvider?: boolean; onChange: (value: 'client' | 'server' | undefined) => void;
}) {
  const { t } = useAppTranslation();
  const provider = allowProvider && execution === 'provider';
  const value = provider ? 'provider' : execution === 'client' || execution === 'server' ? execution : 'default';
  return <AgentSelectField label={t('Execution')} value={value} options={[
    { value: 'default', label: t('Default') }, { value: 'client', label: t('Client') }, { value: 'server', label: t('Hosted') },
    ...(provider ? [{ value: 'provider', label: t('Provider') }] : []),
  ]} onValueChange={next => {
    if (next === 'default' || next === 'client' || next === 'server') onChange(next === 'default' ? undefined : next);
  }} />;
}

export function AgentSwitch({ label, checked, onChange, title, hideLabel = false }: {
  label: string; checked: boolean; onChange?: (checked: boolean) => void; title?: string; hideLabel?: boolean;
}) {
  return <label className="mcp-toggle agent-switch" title={title ?? (hideLabel ? label : undefined)}>
    <input type="checkbox" role="switch" aria-label={hideLabel ? label : undefined} checked={checked} disabled={!onChange}
      onChange={event => onChange?.(event.currentTarget.checked)} />
    {!hideLabel && <span>{label}</span>}
  </label>;
}
