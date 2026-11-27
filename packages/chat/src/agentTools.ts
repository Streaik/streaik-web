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

export function patchAgentTool(tools: JsonValue | undefined, id: AgentToolIdentity, patch: ToolOptions & { execution?: 'server' | 'client' }): readonly JsonValue[] {
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
  return agentToolList(value).flatMap(entry => {
    const server = object(entry);
    return server?.type === 'mcp' && typeof server.server_label === 'string'
      ? [{ key: server.server_label, server, endpoint: typeof server.server_url === 'string' ? mcpEndpoint(server.server_url) : undefined }] : [];
  });
}

export function agentMcpAllows(server: JsonObject, toolName: string) {
  return agentMcpToolNames(server)?.includes(toolName) ?? true;
}

export function agentMcpToolNames(server: JsonObject) {
  const names = Array.isArray(server.allowed_tools) ? server.allowed_tools : object(server.allowed_tools)?.tool_names;
  return Array.isArray(names) ? names.filter((name): name is string => typeof name === 'string') : undefined;
}

function omitLegacyMcpFlags(server: JsonObject) {
  const { disabled, required, ...current } = server;
  return current;
}

export function withoutLegacyAgentMcpFlags(tools?: JsonValue) {
  const list = agentToolList(tools);
  const next = list.map(entry => {
    const server = object(entry);
    return server?.type === 'mcp' && ('disabled' in server || 'required' in server) ? omitLegacyMcpFlags(server) : entry;
  });
  return next.some((entry, i) => entry !== list[i]) ? next : tools;
}

export function patchAgentMcp(tools: JsonValue | undefined, key: string, patch?: Readonly<Record<string, JsonValue | undefined>>): readonly JsonValue[] {
  const list = agentToolList(tools);
  const index = list.findIndex(tool => object(tool)?.type === 'mcp' && object(tool)?.server_label === key);
  if (!patch) return list.filter((_, i) => i !== index);
  const descriptor: Record<string, JsonValue> = { ...object(list[index]) };
  for (const [field, value] of Object.entries(patch)) {
    if (value === undefined) delete descriptor[field];
    else descriptor[field] = value;
  }
  const current = omitLegacyMcpFlags({ ...descriptor, type: 'mcp', server_label: key });
  return index < 0 ? [...list, current] : list.map((tool, i) => index === i ? current : tool);
}

export function agentSkillsTool(tools?: JsonValue) {
  return agentToolList(tools).map(object).find(tool => tool?.type === 'skills');
}

export function patchAgentSkills(tools: JsonValue | undefined, patch: JsonObject | { execution: 'server' | 'client' | undefined }): readonly JsonValue[] {
  const list = agentToolList(tools);
  const previous = agentSkillsTool(tools);
  const { execution, ...fields } = { ...previous, ...patch };
  const descriptor = { skills: [], ...fields, ...(execution !== undefined && { execution }), type: 'skills' };
  return previous ? list.map(tool => tool === previous ? descriptor : tool) : [...list, descriptor];
}
