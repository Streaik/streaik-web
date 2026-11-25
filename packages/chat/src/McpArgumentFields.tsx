import { useId, useLayoutEffect, useRef, useState } from 'react';
import { maxMcpArgumentLength } from './mcp';

export type McpArgumentField = { name: string; required?: boolean; description?: string };
export type SuggestMcpArgument = (argument: { name: string; value: string }, args: Record<string, string>, signal: AbortSignal) => Promise<string[]>;

const debounceMs = 500;
type Entry = [name: string, value: string];
const emptyLookup = { value: '', contextKey: '[]', siblings: [] as Entry[], delay: 0 };
type Lookup = typeof emptyLookup;

export function McpArgumentFields({ fields, busy, suggest }: {
  fields: readonly McpArgumentField[]; busy: boolean; suggest?: SuggestMcpArgument;
}) {
  const [values, setValues] = useState<Record<string, string>>({});
  const filled = Object.entries(values).filter(([, value]) => value.trim());
  return fields.map((field, index) => <ArgumentInput key={`${index}:${field.name}`} field={field}
    value={Object.hasOwn(values, field.name) ? values[field.name] : ''} autoFocus={index === 0} readOnly={busy} suggest={suggest}
    siblings={filled.filter(([name]) => name !== field.name)} onValue={value => setValues(current => ({ ...current, [field.name]: value }))} />);
}

function ArgumentInput({ field, value, siblings, autoFocus, readOnly, suggest, onValue }: {
  field: McpArgumentField; value: string; siblings: Entry[]; autoFocus: boolean; readOnly: boolean;
  suggest?: SuggestMcpArgument; onValue: (value: string) => void;
}) {
  const id = useId();
  const { name } = field;
  const [lookup, setLookup] = useState<Lookup>(emptyLookup);
  const [result, setResult] = useState<{ lookup: Lookup; options: string[] }>();
  const [show, setShow] = useState(false);
  const [active, setActive] = useState(-1);
  const activeOption = useRef<HTMLLIElement>(null);
  const composing = useRef(false);
  const contextKey = JSON.stringify(siblings);
  const current = lookup.value === value && lookup.contextKey === contextKey;
  const options = suggest && !readOnly && current && result?.lookup === lookup ? result.options : [];
  const open = show && options.length > 0;

  useLayoutEffect(() => {
    if (!suggest || readOnly || !current || result?.lookup === lookup) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      void suggest({ name, value: lookup.value }, Object.fromEntries(lookup.siblings), controller.signal)
        .catch(() => []) // Suggestions must not block typing or submitting.
        .then(options => { if (!controller.signal.aborted) setResult({ lookup, options }); });
    }, lookup.delay);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [suggest, readOnly, current, name, lookup, result]);

  useLayoutEffect(() => { activeOption.current?.scrollIntoView({ block: 'nearest' }); }, [active]);

  function search(next: string) {
    setActive(-1);
    setShow(true);
    if (suggest) setLookup(prev => prev.value === next && prev.contextKey === contextKey ? prev :
      { value: next, contextKey, siblings, delay: debounceMs });
  }

  function choose(next: string) {
    onValue(next);
    setShow(false);
    setActive(-1);
  }

  return <div className="mcp-argument-field">
    <label htmlFor={id} id={`${id}-label`}>{name}</label>
    {field.description && <small id={`${id}-description`}>{field.description}</small>}
    <input id={id} name={name} type="text" value={value} autoFocus={autoFocus} required={field.required}
      readOnly={readOnly} maxLength={maxMcpArgumentLength} aria-describedby={field.description ? `${id}-description` : undefined}
      role={suggest ? 'combobox' : undefined} autoComplete={suggest ? 'off' : undefined}
      aria-autocomplete={suggest ? 'list' : undefined} aria-expanded={suggest ? open : undefined}
      aria-controls={open ? `${id}-options` : undefined} aria-activedescendant={open && active >= 0 ? `${id}-option-${active}` : undefined}
      onFocus={() => search(value)} onBlur={() => { setShow(false); setActive(-1); }}
      onCompositionStart={() => { composing.current = true; setShow(false); }}
      onCompositionEnd={event => { composing.current = false; search(event.currentTarget.value); }}
      onChange={event => {
        const next = event.currentTarget.value;
        onValue(next);
        if (!composing.current) search(next);
      }}
      onKeyDown={event => {
        if (event.nativeEvent.isComposing || composing.current || !suggest || readOnly) return;
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          if (!options.length) { search(value); return; }
          event.preventDefault();
          setShow(true);
          setActive(index => event.key === 'ArrowDown' ? (index + 1) % options.length :
            index <= 0 ? options.length - 1 : index - 1);
        } else if (open && event.key === 'Escape') {
          event.preventDefault();
          setShow(false);
          setActive(-1);
        } else if (open && event.key === 'Enter' && active >= 0) {
          event.preventDefault();
          choose(options[active]);
        }
      }} />
    {open && <ul className="mcp-argument-suggestions" id={`${id}-options`} role="listbox" aria-labelledby={`${id}-label`}>
      {options.map((option, index) => <li key={option} role="option" id={`${id}-option-${index}`} aria-selected={active === index}
        ref={active === index ? activeOption : undefined} onMouseDown={event => event.preventDefault()}
        onClick={() => choose(option)}>{option}</li>)}
    </ul>}
  </div>;
}
