import { autoUpdate, flip, offset, shift, size, useFloating } from '@floating-ui/react-dom';
import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import type { ComponentType } from 'react';
import type { IconSet, MultiSelectProps, SelectOption, SelectProps, SelectSearch, TooltipProps } from './contract';
import { groupSelectOptions } from './selectOptions';
import './searchableSelect.css';

type Props = (SelectProps | MultiSelectProps) & {
  search: SelectSearch; icons: Pick<IconSet, 'check' | 'chevronDown' | 'search'>; Tooltip: ComponentType<TooltipProps>;
};
const gutter = 8;
// An option may share its selected value with a row in another group.
const rowKey = ({ group, value }: SelectOption) => JSON.stringify([group?.id, value]);

export function SearchableSelect(props: Props) {
  const { label, id, className, options, disabled, placeholder, search, icons, multiple, Tooltip } = props;
  const baseId = useId();
  const listId = `${baseId}-list`;
  const popupId = `${baseId}-popup`;
  const [expanded, setExpanded] = useState(false);
  const [query, setQuery] = useState('');
  const [activeKey, setActiveKey] = useState<string>();
  const root = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const open = expanded && !disabled;

  const { refs, floatingStyles, isPositioned } = useFloating<HTMLButtonElement>({
    open, placement: 'bottom-start', strategy: 'fixed', whileElementsMounted: autoUpdate,
    middleware: [offset(4), flip({ padding: gutter }), shift({ padding: gutter }), size({
      padding: gutter,
      apply({ availableWidth, availableHeight, rects, elements }) {
        const style = elements.floating.style;
        style.setProperty('--picker-width', `${Math.min(availableWidth, rects.reference.width)}px`);
        style.setProperty('--picker-max-width', `${availableWidth}px`);
        style.setProperty('--picker-max-height', `${availableHeight}px`);
      },
    })],
  });

  const selectedValues = new Set(multiple ? props.value : [props.value]);
  const selected = [...new Map(options.filter(option => selectedValues.has(option.value))
    .map(option => [option.value, option])).values()];
  const summary = multiple && selected.length > 1
    ? props.selectionSummary ?? selected.map(({ label }) => label).join(', ') : selected[0]?.label;
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const sections = open ? groupSelectOptions(terms.length ? options.filter(({ label, value, group }) => {
    const fields = [label, value, group?.label ?? '', group?.id ?? ''].map(text => text.toLowerCase());
    return terms.every(term => fields.some(field => field.includes(term)));
  }) : options) : [];
  const visible = sections.flatMap(({ items }) => items);
  const active = visible.find(option => rowKey(option) === activeKey) ?? (terms.length ? visible[0] : undefined);
  const optionIndices = new Map(open ? options.map((option, index) => [option, index] as const) : []);
  const optionId = (option: SelectOption) => `${baseId}-option-${optionIndices.get(option)}`;
  const activeId = active && optionId(active);
  const { check: Check, chevronDown: Chevron, search: Search } = icons;

  function close(restoreFocus = false) {
    setExpanded(false);
    setQuery('');
    setActiveKey(undefined);
    if (restoreFocus) refs.reference.current?.focus({ preventScroll: true });
  }

  function choose(option: SelectOption) {
    if (props.multiple) {
      props.onValueChange(selectedValues.has(option.value)
        ? props.value.filter(value => value !== option.value) : [...props.value, option.value]);
      setActiveKey(rowKey(option));
      input.current?.focus({ preventScroll: true });
      return;
    }
    close(true);
    if (option.value !== props.value) props.onValueChange(option.value);
    else if (search.allowDeselect) props.onValueChange('');
  }

  useEffect(() => {
    if (disabled && expanded) close();
  }, [disabled, expanded]);

  useEffect(() => {
    if (!open) return;
    const owner = root.current?.ownerDocument;
    const dismiss = (event: PointerEvent) => {
      if (event.target instanceof Node && !root.current?.contains(event.target)) close();
    };
    owner?.addEventListener('pointerdown', dismiss, true);
    return () => owner?.removeEventListener('pointerdown', dismiss, true);
  }, [open]);

  useLayoutEffect(() => {
    if (open && isPositioned) input.current?.focus({ preventScroll: true });
  }, [open, isPositioned]);

  useLayoutEffect(() => {
    const scroll = list.current;
    const row = activeId ? scroll?.ownerDocument.getElementById(activeId) : undefined;
    if (!isPositioned || !scroll || !row) return;
    // Scroll only the options, not the dialog or page containing the picker.
    const viewport = scroll.getBoundingClientRect();
    const bounds = row.getBoundingClientRect();
    if (bounds.top < viewport.top) scroll.scrollTop += bounds.top - viewport.top;
    else if (bounds.bottom > viewport.bottom) scroll.scrollTop += bounds.bottom - viewport.bottom;
  }, [activeId, isPositioned]);

  return <div ref={root} className="ui-searchable-select" onBlur={(event) => {
    if (open && event.relatedTarget && !event.currentTarget.contains(event.relatedTarget)) close();
  }}>
    <Tooltip content={open ? undefined : summary} visualOnly><button ref={refs.setReference} id={id} type="button" className={`ui-searchable-trigger ${className ?? ''}`}
      aria-label={label} aria-describedby={`${baseId}-value`} aria-haspopup="dialog" aria-expanded={open}
      aria-controls={open ? popupId : undefined} disabled={disabled}
      onClick={() => { if (open) close(true); else setExpanded(true); }} onKeyDown={(event) => {
        if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
        event.preventDefault();
        const ordered = groupSelectOptions(options).flatMap(({ items }) => items);
        const next = event.key === 'ArrowDown' ? ordered[0] : ordered.at(-1);
        setActiveKey(next && rowKey(next));
        setExpanded(true);
        if (open) input.current?.focus({ preventScroll: true });
      }}>
      <span id={`${baseId}-value`}>{summary ?? placeholder ?? label}</span>
      <Chevron width={16} height={16} aria-hidden="true" focusable="false" />
    </button></Tooltip>
    {open && <div ref={refs.setFloating} style={floatingStyles} className="ui-searchable-popup" id={popupId}
      role="dialog" aria-label={label} data-positioned={isPositioned} onKeyDown={(event) => {
        if (event.nativeEvent.isComposing) return;
        if (event.key === 'Escape' || (event.key === 'Tab' && event.shiftKey)) {
          event.preventDefault();
          event.stopPropagation();
          close(true);
        } else if (event.key === 'Tab') {
          // Let the browser advance focus before removing the focused input.
          window.setTimeout(() => close(), 0);
        }
      }}>
      <div className="ui-searchable-field">
        <Search width={16} height={16} aria-hidden="true" focusable="false" />
        <input ref={input} role={multiple ? 'searchbox' : 'combobox'} aria-label={search.label ?? `Search ${label.toLowerCase()}`}
          aria-controls={listId} aria-expanded={multiple ? undefined : true}
          aria-autocomplete={multiple ? undefined : 'list'} aria-activedescendant={activeId}
          autoComplete="off" value={query} placeholder={search.placeholder ?? 'Search…'} onChange={(event) => {
            setQuery(event.currentTarget.value);
            setActiveKey(undefined);
            if (list.current) list.current.scrollTop = 0;
          }} onKeyDown={(event) => {
            if (event.nativeEvent.isComposing) return;
            if (event.key === 'Enter') {
              event.preventDefault();
              if (active) choose(active);
            } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
              event.preventDefault();
              const index = active ? visible.indexOf(active) : -1;
              const next = event.key === 'ArrowDown' ? Math.min(index + 1, visible.length - 1)
                : index < 0 ? visible.length - 1 : Math.max(0, index - 1);
              const nextOption = visible[next];
              setActiveKey(nextOption && rowKey(nextOption));
            }
          }} />
      </div>
      <div ref={list} id={listId} role="listbox" aria-label={label} aria-multiselectable={multiple || undefined}
        className="ui-searchable-list" tabIndex={-1}
        onMouseDown={(event) => { if (event.target !== event.currentTarget) event.preventDefault(); }}>
        {sections.map(({ group, items }) => <div key={group ? `group:${group.id}` : 'ungrouped'}
          role={group ? 'group' : 'presentation'} aria-label={group?.label} className="ui-searchable-section">
          {group && <div className="ui-searchable-heading" aria-hidden="true">{group.label}</div>}
          {items.map(option => {
            const checked = selectedValues.has(option.value);
            return <Tooltip key={option.value} content={option.label} visualOnly><div id={optionId(option)} role="option" aria-selected={checked}
              data-active={option === active || undefined} className="ui-searchable-option" onClick={() => choose(option)}>
              <span className="ui-searchable-check" aria-hidden="true">{checked && <Check width={16} height={16} focusable="false" />}</span>
              <span>{option.label}</span>
            </div></Tooltip>;
          })}
        </div>)}
      </div>
      {!visible.length && <div className="ui-searchable-empty" role="status">{search.emptyMessage ?? 'No matches found.'}</div>}
    </div>}
  </div>;
}
