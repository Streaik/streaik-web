import { clientToolSearchName } from '@streaik/gateway';
import type { ChatRoute } from '@streaik/gateway';
import { apiChatTools } from './chatToolRequest.ts';
import type { ChatRequestTool } from './chatToolRequest.ts';
import { runTextAppAgent, toolSearchRoleId } from './textAppAgents.ts';
import type { TextAppRequest } from './textAppAgents.ts';
import { searchCatalog } from './catalogLookup.ts';

const object = (value: unknown) => value && typeof value === 'object' && !Array.isArray(value)
  ? value as Record<string, unknown> : undefined;

export function isClientToolSearch(input: unknown, id: string, metadata: unknown) {
  const scoped = object(object(metadata)?.openai);
  return object(input)?.call_id === id && (typeof scoped?.itemId === 'string' ||
    object(scoped?.nativeItem)?.type === 'tool_search_call' && object(scoped?.nativeItem)?.execution === 'client');
}

async function selectTools(request: TextAppRequest | undefined, goal: unknown, catalog: readonly ChatRequestTool[], signal: AbortSignal) {
  if (typeof goal !== 'string' || !goal.trim() || !catalog.length) return [];
  if (!request) {
    const matches = await searchCatalog(catalog, tool => ({ title: tool.name, text: tool.description ?? '' }), goal.slice(0, 2000));
    signal.throwIfAborted();
    return matches.slice(0, 10);
  }
  const text = await runTextAppAgent(toolSearchRoleId, request, JSON.stringify({ goal: goal.slice(0, 2000),
    catalog: catalog.map(({ name, description, namespace }) => ({ name, description: description?.slice(0, 300), namespace: namespace?.name })) }), signal);
  signal.throwIfAborted();
  let names: unknown;
  try { names = object(JSON.parse(text ?? 'null'))?.selectedToolNames; } catch { /* Invalid agent output selects no tools. */ }
  const byName = new Map(catalog.map(tool => [tool.name, tool]));
  return Array.isArray(names) ? [...new Set(names)].flatMap(name => byName.has(name) ? [byName.get(name)!] : []).slice(0, 10) : [];
}

export async function searchClientTools(request: TextAppRequest, input: unknown, definitions: readonly ChatRequestTool[],
  route: ChatRoute, model: string, signal: AbortSignal) {
  const catalog = definitions.filter(tool => tool.defer_loading === true && tool.name !== 'tool_search' && tool.name !== clientToolSearchName);
  const selected = await selectTools(request, object(object(input)?.arguments)?.goal, catalog, signal);
  const { tools, namespaces } = apiChatTools(selected, route, model);
  return { tools: [...tools.map(({ inputSchema, ...definition }) => ({ type: 'function', ...definition, parameters: inputSchema })), ...namespaces] };
}

export async function searchLocalToolCatalog(request: TextAppRequest | undefined, goal: unknown,
  definitions: readonly ChatRequestTool[], anthropic: boolean, signal: AbortSignal) {
  const catalog = definitions.filter(tool => tool.name !== clientToolSearchName);
  const deferred = anthropic ? catalog.filter(tool => tool.defer_loading === true) : [];
  const selected = await selectTools(request, goal, deferred.length ? deferred : catalog, signal);
  return selected.map(({ name, description, inputSchema }) => ({ name, description, inputSchema }));
}
