import type { ChatRoute, HostedMcpTool } from '@streaik/gateway';
import { agentMcpPolicy } from './agentMcpClient.ts';
import type { McpTool } from './mcp.ts';
import { isObject, maxMcpServers, mcpEndpoint } from './mcpConfiguration.ts';

export type ChatExecution = 'client' | 'hosted';
export type McpPolicyFlag = keyof typeof agentMcpPolicy;
export type McpPolicy = Partial<Record<McpPolicyFlag, boolean>>;
export type ChatMcpServerOptions = { allowedTools?: readonly string[]; requireApproval?: 'always' | 'never' };
export type ChatModelContext = {
  execution?: ChatExecution;
  policy?: McpPolicy;
  servers?: Record<string, ChatMcpServerOptions>;
  toolSearch?: boolean;
  resourceSearch?: boolean;
};

// New policy settings must not change the tools available to existing browser chats.
export const browserMcpPolicy: Required<McpPolicy> = {
  openWorldHint: true, destructiveHint: true, readOnlyHint: false, idempotentHint: false,
};
export const mcpPolicyFlags = Object.keys(agentMcpPolicy) as McpPolicyFlag[];

export function normalizeChatModelContext(value: unknown): ChatModelContext | undefined {
  if (!isObject(value)) return;
  const policy = isObject(value.policy) ? value.policy : {};
  const flags = mcpPolicyFlags.flatMap(flag => typeof policy[flag] === 'boolean' && policy[flag] !== browserMcpPolicy[flag]
    ? [[flag, policy[flag]] as const] : []);
  const servers = Object.entries(isObject(value.servers) ? value.servers : {}).slice(0, maxMcpServers).flatMap(([endpoint, options]) => {
    if (mcpEndpoint(endpoint) !== endpoint || !isObject(options)) return [];
    const { allowedTools, requireApproval } = options;
    const allowed = Array.isArray(allowedTools) ? [...new Set(allowedTools.filter((name): name is string =>
      typeof name === 'string' && /^[\w-]{1,64}$/.test(name)))].slice(0, 64) : undefined;
    const approval = requireApproval === 'always' || requireApproval === 'never' ? requireApproval : undefined;
    return allowed || approval ? [[endpoint, { ...(allowed && { allowedTools: allowed }), ...(approval && { requireApproval: approval }) }]] : [];
  });
  const { execution, toolSearch, resourceSearch } = value;
  const settings: ChatModelContext = {
    ...(execution === 'client' || execution === 'hosted' ? { execution } : {}),
    ...(flags.length > 0 && { policy: Object.fromEntries(flags) }),
    ...(servers.length > 0 && { servers: Object.fromEntries(servers) }),
    ...(toolSearch === true && { toolSearch: true }),
    ...(resourceSearch === true && { resourceSearch: true }),
  };
  return Object.keys(settings).length ? settings : undefined;
}

export function browserMcpAllows(tool: McpTool, settings?: ChatModelContext) {
  const allowed = settings?.servers?.[tool.server.endpoint]?.allowedTools;
  if (allowed && !allowed.includes(tool.remoteName)) return false;
  const { annotations } = tool;
  const policy = { ...browserMcpPolicy, ...settings?.policy };
  const readOnly = annotations?.readOnlyHint === true;
  return (!policy.readOnlyHint || readOnly)
    && (readOnly || ((!policy.idempotentHint || annotations?.idempotentHint === true)
      && (policy.destructiveHint || annotations?.destructiveHint !== true)))
    && (policy.openWorldHint || annotations?.openWorldHint !== true);
}

export function hostedMcpRoute(route: ChatRoute) {
  return route.mode === 'gateway' && (route.endpoint === '/api/chat' || route.endpoint === '/v1/responses') ? route.endpoint : undefined;
}

export function chatHostedMcp(settings: ChatModelContext | undefined, servers: readonly { record: { title: string; endpoint: string } }[]): HostedMcpTool[] {
  if (settings?.execution !== 'hosted' || !servers.length) return [];
  const labels = new Set<string>();
  const tools: HostedMcpTool[] = servers.map(({ record: { title, endpoint } }) => {
    let label = title;
    for (let index = 2; labels.has(label.toLowerCase()); index++) label = `${title} (${index})`;
    labels.add(label.toLowerCase());
    const options = settings.servers?.[endpoint];
    return { type: 'mcp', server_label: label, server_url: endpoint,
      // Search discovers deferred hosted tools, not the tools already offered to the model.
      ...(settings.toolSearch && { defer_loading: true }),
      ...(options?.allowedTools && { allowed_tools: options.allowedTools }),
      ...(options?.requireApproval && { require_approval: options.requireApproval }) };
  });
  if (settings.toolSearch) tools.push({ type: 'tool_search' });
  if (settings.resourceSearch) tools.push({ type: 'resource_search' });
  return tools;
}

export const hostedMcpResponsesNotice = 'Gateway-hosted MCP on Responses requires Never for each server. Use API Chat to review hosted results.';
