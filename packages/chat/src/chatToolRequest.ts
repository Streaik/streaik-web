import type { ChatRoute } from '@streaik/gateway';
import { clientToolSearchName } from '@streaik/gateway';
import type { ChatTool, ToolDefinition } from './localPlugins.ts';
import type { AgentDefinition } from './agentDefinition.ts';
import { agentMcpServers, agentToolOptions } from './agentTools.ts';
import { namespaceName, toolOptions, wireToolOptions } from './toolConfiguration.ts';
import type { ToolConfiguration, ToolOptions } from './toolConfiguration.ts';

export type Namespace = { id: string; name: string };
export type ConfiguredChatTool = { tool: ChatTool; source: string; options: ToolOptions; namespace?: Namespace };
export type ChatRequestTool = ToolDefinition & ToolOptions & { namespace?: Namespace };

export function configureChatTools(tools: readonly ChatTool[], config: ToolConfiguration, useNamespaces: boolean,
  agent?: AgentDefinition, deferLoadingDisabled = false): ConfiguredChatTool[] {
  const declarations = agentMcpServers(agent?.tools).filter(({ server }) => server.execution !== 'server');
  return tools.map(tool => {
    const mcp = tool.source === 'mcp' ? tool.tool : undefined;
    const declaration = mcp && declarations.find(entry => entry.endpoint === mcp.server.endpoint);
    const options = { ...toolOptions(declaration?.server),
      ...(mcp ? agentToolOptions(agent?.tools, { type: 'function', name: mcp.remoteName })
        : tool.source === 'mcp-resource' ? agentToolOptions(agent?.tools, { type: 'read_resource' }) : {}),
      ...(Object.hasOwn(config, tool.definition.name) ? config[tool.definition.name] : {}) };
    if (deferLoadingDisabled) delete options.defer_loading;
    const source = declaration?.key ?? mcp?.server.title ?? (tool.source === 'local' ? tool.plugin.id : tool.source === 'skill' ? 'Skills' : 'MCP');
    const namespace = useNamespaces || declaration?.server.namespace === true
      ? mcp ? { id: `mcp:${mcp.server.id}`, name: source } : { id: 'local', name: 'local' } : undefined;
    return { tool, source, options, namespace };
  });
}

export function chatRequestTools(rows: readonly ConfiguredChatTool[]): ChatRequestTool[] {
  const namespaces = new Map<string, Namespace>();
  const used = new Set<string>();
  return rows.map(({ tool: { definition: { name, description, inputSchema } }, options, namespace }) => {
    if (name === clientToolSearchName) return { name, description, inputSchema };
    let group = namespace && namespaces.get(namespace.id);
    if (namespace && !group) {
      const base = namespaceName(namespace.name);
      let candidate = base;
      let suffix = 2;
      while (used.has(candidate)) candidate = `${base.slice(0, 60)}_${suffix++}`;
      used.add(candidate);
      group = { id: namespace.id, name: candidate };
      namespaces.set(namespace.id, group);
    }
    return { name, description, inputSchema, ...wireToolOptions(options), ...(group && { namespace: group }) };
  });
}

export function chatToolCapabilities(route: ChatRoute | undefined, model?: string) {
  const provider = model?.split('/')[0]?.toLowerCase();
  const endpoint = route?.endpoint;
  return {
    namespaces: provider === 'openai' && (endpoint === '/api/chat' || endpoint === '/v1/responses'),
    options: provider === 'openai' && (endpoint === '/api/chat' || endpoint === '/v1/responses') ||
      provider === 'anthropic' && (endpoint === '/api/chat' || endpoint === '/v1/messages'),
  };
}

export function apiChatTools(definitions: readonly ChatRequestTool[], route: ChatRoute | undefined, model?: string) {
  const capabilities = chatToolCapabilities(route, model);
  const namespaces = new Map<string, { type: 'namespace'; name: string; description: string; tools: object[] }>();
  const tools = definitions.flatMap(({ namespace, allowed_callers, defer_loading, ...tool }) => {
    const options = capabilities.options ? wireToolOptions({ allowed_callers, defer_loading }) : {};
    if (!namespace || !capabilities.namespaces) return [{ ...tool, ...options }];
    const name = namespace.name;
    let group = namespaces.get(name);
    if (!group) {
      group = { type: 'namespace', name, description: name === 'local' ? 'Locally available application tools.' : `Tools provided by ${name}.`, tools: [] };
      namespaces.set(name, group);
    }
    group.tools.push({ type: 'function', name: tool.name, description: tool.description, parameters: tool.inputSchema, ...options });
    return [];
  });
  return { tools, namespaces: [...namespaces.values()] };
}
