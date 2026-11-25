export const toolCallers = ['direct', 'programmatic'] as const;
export type ToolCaller = typeof toolCallers[number];
export type ToolOptions = { allowed_callers?: readonly ToolCaller[]; defer_loading?: boolean };
export type ToolConfiguration = Readonly<Record<string, ToolOptions>>;

export function toolOptions(value: unknown): ToolOptions {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const { allowed_callers, defer_loading } = value as Record<string, unknown>;
  return {
    ...(Array.isArray(allowed_callers) && { allowed_callers: [...new Set(allowed_callers.filter(
      (caller): caller is ToolCaller => caller === 'direct' || caller === 'programmatic'))] }),
    ...(typeof defer_loading === 'boolean' && { defer_loading }),
  };
}

export function normalizeToolConfiguration(value: unknown): ToolConfiguration {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).flatMap(([key, entry]) => {
    const options = toolOptions(entry);
    return key && Object.keys(options).length ? [[key, options]] : [];
  }));
}

export function wireToolOptions(options: ToolOptions): ToolOptions {
  return {
    ...(options.allowed_callers?.length && { allowed_callers: options.allowed_callers }),
    ...(options.defer_loading === true && { defer_loading: true }),
  };
}

export function namespaceName(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '_').replace(/^[_-]+|[_-]+$/g, '').slice(0, 64) || 'tools';
}
