import { isObject } from './agentDefinition.ts';
import type { JsonObject, JsonValue } from './agentDefinition.ts';
import { mcpEndpoint } from './mcpConfiguration.ts';
import { toolOptions } from './toolConfiguration.ts';
import type { ToolOptions } from './toolConfiguration.ts';

export const agentSearchTools = { tool_search: 'Tool search', resource_search: 'Resource search' } as const;
export type AgentToolIdentity = { type: 'function'; name: string } | { type: keyof typeof agentSearchTools | 'read_resource' };
export const agentToolKey = (id: AgentToolIdentity) => id.type === 'function' ? `function:${id.name}` : id.type;
export const agentToolList = (tools?: JsonValue): readonly JsonValue[] => Array.isArray(tools) ? tools : [];
const object = (value?: JsonValue) => isObject(value) ? value as JsonObject : undefined;
const match = (tool: JsonValue, id: AgentToolIdentity) => {
  const entry = object(tool);
  return entry?.type === id.type && (id.type !== 'function' || entry.name === id.name);
};

export function agentToolOptions(tools: JsonValue | undefined, id: AgentToolIdentity): ToolOptions {
  return toolOptions(agentToolList(tools).find(tool => match(tool, id)));
}

export function patchAgentTool(tools: JsonValue | undefined, id: AgentToolIdentity, patch: ToolOptions): readonly JsonValue[] {
  const list = agentToolList(tools);
  const index = list.findIndex(tool => match(tool, id));
  const next = { ...id, ...object(list[index]), ...patch };
  // Keep an empty caller array: the runtime uses it to clear an inherited server default.
  return index < 0 ? [...list, next as JsonObject] : list.map((tool, i) => i === index ? next as JsonObject : tool);
}

export function enableAgentSearch(tools: JsonValue | undefined, type: keyof typeof agentSearchTools, enabled: boolean) {
  const list = agentToolList(tools);
  if (!enabled) return list.filter(tool => !match(tool, { type }));
  return list.some(tool => match(tool, { type })) ? list : [...list, { type }];
}

export function agentMcpServers(value?: JsonValue) {
  return Object.entries(object(value) ?? {}).flatMap(([key, entry]) => {
    const server = object(entry);
    return server?.type === 'http' ? [{ key, server, endpoint: typeof server.url === 'string' ? mcpEndpoint(server.url) : undefined }] : [];
  });
}

export function agentMcpAllows(server: JsonObject, toolName: string) {
  return !Array.isArray(server.allowed_tools) || server.allowed_tools.includes(toolName);
}

export function patchAgentMcp(servers: JsonValue | undefined, key: string, patch?: JsonObject): JsonObject {
  const previous = object(servers) ?? {};
  const { [key]: current, ...others } = previous;
  return patch ? { ...previous, [key]: { ...object(current), ...patch } } : others;
}
