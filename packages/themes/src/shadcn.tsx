import * as RadixSelect from '@radix-ui/react-select';
import * as RadixTabs from '@radix-ui/react-tabs';
import * as RadixTooltip from '@radix-ui/react-tooltip';
import { Check, ChevronDown, ChevronUp } from 'lucide-react';
import { lazy, useCallback, useState } from 'react';
import type { CSSProperties } from 'react';
import { choices } from './contract';
import type { SelectProps, ThemeAdapter, TooltipProps } from './contract';
import { lucideIcons } from './lucideIcons';
import { groupSelectOptions } from './selectOptions';
import './shadcn.css';

const JsonViewer = lazy(() => import('./ShadcnJsonViewer'));
const parse = choices({ palette: ['neutral', 'blue', 'rose'], radius: ['default', 'sharp', 'rounded'] });
const paletteOptions = [{ value: 'neutral', label: 'Neutral' }, { value: 'blue', label: 'Blue' }, { value: 'rose', label: 'Rose' }];
const radiusOptions = [{ value: 'default', label: 'Default' }, { value: 'sharp', label: 'Sharp' }, { value: 'rounded', label: 'Rounded' }];
const colors = {
  blue: { light: ['#1d4ed8', '#ffffff', '#1d4ed8', '#eff6ff'], dark: ['#93c5fd', '#172554', '#93c5fd', '#172947'] },
  rose: { light: ['#be123c', '#ffffff', '#be123c', '#fff1f2'], dark: ['#fda4af', '#4c0519', '#fda4af', '#391823'] },
};

function Select({ label, id, className = '', value, options, onValueChange, disabled, placeholder }: SelectProps) {
  const [container, setContainer] = useState<HTMLElement | null>(null);
  const attach = useCallback((node: HTMLButtonElement | null) => {
    if (node) setContainer(node.closest('dialog') ?? node.closest('.streaik-theme'));
  }, []);
  return <RadixSelect.Root value={value} disabled={disabled} onValueChange={onValueChange}>
    <RadixSelect.Trigger id={id} aria-label={label} className={`${className} shadcn-select`} ref={attach}>
      <RadixSelect.Value placeholder={placeholder} />
      <RadixSelect.Icon asChild><ChevronDown className="shadcn-select-icon" size={16} aria-hidden="true" focusable="false" /></RadixSelect.Icon>
    </RadixSelect.Trigger>
    {container && <RadixSelect.Portal container={container}>
      <RadixSelect.Content position="popper" align="start" sideOffset={4} className="shadcn-select-content">
        <RadixSelect.ScrollUpButton className="shadcn-select-scroll" aria-hidden="true"><ChevronUp size={16} focusable="false" /></RadixSelect.ScrollUpButton>
        <RadixSelect.Viewport>
          {groupSelectOptions(options).map(({ group, items }) => {
            const children = items.map((option) => <RadixSelect.Item key={option.value} value={option.value} className="shadcn-select-item">
              <RadixSelect.ItemText>{option.label}</RadixSelect.ItemText>
              <RadixSelect.ItemIndicator aria-hidden="true"><Check size={16} focusable="false" /></RadixSelect.ItemIndicator>
            </RadixSelect.Item>);
            return group ? <RadixSelect.Group key={group.id} className="shadcn-select-group">
              <RadixSelect.Label className="shadcn-select-label">{group.label}</RadixSelect.Label>{children}
            </RadixSelect.Group> : children;
          })}
        </RadixSelect.Viewport>
        <RadixSelect.ScrollDownButton className="shadcn-select-scroll" aria-hidden="true"><ChevronDown size={16} focusable="false" /></RadixSelect.ScrollDownButton>
      </RadixSelect.Content>
    </RadixSelect.Portal>}
  </RadixSelect.Root>;
}

function Tooltip({ children, content, side }: TooltipProps) {
  const [container, setContainer] = useState<HTMLElement | null>(null);
  const [open, setOpen] = useState(false);
  const attach = useCallback((node: HTMLElement | null) => {
    if (node) setContainer(node.closest('dialog') ?? node.closest('.streaik-theme') ?? node.ownerDocument.body);
  }, []);
  return <RadixTooltip.Provider delayDuration={350}>
    <RadixTooltip.Root open={!!content && open} onOpenChange={(value) => setOpen(!!content && value)}>
      <RadixTooltip.Trigger asChild ref={attach} onFocus={event => {
        // Native dialogs remove `open` before returning focus. Skip Radix's focus hint, not focus itself.
        if (event.relatedTarget instanceof Element && event.relatedTarget.closest('dialog:not([open])')) event.preventDefault();
      }}>{children}</RadixTooltip.Trigger>
      {container && <RadixTooltip.Portal container={container}>
        <RadixTooltip.Content className="shadcn-tooltip" side={side} sideOffset={5}>{content}</RadixTooltip.Content>
      </RadixTooltip.Portal>}
    </RadixTooltip.Root>
  </RadixTooltip.Provider>;
}

export const shadcn: ThemeAdapter = {
  Chart: lazy(() => import('./charts/ShadcnChart')),
  parse,
  icons: lucideIcons,
  JsonViewer,
  Tooltip,
  TabList: ({ label, className, items, value, onValueChange }) =>
    <RadixTabs.Root className={className} data-themed-tabs="shadcn" value={value} onValueChange={onValueChange}>
      <RadixTabs.List className="shadcn-tabs-list" aria-label={label} loop>
        {items.map(item => <RadixTabs.Trigger key={item.id} id={item.id} value={item.value} aria-controls={item.panelId}
          className="shadcn-tabs-trigger">{item.icon}{item.label}</RadixTabs.Trigger>)}
      </RadixTabs.List>
    </RadixTabs.Root>,
  style: ({ preferences, scheme }) => {
    const palette = preferences.palette === 'blue' || preferences.palette === 'rose' ? colors[preferences.palette][scheme] : undefined;
    return {
      '--radius': preferences.radius === 'sharp' ? '0.15rem' : preferences.radius === 'rounded' ? '0.9rem' : '0.5rem',
      ...(palette && { '--action': palette[0], '--on-action': palette[1], '--focus': palette[2], '--soft': palette[3] }),
    } as CSSProperties;
  },
  Button: ({ scheme: _scheme, preferences: _preferences, variant, className, ...props }) => <button {...props} className={`${className} shadcn-button`} data-variant={variant} />,
  Select,
  Textarea: ({ scheme: _scheme, preferences: _preferences, className, ...props }) => <textarea {...props} className={`${className} shadcn-textarea`} />,
  Settings: ({ preferences, onChange, translate }) => <>
    <div className="appearance-row"><label htmlFor="shadcn-palette">{translate('Palette')}</label>
      <Select id="shadcn-palette" label={translate('Palette')} value={preferences.palette} options={paletteOptions.map(option => ({ ...option, label: translate(option.label) }))} onValueChange={(palette) => onChange({ ...preferences, palette })} /></div>
    <div className="appearance-row"><label htmlFor="shadcn-radius">{translate('Corner radius')}</label>
      <Select id="shadcn-radius" label={translate('Corner radius')} value={preferences.radius} options={radiusOptions.map(option => ({ ...option, label: translate(option.label) }))} onValueChange={(radius) => onChange({ ...preferences, radius })} /></div>
  </>,
};
