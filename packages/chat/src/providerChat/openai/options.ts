import type { NativeOptions, NativeValue } from '../settings.ts';

export const list = (value?: NativeValue): readonly NativeValue[] => Array.isArray(value) ? value : [];
export const object = (value?: NativeValue): NativeOptions =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as NativeOptions : {};
export const typedItem = (value: NativeValue | undefined, type: string) =>
  list(value).map(object).find(item => item.type === type);

// Edit a native list in place without reordering other entries or dropping types a newer provider supports.
export function updateTypedItem(value: NativeValue | undefined, type: string, next?: NativeOptions) {
  const items = list(value);
  const replacement = next && { ...next, type };
  const index = items.findIndex(item => object(item).type === type);
  const updated = index === -1 ? (replacement ? [...items, replacement] : items)
    : replacement ? items.map((item, i) => i === index ? replacement : item) : items.filter((_, i) => i !== index);
  return updated.length ? updated : undefined;
}

export function toggleInclude(value: NativeValue | undefined, key: string, enabled: boolean) {
  const entries = list(value).filter(item => item !== key);
  return enabled ? [...entries, key] : entries.length ? entries : undefined;
}

export const efforts = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'];
export const summaries = ['auto', 'concise', 'detailed'];
export const tiers = ['auto', 'default', 'flex', 'scale', 'priority', 'fast', 'ultrafast'];
