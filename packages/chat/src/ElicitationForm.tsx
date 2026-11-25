import { Button } from '@streaik/themes';
import { useId, useState } from 'react';
import type { ElicitRequestFormParams, ElicitResult } from '@modelcontextprotocol/client';
import { elicitationDefaults, elicitationFields, validateElicitation } from './elicitation';
import { useAppTranslation } from './i18n';

type Value = NonNullable<ElicitResult['content']>[string];

// This component deals only with form data; callers own the request and transport.
export function ElicitationForm({ request, onAnswer }: { request: ElicitRequestFormParams; onAnswer: (result: ElicitResult) => void }) {
  const { t } = useAppTranslation();
  const id = useId();
  const [fields] = useState(() => elicitationFields(request.requestedSchema));
  const [values, setValues] = useState(() => elicitationDefaults(fields));
  const [submitted, setSubmitted] = useState(false);
  const { content, errors } = validateElicitation(fields, values);
  const missingSchema = request.requestedSchema.required?.some(name => !Object.hasOwn(request.requestedSchema.properties, name));
  function set(name: string, value?: Value) {
    setValues(current => {
      const next = new Map(current);
      if (value === undefined) next.delete(name); else next.set(name, value);
      return next;
    });
  }

  return <form className="elicitation-form" noValidate autoComplete="off" onSubmit={event => {
    event.preventDefault();
    setSubmitted(true);
    if (!missingSchema && !errors.size) onAnswer({ action: 'accept', content });
  }}>
    <p className="elicitation-message">{request.message}</p>
    {fields.map(({ name, property, required, options }, index) => {
      const fieldId = `${id}-${index}`;
      const value = values.get(name);
      const error = submitted && errors.get(name);
      const descriptionId = property.description ? `${fieldId}-description` : undefined;
      const errorId = error ? `${fieldId}-error` : undefined;
      const accessibility = { 'aria-describedby': [descriptionId, errorId].filter(Boolean).join(' ') || undefined,
        'aria-invalid': error ? true : undefined };
      const title = property.title || name;
      const description = property.description && <small id={descriptionId}>{property.description}</small>;
      const validation = error && <small id={errorId} className="chat-error" role="alert">{t(error === 'required' ? 'This field is required.' : 'Enter a valid value.')}</small>;
      if (property.type === 'array') {
        const selected = Array.isArray(value) ? value : [];
        return <fieldset key={name} className="elicitation-field" {...accessibility}>
          <legend>{title}{required && ' *'}</legend>{description}
          {options?.map((option, i) => <label key={i} className="elicitation-choice">
            <input type="checkbox" checked={selected.includes(option.const)} onChange={event => {
              const next = event.currentTarget.checked ? [...selected, option.const] : selected.filter(item => item !== option.const);
              set(name, next.length || required || property.default !== undefined ? next : undefined);
            }} />{option.title}
          </label>)}
          {required && value === undefined && (property.minItems ?? 0) === 0 &&
            <Button type="button" variant="subtle" onClick={() => set(name, [])}>{t('Use empty selection')}</Button>}
          {validation}
        </fieldset>;
      }
      const inputType = 'format' in property && property.format !== 'date-time' ?
        (property.format === 'uri' ? 'url' : property.format) : undefined;
      return <div key={name} className="elicitation-field">
        <label htmlFor={fieldId}>{title}{required && ' *'}</label>{description}
        {options ? <select id={fieldId} required={required} {...accessibility} value={String(options.findIndex(option => option.const === value))}
          onChange={event => set(name, options[Number(event.currentTarget.value)]?.const)}>
          <option value="-1">{t('Select an option')}</option>
          {options.map((option, i) => <option key={i} value={i}>{option.title}</option>)}
        </select> : property.type === 'boolean' ? <select id={fieldId} required={required} {...accessibility} value={value === undefined ? '' : String(value)}
          onChange={event => set(name, event.currentTarget.value ? event.currentTarget.value === 'true' : undefined)}>
          <option value="">{t('Select an option')}</option><option value="true">{t('Yes')}</option><option value="false">{t('No')}</option>
        </select> : <input id={fieldId} type={inputType ?? 'text'}
          inputMode={property.type === 'integer' || property.type === 'number' ? 'decimal' : undefined}
          placeholder={'format' in property && property.format === 'date-time' ? '2026-07-28T12:00:00Z' : undefined}
          required={required} {...accessibility} value={value === undefined ? '' : String(value)}
          onChange={event => set(name, event.currentTarget.value || undefined)} />}
        {validation}
      </div>;
    })}
    {missingSchema && <p role="alert" className="chat-error">{t('This form cannot be completed.')}</p>}
    <footer className="chat-tool-footer">
      <Button type="button" variant="subtle" onClick={() => onAnswer({ action: 'cancel' })}>{t('Cancel')}</Button>
      <Button type="button" onClick={() => onAnswer({ action: 'decline' })}>{t('Decline')}</Button>
      <Button type="submit" variant="primary" disabled={missingSchema}>{t('Accept')}</Button>
    </footer>
  </form>;
}
