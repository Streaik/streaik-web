import type { SelectGroup, SelectOption } from './contract';

export function groupSelectOptions(options: readonly SelectOption[]) {
  const sections = new Map<string | undefined, { group?: SelectGroup; items: SelectOption[] }>();
  for (const option of options) {
    const key = option.group?.id;
    const section = sections.get(key);
    if (section) section.items.push(option);
    else sections.set(key, { group: option.group, items: [option] });
  }
  return [...sections.values()];
}

export function nativeSelectOptions(options: readonly SelectOption[]) {
  return groupSelectOptions(options).map(({ group, items }) => {
    const children = items.map(({ value, label }) => <option key={value} value={value}>{label}</option>);
    return group ? <optgroup key={group.id} label={group.label}>{children}</optgroup> : children;
  });
}
