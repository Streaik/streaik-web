import type { ElicitRequestFormParams, ElicitResult } from '@modelcontextprotocol/client';

type Schema = ElicitRequestFormParams['requestedSchema'];
type Property = Schema['properties'][string];
type Value = NonNullable<ElicitResult['content']>[string];
type Option = { const: string; title: string };
export type ElicitationFields = { name: string; property: Property; required: boolean; options?: readonly Option[] }[];
export type ElicitationSource = { title: string; origin: string };
export type RequestElicitation = (request: ElicitRequestFormParams, source: ElicitationSource, signal: AbortSignal) => Promise<ElicitResult>;

function choices(property: Property): Option[] | undefined {
  if (property.type === 'array') return 'anyOf' in property.items ? property.items.anyOf
    : property.items.enum.map(value => ({ const: value, title: value }));
  if ('oneOf' in property) return property.oneOf;
  if ('enum' in property) return property.enum.map((value, index) => ({ const: value,
    title: ('enumNames' in property ? property.enumNames?.[index] : undefined) ?? value }));
}

export function elicitationFields(schema: Schema): ElicitationFields {
  const required = new Set(schema.required);
  return Object.entries(schema.properties).map(([name, property]) => ({ name, property, required: required.has(name), options: choices(property) }));
}

function validDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const time = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value;
}

function validText(property: Extract<Property, { format?: unknown }>, value: string) {
  const length = [...value].length;
  if (length < (property.minLength ?? 0) || length > (property.maxLength ?? Infinity)) return false;
  switch (property.format) {
    case 'email': return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
    case 'uri': return !/\s/.test(value) && URL.canParse(value);
    case 'date': return validDate(value);
    case 'date-time': return /^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/i.test(value) && validDate(value.slice(0, 10));
    default: return true;
  }
}

function fieldValue({ property, options }: ElicitationFields[number], value: Value): Value | undefined {
  switch (property.type) {
    case 'array': return Array.isArray(value) && new Set(value).size === value.length &&
      value.length >= (property.minItems ?? 0) && value.length <= (property.maxItems ?? Infinity) &&
      value.every(item => options?.some(option => option.const === item)) ? value : undefined;
    case 'boolean': return typeof value === 'boolean' ? value : undefined;
    case 'integer':
    case 'number': {
      const number = typeof value === 'string' && /^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(value) ? Number(value) : value;
      return typeof number === 'number' && Number.isFinite(number) && (property.type !== 'integer' || Number.isInteger(number)) &&
        number >= (property.minimum ?? -Infinity) && number <= (property.maximum ?? Infinity) ? number : undefined;
    }
    case 'string': return typeof value === 'string' && (options ? options.some(option => option.const === value)
      : validText(property, value)) ? value : undefined;
  }
}

export function elicitationDefaults(fields: ElicitationFields) {
  const values = new Map<string, Value>();
  for (const field of fields) {
    const value = field.property.default;
    if (value !== undefined && fieldValue(field, value) !== undefined) values.set(field.name, value);
  }
  return values;
}

export function validateElicitation(fields: ElicitationFields, draft: ReadonlyMap<string, Value>) {
  const entries: [string, Value][] = [];
  const errors = new Map<string, 'required' | 'invalid'>();
  for (const field of fields) {
    const value = draft.get(field.name);
    if (value === undefined) {
      if (field.required) errors.set(field.name, 'required');
      continue;
    }
    const typed = fieldValue(field, value);
    if (typed === undefined) errors.set(field.name, 'invalid');
    else entries.push([field.name, typed]);
  }
  return { content: Object.fromEntries(entries), errors };
}
