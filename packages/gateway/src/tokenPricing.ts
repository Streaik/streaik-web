/** USD per token. */
export type TokenRates = { input: number; output: number; cacheRead?: number; cacheWrite?: number };

export function amount(value: unknown): number | undefined {
  const n = typeof value === 'string' && /^(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(value.trim()) ? Number(value) : value;
  return typeof n === 'number' && Number.isFinite(n) && n >= 0 ? n : undefined;
}

export function readTokenPricing(value: unknown): TokenRates | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return;
  const pricing = value as Record<string, unknown>;
  const input = amount(pricing.input), output = amount(pricing.output);
  if (input === undefined || output === undefined) return;
  const cacheRead = amount(pricing.input_cache_read), cacheWrite = amount(pricing.input_cache_write);
  return { input, output, ...(cacheRead !== undefined && { cacheRead }), ...(cacheWrite !== undefined && { cacheWrite }) };
}
