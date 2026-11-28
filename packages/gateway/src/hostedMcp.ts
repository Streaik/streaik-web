import { asRecord } from './directMetrics.ts';

export type HostedMcpTool = {
  type: 'mcp'; server_label: string; server_url: string; allowed_tools?: readonly string[];
  require_approval?: 'always' | 'never'; allowed_callers?: readonly ('direct' | 'programmatic')[]; defer_loading?: boolean;
  headers?: Readonly<Record<string, string>>; execution?: 'client' | 'server';
} | { type: 'tool_search' | 'resource_search'; model?: string };

export function apiChatHostedMcp({ type, ...options }: HostedMcpTool) {
  return { name: type, inputSchema: { type: 'object', [type]: options } };
}

export function hostedSearchProviders(tools: readonly HostedMcpTool[]) {
  return [...new Set(tools.flatMap(tool => {
    const provider = tool.type !== 'mcp' && tool.model ? /^([a-z0-9-]+)\/.+$/u.exec(tool.model)?.[1] : undefined;
    return provider ? [provider] : [];
  }))];
}

export function apiChatHostedSearchProviders(tools: unknown) {
  return hostedSearchProviders(Array.isArray(tools) ? tools.flatMap(entry => {
    const tool = asRecord(entry);
    const type = tool?.name;
    if (type !== 'tool_search' && type !== 'resource_search') return [];
    const model = asRecord(asRecord(tool?.inputSchema)?.[type])?.model;
    return typeof model === 'string' ? [{ type, model }] : [];
  }) : []);
}

export function withResponsesHostedMcp(body: RequestInit['body'], hostedMcp: readonly HostedMcpTool[], toolChoice: unknown) {
  if (!hostedMcp.length || typeof body !== 'string') return body;
  const request = asRecord(JSON.parse(body));
  if (!request) return body;
  const tools = Array.isArray(request.tools) ? request.tools : [];
  return JSON.stringify({ ...request, tools: [...tools, ...hostedMcp.map(({ type, ...options }) => ({ type, name: type, ...options }))],
    ...(toolChoice === 'none' && { tool_choice: 'none' }) });
}
