import { searchCatalog } from './catalogLookup.ts';
import { decideMatches, searchText, takeMatches } from './searchSelection.ts';
import type { SearchAgent } from './searchSelection.ts';
import { resourceSearchRoleId } from './textAppAgents.ts';
import type { ConnectedMcpServer } from './mcpChatContext.ts';
import { forAssistant, catalogItem } from './mcpChatContext.ts';

export async function searchClientResources(agent: SearchAgent | undefined, server: ConnectedMcpServer, query: unknown, signal: AbortSignal) {
  signal.throwIfAborted();
  if (typeof query !== 'string' || !query.trim()) throw new Error('Enter a resource search query.');
  const goal = query.trim().slice(0, 512);
  const unique = <T>(items: readonly T[], key: (item: T) => string) => [...new Map(items.map(item => [key(item), item])).values()].slice(0, 512);
  const resources = unique(server.discovery.resources.filter(forAssistant), item => item.uri);
  const templates = unique(server.discovery.resourceTemplates.filter(forAssistant), item => item.uriTemplate);
  if (!resources.length && !templates.length) return { resources: [], resourceTemplates: [] };
  let uris: unknown, templateUris: unknown;
  if (agent && 'decision' in agent) {
    const ranked = await decideMatches(agent.decision, goal, [
      ...resources.map(({ uri, name, description }) => ({ key: uri, name, description, group: 'resource' })),
      ...templates.map(({ uriTemplate, name, description }) => ({ key: uriTemplate, name, description, group: 'template' })),
    ], signal);
    uris = ranked.filter(item => item.group === 'resource').map(item => item.key);
    templateUris = ranked.filter(item => item.group === 'template').map(item => item.key);
  } else if (agent) {
    const result = await searchText(resourceSearchRoleId, agent, { goal, catalog: {
      resources: resources.map(catalogItem), resourceTemplates: templates.map(catalogItem),
    } }, signal);
    uris = result?.selectedResourceUris;
    templateUris = result?.selectedResourceTemplateUriTemplates;
  } else {
    const [matchedResources, matchedTemplates] = await Promise.all([
      searchCatalog(resources, item => ({ title: item.name, text: `${item.uri} ${item.description ?? ''}` }), goal),
      searchCatalog(templates, item => ({ title: item.name, text: `${item.uriTemplate} ${item.description ?? ''}` }), goal),
    ]);
    signal.throwIfAborted();
    uris = matchedResources.map(item => item.uri);
    templateUris = matchedTemplates.map(item => item.uriTemplate);
  }
  return { serverId: server.record.id, resources: takeMatches(resources, item => item.uri, uris, 20).map(catalogItem),
    resourceTemplates: takeMatches(templates, item => item.uriTemplate, templateUris, 20).map(catalogItem) };
}
