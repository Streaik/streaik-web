import { Select } from '@streaik/themes';
import { useId } from 'react';
import type { ComponentProps } from 'react';

export function AgentSelectField(props: ComponentProps<typeof Select>) {
  const id = useId();
  return <div className="agent-field">
    <label htmlFor={id}>{props.label}</label>
    <Select {...props} id={id} />
  </div>;
}

export function AgentSwitch({ label, checked, onChange, title }: {
  label: string; checked: boolean; onChange?: (checked: boolean) => void; title?: string;
}) {
  return <label className="mcp-toggle agent-switch" title={title}>
    <input type="checkbox" role="switch" checked={checked} disabled={!onChange} onChange={event => onChange?.(event.currentTarget.checked)} />
    <span>{label}</span>
  </label>;
}
