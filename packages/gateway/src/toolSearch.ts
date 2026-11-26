import { asRecord } from './directMetrics.ts';

export const clientToolSearchName = 'client_tool_search';
export const anthropicToolSearchBeta = 'advanced-tool-use-2025-11-20';

export function deferredToolReferences(output: unknown, allowed: ReadonlySet<string>) {
  const result = asRecord(output);
  if (result?.isError === true) return [];
  const selected = asRecord(result?.structuredContent)?.selectedTools;
  if (!Array.isArray(selected)) return [];
  const names = new Set<string>();
  for (const tool of selected) {
    const name = asRecord(tool)?.name;
    if (typeof name === 'string' && allowed.has(name)) names.add(name);
    if (names.size === 10) break;
  }
  return [...names];
}
