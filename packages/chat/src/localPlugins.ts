import type { CatalogModel, ChatMessage, ChatRoute } from '@streaik/gateway';
import type { McpTool } from './mcp.ts';
import { conversationTitle, newestFirst } from './conversations.ts';
import type { Conversation } from './conversations.ts';
import { convertedAttachmentName } from './chatAttachments.ts';
import directory from './provider-directory.json' with { type: 'json' };

type Property = { type: 'string' | 'integer' | 'number'; description: string; enum?: string[] };
export type ToolDefinition = Pick<McpTool, 'name' | 'description' | 'inputSchema'>;
type LocalResult = { content: { type: 'text'; text: string }[]; structuredContent?: Record<string, unknown>; isError?: boolean };
type PluginContext = { catalog: readonly CatalogModel[]; history: readonly Conversation[] };
type LocalToolSpec = {
  definition: ToolDefinition;
  run: (input: Record<string, unknown>, context: PluginContext) => Record<string, unknown>;
};

function define(name: string, description: string, properties: Record<string, Property>, required: string[] | undefined,
  run: LocalToolSpec['run']): LocalToolSpec {
  return { definition: { name, description, inputSchema: { type: 'object', properties, ...(required && { required }) } }, run };
}

const string = (description: string): Property => ({ type: 'string', description });
const integer = (description: string): Property => ({ type: 'integer', description });
const keyword = (value: unknown) => typeof value === 'string' ? value.trim().toLowerCase() : '';
const order = (a: string, b: string) => a.localeCompare(b, undefined, { sensitivity: 'base', numeric: true });
const limit = (value: unknown, fallback = 500, max = 500) =>
  typeof value === 'number' ? Math.max(1, Math.min(max, Math.floor(value))) : fallback;

const providerMetadata = new Map(directory.providers.map(provider => [provider.id, provider]));
function providers(catalog: readonly CatalogModel[]) {
  return [...new Set(catalog.map(({ provider }) => provider))].map(key => {
    const entry = providerMetadata.get(key);
    return { key, name: entry?.name ?? key, description: entry?.description, providerCountry: entry?.country,
      inferenceRegions: entry?.regions, urls: entry?.urls };
  }).sort((a, b) => order(a.name, b.name) || order(a.key, b.key));
}

const providerFilters = {
  country: string('Optional provider country filter (exact ISO country code match, case-insensitive), e.g. NL.'),
  inferenceRegion: { ...string('Optional inference region filter (exact token match, case-insensitive).'),
    enum: ['World', 'Europe', 'Americas', 'Asia', 'Africa', 'Oceania'] },
  limit: integer('Optional max number of providers to return.'),
};
function providerResults(catalog: readonly CatalogModel[], input: Record<string, unknown>) {
  const query = keyword(input.query);
  const country = keyword(input.country);
  const region = keyword(input.inferenceRegion);
  const filtered = providers(catalog).filter(p => (!query || [p.key, p.name].some(s => keyword(s).includes(query))) &&
    (!country || keyword(p.providerCountry) === country) && (!region || p.inferenceRegions?.some(s => keyword(s) === region)));
  const items = filtered.slice(0, limit(input.limit));
  return { total: filtered.length, count: items.length, items };
}

const modelType = string('Optional model type filter (e.g. language, image, speech).');
function modelResults(catalog: readonly CatalogModel[], input: Record<string, unknown>) {
  const provider = keyword(input.provider);
  const type = keyword(input.type);
  const query = keyword(input.query);
  const names = providers(catalog);
  const matchProvider = ({ key, name }: (typeof names)[number], exact: boolean) => [key, name].some(value =>
    exact ? keyword(value) === provider : keyword(value).includes(provider));
  const exact = names.filter(item => matchProvider(item, true));
  const keys = new Set((exact.length ? exact : names.filter(item => matchProvider(item, false))).map(item => item.key));
  return catalog.filter(model => (!provider || keys.has(model.provider)) && (!type || keyword(model.type).includes(type)) &&
    keyword([model.id, model.name, model.type, model.provider, providerMetadata.get(model.provider)?.name, ...model.tags].join(' ')).includes(query))
    .sort((a, b) => order(a.name, b.name) || order(a.id, b.id));
}

const aiTools = [
  define('local_ai_providers_list', 'List providers in the Gateway model catalog.', providerFilters, [],
    (input, { catalog }) => providerResults(catalog, { ...input, query: undefined })),
  define('local_ai_provider_countries_list', 'List provider country codes and their provider counts.', {}, [], (_input, { catalog }) => {
    const counts = new Map<string, number>();
    for (const { providerCountry } of providers(catalog)) {
      const code = providerCountry?.trim().toUpperCase();
      if (code) counts.set(code, (counts.get(code) ?? 0) + 1);
    }
    const items = Array.from(counts, ([code, providerCount]) => ({ code, providerCount })).sort((a, b) => order(a.code, b.code));
    return { total: items.length, count: items.length, items };
  }),
  define('local_ai_providers_search', 'Search Gateway providers by key or display name.', {
    query: string('Search text matched case-insensitively against provider key and name.'), ...providerFilters,
  }, ['query'], (input, { catalog }) => providerResults(catalog, input)),
  define('local_ai_models_search', 'Search models and capabilities in the Gateway catalog.', {
    query: string('Search text for Gateway models.'), provider: string('Optional provider filter by provider key or display name.'),
    type: modelType, limit: integer('Max number of models to return.'),
  }, ['query', 'limit'], (input, { catalog }) => ({ data: modelResults(catalog, input).slice(0, limit(input.limit)) })),
  define('local_ai_models_list_by_provider', 'List Gateway models by provider, with an optional model type filter.', {
    provider: string('Provider key or display name.'), type: modelType, limit: integer('Optional max number of models to return.'),
  }, ['provider'], (input, { catalog }) => {
    const matches = modelResults(catalog, { ...input, query: undefined });
    const data = matches.slice(0, limit(input.limit));
    return { total: matches.length, count: data.length, data };
  }),
];

function isConversationText(message: ChatMessage) {
  return message.role === 'user' || message.role === 'assistant';
}

const historyTools = [
  define('local_conversations_list_all', 'List local conversation summaries for the current profile.', {}, undefined, (_input, { history }) => ({
    conversations: [...history].sort(newestFirst).map(record => ({ id: record.id, metadata: { name: conversationTitle(record) },
      messageCount: record.messages.filter(isConversationText).length, activityAt: record.metadata?.updatedAt })),
  })),
  define('local_conversations_search_text', 'Search local conversations by text. All query words must occur in the same text part.', {
    query: string('Search query. Single words use substring match; multi-word queries require every word in the same text part.'),
    limit: { type: 'number', description: 'Max results (default 20, max 50)' },
  }, ['query'], (input, { history }) => {
    const query = (input.query as string).trim();
    const terms = [...new Set(keyword(query).split(/\s+/))];
    const cap = limit(input.limit, 20, 50);
    const results = [];
    let total = 0;
    for (const record of [...history].sort(newestFirst)) {
      for (const [messageIndex, message] of record.messages.entries()) {
        if (!isConversationText(message)) continue;
        for (const [partIndex, part] of message.parts.entries()) {
          if (part.type !== 'text') continue;
          const text = part.text.toLowerCase();
          const indices = terms.map(term => text.indexOf(term));
          if (indices.includes(-1)) continue;
          total++;
          if (results.length >= cap) continue;
          const matchIndex = Math.min(...indices);
          const start = Math.max(0, matchIndex - 90);
          const end = Math.min(part.text.length, start + 260);
          results.push({ conversationId: record.id, conversationName: conversationTitle(record), messageId: message.id,
            messageIndex, role: message.role, partIndex, matchIndex,
            snippet: `${start ? '…' : ''}${part.text.slice(start, end).replace(/\s+/g, ' ').trim()}${end < part.text.length ? '…' : ''}` });
        }
      }
    }
    return { query, total, limit: cap, results };
  }),
  define('local_conversations_get_conversation', 'Get the text of a local conversation by ID.', {
    conversationId: string('Id of the conversation'),
  }, ['conversationId'], (input, { history }) => {
    const record = history.find(item => item.id === input.conversationId);
    if (!record) throw new Error('Conversation not found.');
    return { id: record.id, metadata: { name: conversationTitle(record), updatedAt: record.metadata?.updatedAt },
      messages: record.messages.filter(isConversationText).flatMap(({ id, role, parts }) => {
        const text = parts.flatMap(part => part.type === 'text' && !convertedAttachmentName(part) ? [{ type: 'text', text: part.text }] : []);
        return text.length ? [{ id, role, parts: text }] : [];
      }) };
  }),
];

export const localPlugins = [
  { id: 'local-artificial-intelligence', label: 'Artificial Intelligence', approval: false, requiresHistory: false, tools: aiTools },
  { id: 'local-conversations', label: 'Chat History', approval: true, requiresHistory: true, tools: historyTools },
] as const;
export type LocalPluginId = (typeof localPlugins)[number]['id'];
export type ChatTool = { source: 'local'; plugin: (typeof localPlugins)[number]; spec: LocalToolSpec; definition: ToolDefinition }
  | { source: 'skill'; definition: ToolDefinition }
  | { source: 'mcp-resource'; definition: ToolDefinition }
  | { source: 'mcp'; tool: McpTool; definition: ToolDefinition };

const registeredNames = new Set(localPlugins.flatMap(plugin => plugin.tools.map(({ definition }) => definition.name)));
if (registeredNames.size !== localPlugins.reduce((total, plugin) => total + plugin.tools.length, 0)) {
  throw new Error('Duplicate local tool name.');
}
import { activateSkill, readSkillResource, skillTools } from './skillTools.ts';
import { readResourceTool } from './mcpChatContext.ts';
for (const skill of skillTools) registeredNames.add(skill.name);
registeredNames.add(readResourceTool.name);

export function activeChatTools(route: ChatRoute, enabled: readonly LocalPluginId[], historyAvailable: boolean, mcpTools: readonly McpTool[], hasSkills = false,
  resourceTool?: ToolDefinition): ChatTool[] {
  const tools: ChatTool[] = [];
  if (route.mode === 'gateway') {
    if (hasSkills) for (const definition of skillTools) tools.push({ source: 'skill', definition });
    for (const plugin of localPlugins) {
      if (enabled.includes(plugin.id) && (!plugin.requiresHistory || historyAvailable)) {
        for (const spec of plugin.tools) tools.push({ source: 'local', plugin, spec, definition: spec.definition });
      }
    }
  }
  for (const tool of mcpTools) {
    if (!registeredNames.has(tool.name)) tools.push({ source: 'mcp', tool, definition: tool });
  }
  if (resourceTool) tools.push({ source: 'mcp-resource', definition: resourceTool });
  return tools;
}

export function runLocalTool(tool: Extract<ChatTool, { source: 'local' }>, input: unknown, context: PluginContext): LocalResult {
  try {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Expected tool arguments as a JSON object.');
    const schema = tool.definition.inputSchema;
    const values = Object.fromEntries(Object.entries(input).filter(([key]) => Object.hasOwn(schema.properties ?? {}, key)));
    for (const key of schema.required ?? []) {
      if (!Object.hasOwn(values, key)) throw new Error(`Missing argument: ${key}.`);
    }
    for (const [key, value] of Object.entries(values)) {
      const property = schema.properties?.[key] as Property;
      if (property.type === 'string' ? typeof value !== 'string' || value.length > 4096 ||
          (!value.trim() && !(key === 'query' && tool.definition.name === 'local_ai_models_search')) ||
          (property.enum && !property.enum.some(item => keyword(item) === keyword(value)))
        : typeof value !== 'number' || !Number.isFinite(value) || value <= 0 ||
          (property.type === 'integer' && !Number.isSafeInteger(value))) throw new Error(`Invalid argument: ${key}.`);
    }
    const structuredContent = tool.spec.run(values, context);
    if (JSON.stringify(structuredContent).length > 128 * 1024) throw new Error('Result is too large. Try a narrower search.');
    return { content: [], structuredContent };
  } catch (error) {
    return { isError: true, content: [{ type: 'text', text: error instanceof Error ? error.message : 'The local tool could not be completed.' }] };
  }
}

export function toolPartName(part: ChatMessage['parts'][number]) {
  return part.type === 'dynamic-tool' ? part.toolName : part.type.startsWith('tool-') ? part.type.slice(5) : undefined;
}

// Never replay unfinished calls or local parts to Direct/after their plugin is switched off.
// Native routes use ordinary tool results, not signed API-chat approval records.
export function filterLocalToolReplay(messages: ChatMessage[], definitions: readonly ToolDefinition[], apiChat = true, enabledSkillIds?: ReadonlySet<string>,
  enabledMcpResourceServers?: ReadonlySet<string>): ChatMessage[] {
  const allowed = new Set(definitions.map(({ name }) => name));
  return messages.flatMap(message => {
    let changed = false;
    const parts = message.parts.flatMap((part): ChatMessage['parts'] => {
      const name = toolPartName(part);
      if (!name || !('toolCallId' in part)) return [part];
      const complete = part.state === 'output-available' || part.state === 'output-error' ||
        (part.state === 'approval-responded' && part.approval.approved === false);
      const skillCall = name === activateSkill || name === readSkillResource;
      const skillId = skillCall && part.input && typeof part.input === 'object' && 'skill_id' in part.input ? part.input.skill_id : undefined;
      const sharesSkill = skillCall && part.state === 'output-available' &&
        !(part.output && typeof part.output === 'object' && 'isError' in part.output && part.output.isError === true);
      const sourceId = name === readResourceTool.name && part.input && typeof part.input === 'object' && 'serverId' in part.input ? part.input.serverId : undefined;
      const disconnectedResource = name === readResourceTool.name && typeof sourceId === 'string' && !enabledMcpResourceServers?.has(sourceId);
      if ((sharesSkill && (typeof skillId !== 'string' || !enabledSkillIds?.has(skillId))) || disconnectedResource || (!complete && !part.providerExecuted) || part.state === 'approval-requested' ||
        (part.providerExecuted && part.approval) || (registeredNames.has(name) && !allowed.has(name))) {
        changed = true;
        return [];
      }
      if (apiChat || !part.approval) return [part];
      changed = true;
      const { approval, ...result } = part;
      if (approval.approved === false) return [{ ...result, state: 'output-available', output: 'The user declined to share this tool result.', errorText: undefined }];
      if (part.state === 'output-available' || part.state === 'output-error') return [{ ...part, approval: undefined }];
      return [];
    });
    if (!changed) return [message];
    return parts.some(part => part.type !== 'step-start') ? [{ ...message, parts }] : [];
  });
}
