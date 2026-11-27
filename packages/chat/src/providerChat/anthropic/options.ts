import type { NativeOptions } from '../settings.ts';

export const anthropicDefaults = {
  max_tokens: 128000,
  'anthropic-version': '2026-10-21',
} as const;

export const anthropicBetas = {
  contextManagement: 'context-management-2025-06-27',
  compaction: 'compact-2026-09-04',
  advisor: 'advisor-tool-2026-03-01',
} as const;

export const anthropicHeaderNames = ['anthropic-version', 'anthropic-beta'] as const;

export function savedAnthropicHeaders(saved: NativeOptions) {
  return Object.fromEntries(anthropicHeaderNames.flatMap(name => {
    const value = Object.entries(saved).find(([key]) => key.toLowerCase() === name)?.[1];
    return typeof value === 'string' && value.trim() ? [[name, value.trim()]] : [];
  }));
}

export function anthropicChatOptions(saved: NativeOptions): NativeOptions {
  const body = Object.fromEntries(Object.entries(saved).filter(([key]) => !/^anthropic-(version|beta)$/i.test(key)));
  return { ...body, max_tokens: body.max_tokens ?? anthropicDefaults.max_tokens };
}

export function anthropicChatHeaders(saved: NativeOptions, body: NativeOptions): Record<string, string> {
  const headers = savedAnthropicHeaders(saved);
  const version = headers['anthropic-version'] ?? anthropicDefaults['anthropic-version'];
  const betas = new Set(headers['anthropic-beta']?.split(',').map(item => item.trim()).filter(Boolean));
  const context = body.context_management as NativeOptions | undefined;
  const compaction = body.compaction as NativeOptions | undefined;
  if (Array.isArray(context?.edits) && context.edits.length) betas.add(anthropicBetas.contextManagement);
  if (compaction?.type === 'summarize') betas.add(anthropicBetas.compaction);
  if (Array.isArray(body.tools) && body.tools.some(tool => (tool as NativeOptions | null)?.name === 'advisor')) betas.add(anthropicBetas.advisor);
  return { 'anthropic-version': version, ...(betas.size && { 'anthropic-beta': [...betas].join(',') }) };
}
