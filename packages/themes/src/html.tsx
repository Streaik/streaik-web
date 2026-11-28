import type { CSSProperties } from 'react';
import { cloneElement } from 'react';
import { choices } from './contract';
import type { ThemeAdapter } from './contract';
import { lucideIcons } from './lucideIcons';
import { nativeSelectOptions } from './selectOptions';
import { tabIndexForKey } from './tabNavigation';
import './html.css';

const size = ['normal', 'large', 'larger'] as const;
const parse = choices({ textSize: size });

export const html: ThemeAdapter = {
  Chart: lazy(() => import('./charts/HtmlChart')),
  parse,
  Tooltip: ({ children, content }) => cloneElement(children, { title: content }),
  TabList: ({ label, className, items, value, onValueChange }) => <div className={className} role="tablist" aria-label={label}>
    {items.map((item, index) => <button key={item.id} id={item.id} type="button" role="tab" aria-controls={item.panelId}
      aria-selected={value === item.value} tabIndex={value === item.value ? 0 : -1}
      onClick={() => onValueChange(item.value)} onKeyDown={event => {
        const next = tabIndexForKey(event.key, index, items.length);
        if (next === undefined) return;
        event.preventDefault();
        onValueChange(items[next].value);
        event.currentTarget.ownerDocument.getElementById(items[next].id)?.focus();
      }}>{item.icon}{item.label}</button>)}
  </div>,
  icons: lucideIcons,
  style: ({ preferences }) => ({ '--streaik-chat-text-size': preferences.textSize === 'larger' ? '1.25rem' : preferences.textSize === 'large' ? '1.125rem' : '1rem' } as CSSProperties),
  Button: ({ scheme: _scheme, preferences: _preferences, variant, ...props }) => <button {...props} data-html-variant={variant} />,
  Switch: ({ scheme: _scheme, preferences: _preferences, onCheckedChange, ...props }) =>
    <input {...props} type="checkbox" onChange={event => onCheckedChange?.(event.currentTarget.checked)} />,
  Select: ({ label, id, className, value, options, onValueChange, disabled, placeholder }) => <select id={id} aria-label={label} className={className}
    value={value} disabled={disabled} onChange={(event) => onValueChange(event.currentTarget.value)}>
    {value === '' && <option value="" disabled>{placeholder}</option>}
    {nativeSelectOptions(options)}
  </select>,
  Textarea: ({ scheme: _scheme, preferences: _preferences, ...props }) => <textarea {...props} />,
  Settings: ({ preferences, onChange, translate }) => <div className="appearance-row">
    <label htmlFor="html-size">{translate('Chat text size')}</label>
    <select id="html-size" value={preferences.textSize} onChange={(event) => onChange({ textSize: event.currentTarget.value })}>
      <option value="normal">{translate('Normal')}</option><option value="large">{translate('Large')}</option><option value="larger">{translate('Larger')}</option>
    </select>
  </div>,
};
import { lazy } from 'react';
