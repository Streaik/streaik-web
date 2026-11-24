import type { Client, Tool } from '@modelcontextprotocol/client';
import { isObject, mcpDeclarations, mcpEndpoint } from './mcpConfiguration.ts';
import type { McpRemoteHeader, McpServerRecord } from './mcpConfiguration.ts';
export type { McpRemoteHeader } from './mcpConfiguration.ts';

const revision = '2026-07-28';

type RequestHeaders = () => HeadersInit | Promise<HeadersInit>;
export type McpAppAuth = { ready: boolean; headers: RequestHeaders };
export type McpOptions = {
  base?: URL;
  registryUrl?: URL;
  headersForRemote?: (headers: readonly McpRemoteHeader[]) => McpAppAuth | undefined;
};
export type McpServer = Pick<McpServerRecord, 'id' | 'title' | 'endpoint'> & {
  pinned: boolean; reviewExecution: boolean; requestHeaders: RequestHeaders;
};
export type McpTool = Pick<Tool, 'name' | 'title' | 'description' | 'inputSchema' | 'outputSchema' | 'annotations'> & { server: McpServer; remoteName: string };
export type McpOutput = { text: string; images: string[] };
export type McpCatalogServer = { name: string; title: string; description?: string; version?: string;
  remotes: Pick<McpServerRecord, 'endpoint' | 'declarations'>[] };

export function isMcpRuntime(endpoint: string, base?: URL) {
  if (!base || mcpEndpoint(endpoint) !== endpoint) return false;
  const url = new URL(endpoint);
  const root = base.pathname.replace(/\/+$/, '');
  return url.origin === base.origin && (url.pathname === root || url.pathname.startsWith(`${root}/`));
}

export function mcpAppAuth(options: McpOptions | undefined, server: Pick<McpServerRecord, 'source' | 'endpoint' | 'declarations'>) {
  if (server.source !== 'registry' || !isMcpRuntime(server.endpoint, options?.base) || server.declarations.some(header => header.manualOnly)) return;
  return options?.headersForRemote?.(server.declarations);
}

export async function fetchMcpCatalog(registryUrl: URL, signal: AbortSignal, cursor?: string) {
  const url = new URL(registryUrl);
  if (cursor) url.searchParams.set('cursor', cursor);
  const response = await fetch(url, {
    signal, redirect: 'error', credentials: 'omit', cache: 'no-store', referrerPolicy: 'no-referrer',
  });
  if (!response.ok) throw new Error('The MCP registry is unavailable.');
  const listing: unknown = await response.json();
  if (!isObject(listing) || !Array.isArray(listing.servers)) throw new Error('Invalid MCP registry response.');

  const servers: McpCatalogServer[] = [];
  const names = new Set<string>();
  for (const item of listing.servers) {
    if (!isObject(item) || !isObject(item.server)) continue;
    const { name, title, description, version, remotes } = item.server;
    if (typeof name !== 'string' || !name.trim() || name.length > 240 || names.has(name)) continue;
    const choices: McpCatalogServer['remotes'] = [];
    for (const remote of Array.isArray(remotes) ? remotes : []) {
      if (!isObject(remote) || remote.type !== 'streamable-http' || typeof remote.url !== 'string') continue;
      const endpoint = mcpEndpoint(remote.url);
      const declarations = mcpDeclarations(remote.headers);
      if (endpoint && declarations && !choices.some(remote => remote.endpoint === endpoint)) choices.push({ endpoint, declarations });
    }
    names.add(name);
    servers.push({ name, title: (typeof title === 'string' && title.trim() || name.split('/').at(-1) || name).slice(0, 160),
      description: typeof description === 'string' ? description.slice(0, 1600) : undefined,
      version: typeof version === 'string' ? version.slice(0, 80) : undefined, remotes: choices });
  }
  const next = isObject(listing.metadata) ? listing.metadata.nextCursor : undefined;
  return { servers, cursor: typeof next === 'string' && next.length <= 2048 && next !== cursor ? next : undefined };
}

async function withClient<T>(server: McpServer, signal: AbortSignal, action: (client: Client) => Promise<T>): Promise<T> {
  const endpoint = mcpEndpoint(server.endpoint);
  if (!endpoint || endpoint !== server.endpoint) throw new Error('Invalid MCP endpoint.');
  const { Client, StreamableHTTPClientTransport } = await import('@modelcontextprotocol/client');
  const client = new Client({ name: 'Streaik Web', version: '1.0.0' }, server.pinned ? { versionNegotiation: { mode: { pin: revision } } } : undefined);
  const transport = new StreamableHTTPClientTransport(new URL(endpoint), {
    protocolVersion: server.pinned ? revision : undefined,
    requestInit: { redirect: 'error' },
    fetch: async (input, init) => {
      const request = new Request(input, init);
      // Bind credentials to the configured origin AND exact server path. Never follow redirects.
      if (request.url !== endpoint || (server.pinned ? request.method !== 'POST' : !['POST', 'GET', 'DELETE'].includes(request.method))) {
        throw new Error('Unexpected MCP request.');
      }
      const headers = new Headers(request.headers);
      signal.throwIfAborted();
      const credentials = new Headers(await server.requestHeaders());
      credentials.forEach((value, key) => headers.set(key, value));
      if (server.pinned) headers.set('Mcp-Protocol-Version', revision);
      signal.throwIfAborted();
      return fetch(request, { headers, signal: AbortSignal.any([request.signal, signal]), redirect: 'error', credentials: 'omit',
        cache: 'no-store', referrerPolicy: 'no-referrer' });
    },
  });
  try {
    signal.throwIfAborted();
    await client.connect(transport, { signal });
    if (server.pinned && client.getNegotiatedProtocolVersion() !== revision) throw new Error('The MCP revision was not negotiated.');
    return await action(client);
  } finally { await client.close(); }
}

export async function discoverMcpTools(server: McpServer, signal: AbortSignal): Promise<McpTool[]> {
  const bounded = AbortSignal.any([signal, AbortSignal.timeout(20_000)]);
  return withClient(server, bounded, async client => {
    const result = new Map<string, McpTool>();
    let cursor: string | undefined;
    for (let page = 0; page < 4; page++) {
      const { tools, nextCursor } = await client.listTools(cursor ? { cursor } : undefined, { signal: bounded });
      for (const tool of tools) {
        const name = `mcp_${server.id}_${tool.name}`;
        if (!/^[\w-]+$/.test(tool.name) || name.length > 64 || result.has(name)) continue;
        result.set(name, { server, name, remoteName: tool.name, title: tool.title, description: tool.description,
          inputSchema: tool.inputSchema, outputSchema: tool.outputSchema, annotations: tool.annotations });
        if (result.size >= 64) break;
      }
      if (!nextCursor || nextCursor === cursor || result.size >= 64) break;
      cursor = nextCursor;
    }
    return [...result.values()];
  });
}

export async function callMcpTool(tool: McpTool, input: unknown, signal: AbortSignal): Promise<McpOutput> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('The tool input was not a JSON object.');
  const result = await withClient(tool.server, signal, client => client.callTool({
    name: tool.remoteName, arguments: input as Record<string, unknown>,
  }, { signal, timeout: 130_000 }));
  const text = result.content.flatMap(block => block.type === 'text' ? [block.text] : []).join('\n\n').slice(0, 128 * 1024);
  if (result.isError) return { text: `MCP tool failed: ${text || 'The server returned an error.'}`, images: [] };
  const images = result.content.flatMap(block => block.type === 'image' &&
    ['image/png', 'image/jpeg', 'image/webp'].includes(block.mimeType) && /^[A-Za-z0-9+/=]+$/.test(block.data) && block.data.length <= 7_000_000
    ? [`data:${block.mimeType};base64,${block.data}`] : []).slice(0, 4);
  return { text: [text, images.length ? `MCP returned ${images.length} image(s), displayed to the user.` : ''].filter(Boolean).join('\n') || 'MCP tool completed.', images };
}
