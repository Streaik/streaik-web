import type { CSSProperties } from 'react';
import { cloneElement } from 'react';
import { choices } from './contract';
import type { ThemeAdapter } from './contract';
import { lucideIcons } from './lucideIcons';
import { nativeSelectOptions } from './selectOptions';
import './html.css';

const size = ['normal', 'large', 'larger'] as const;
const parse = choices({ textSize: size });

export const html: ThemeAdapter = {
  parse,
  Tooltip: ({ children, content }) => cloneElement(children, { title: content }),
  icons: lucideIcons,
  style: ({ preferences }) => ({ '--streaik-chat-text-size': preferences.textSize === 'larger' ? '1.25rem' : preferences.textSize === 'large' ? '1.125rem' : '1rem' } as CSSProperties),
  Button: ({ scheme: _scheme, preferences: _preferences, variant, ...props }) => <button {...props} data-html-variant={variant} />,
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
