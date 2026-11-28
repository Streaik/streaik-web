import { clientToolSearchName } from '@streaik/gateway';
import type { ChatRoute } from '@streaik/gateway';
import { apiChatTools } from './chatToolRequest.ts';
import type { ChatRequestTool } from './chatToolRequest.ts';
import { toolSearchRoleId } from './textAppAgents.ts';
import { decideMatches, searchText, takeMatches } from './searchSelection.ts';
import type { SearchAgent } from './searchSelection.ts';
import { searchCatalog } from './catalogLookup.ts';

const object = (value: unknown) => value && typeof value === 'object' && !Array.isArray(value)
  ? value as Record<string, unknown> : undefined;

export function isClientToolSearch(input: unknown, id: string, metadata: unknown) {
  const scoped = object(object(metadata)?.openai);
  return object(input)?.call_id === id && (typeof scoped?.itemId === 'string' ||
    object(scoped?.nativeItem)?.type === 'tool_search_call' && object(scoped?.nativeItem)?.execution === 'client');
}

async function selectTools(request: SearchAgent | undefined, goal: unknown, catalog: readonly ChatRequestTool[], signal: AbortSignal) {
  signal.throwIfAborted();
  if (typeof goal !== 'string' || !goal.trim() || !catalog.length) return [];
  if (!request) {
    const matches = await searchCatalog(catalog, tool => ({ title: tool.name, text: tool.description ?? '' }), goal.slice(0, 2000));
    signal.throwIfAborted();
    return matches.slice(0, 10);
  }
  const query = goal.slice(0, 2000);
  const evidence = catalog.slice(0, 1024).map(({ name, description, namespace }) => ({ name, description: description?.slice(0, 300), namespace: namespace?.name }));
  const names = 'decision' in request
    ? (await decideMatches(request.decision, query, evidence.map(item => ({ ...item, key: item.name, group: item.namespace })), signal)).map(({ key }) => key)
    : (await searchText(toolSearchRoleId, request, { goal: query, catalog: evidence }, signal))?.selectedToolNames;
  return takeMatches(catalog.slice(0, evidence.length), tool => tool.name, names, 10);
}

export async function searchClientTools(request: SearchAgent, input: unknown, definitions: readonly ChatRequestTool[],
  route: ChatRoute, model: string, signal: AbortSignal) {
  const catalog = definitions.filter(tool => tool.defer_loading === true && tool.name !== 'tool_search' && tool.name !== clientToolSearchName);
  const selected = await selectTools(request, object(object(input)?.arguments)?.goal, catalog, signal);
  const { tools, namespaces } = apiChatTools(selected, route, model);
  return { tools: [...tools.map(({ inputSchema, ...definition }) => ({ type: 'function', ...definition, parameters: inputSchema })), ...namespaces] };
}

export async function searchLocalToolCatalog(request: SearchAgent | undefined, goal: unknown,
  definitions: readonly ChatRequestTool[], anthropic: boolean, signal: AbortSignal) {
  const catalog = definitions.filter(tool => tool.name !== clientToolSearchName);
  const deferred = anthropic ? catalog.filter(tool => tool.defer_loading === true) : [];
  const selected = await selectTools(request, goal, deferred.length ? deferred : catalog, signal);
  return selected.map(({ name, description, inputSchema }) => ({ name, description, inputSchema }));
}
