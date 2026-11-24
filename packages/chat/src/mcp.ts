import type { Client, Tool } from '@modelcontextprotocol/client';

const revision = '2026-07-28';
const maxServers = 16;

export type McpRemoteHeader = Readonly<{ name: string } & Record<string, unknown>>;
type RequestHeaders = () => HeadersInit | Promise<HeadersInit>;
export type McpOptions = {
  base: URL;
  registryUrl: URL;
  headersForRemote: (headers: readonly McpRemoteHeader[]) => RequestHeaders | undefined;
};
type McpServer = { id: string; title: string; endpoint: string; requestHeaders: RequestHeaders };
export type McpTool = Pick<Tool, 'name' | 'title' | 'description' | 'inputSchema' | 'outputSchema' | 'annotations'> & { server: McpServer; remoteName: string };
export type McpOutput = { text: string; images: string[] };

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isHeader(value: unknown): value is McpRemoteHeader {
  return isObject(value) && typeof value.name === 'string';
}

function trustedEndpoint(value: string, base: URL): string | undefined {
  // Reject ambiguous request paths (encoded separators, dot segments, user info, and URL templates).
  if (!/^https?:\/\/[^/?#@]+(?:\/[\w.~-]+)*\/?$/i.test(value) || /[\\\s]|\/(?:\.|\.\.)(?:\/|$)/.test(value)) return;
  let url: URL;
  try { url = new URL(value); } catch { return; }
  const root = base.pathname.replace(/\/+$/, '');
  if (url.origin !== base.origin || (url.pathname !== root && !url.pathname.startsWith(`${root}/`))) return;
  return url.href;
}

async function discoverServers(options: McpOptions, signal: AbortSignal): Promise<McpServer[]> {
  const response = await fetch(options.registryUrl, {
    signal, redirect: 'error', credentials: 'omit', cache: 'no-store', referrerPolicy: 'no-referrer',
  });
  if (!response.ok) throw new Error('The MCP registry is unavailable.');
  const listing: unknown = await response.json();
  if (!isObject(listing) || !Array.isArray(listing.servers)) throw new Error('Invalid MCP registry response.');

  const servers: McpServer[] = [];
  const ids = new Set<string>();
  const endpoints = new Set<string>();
  for (const item of listing.servers) {
    if (!isObject(item) || !isObject(item.server)) continue;
    const { name, title, remotes } = item.server;
    if (typeof name !== 'string' || !Array.isArray(remotes)) continue;
    const slug = /^[\w.-]+\/([\w.-]+)$/.exec(name)?.[1];
    if (!slug) continue;
    const id = slug.toLowerCase().replace(/[^a-z0-9_]/g, '_');
    if (ids.has(id)) continue;
    for (const remote of remotes) {
      if (!isObject(remote) || remote.type !== 'streamable-http' || typeof remote.url !== 'string') continue;
      const endpoint = trustedEndpoint(remote.url, options.base);
      if (!endpoint || endpoints.has(endpoint)) continue;
      const headers = remote.headers === undefined ? [] : remote.headers;
      if (!Array.isArray(headers) || !headers.every(isHeader)) continue;
      const requestHeaders = options.headersForRemote(headers);
      if (!requestHeaders) continue;
      servers.push({ id, endpoint, title: typeof title === 'string' && title.trim() ? title : slug, requestHeaders });
      ids.add(id);
      endpoints.add(endpoint);
      break;
    }
    if (servers.length === maxServers) break;
  }
  return servers;
}

async function useClient<T>(options: McpOptions, server: McpServer, signal: AbortSignal, action: (client: Client) => Promise<T>): Promise<T> {
  const endpoint = trustedEndpoint(server.endpoint, options.base);
  if (!endpoint) throw new Error('Untrusted MCP endpoint.');
  const { Client, StreamableHTTPClientTransport } = await import('@modelcontextprotocol/client');
  const client = new Client({ name: 'Streaik Web', version: '1.0.0' }, { versionNegotiation: { mode: { pin: revision } } });
  const transport = new StreamableHTTPClientTransport(new URL(endpoint), {
    protocolVersion: revision,
    requestInit: { redirect: 'error' },
    fetch: async (input, init) => {
      const request = new Request(input, init);
      // Bind credentials to the configured origin AND exact server path. Never follow redirects.
      if (request.url !== endpoint || request.method !== 'POST') throw new Error('Unexpected MCP request.');
      const headers = new Headers(request.headers);
      signal.throwIfAborted();
      const credentials = new Headers(await server.requestHeaders());
      credentials.forEach((value, key) => headers.set(key, value));
      headers.set('Mcp-Protocol-Version', revision);
      signal.throwIfAborted();
      return fetch(request, { headers, signal: AbortSignal.any([request.signal, signal]), redirect: 'error', credentials: 'omit',
        cache: 'no-store', referrerPolicy: 'no-referrer' });
    },
  });
  try {
    signal.throwIfAborted();
    await client.connect(transport);
    if (client.getNegotiatedProtocolVersion() !== revision) throw new Error('The MCP revision was not negotiated.');
    return await action(client);
  } finally { await client.close(); }
}

export async function discoverMcpTools(options: McpOptions, signal: AbortSignal): Promise<McpTool[]> {
  signal.throwIfAborted();
  const servers = await discoverServers(options, signal);
  const tools = (await Promise.all(servers.map(server => useClient(options, server, signal, async client => {
    const { tools } = await client.listTools(undefined, { signal });
    return tools.filter(tool => /^[a-zA-Z0-9_-]+$/.test(tool.name)).map(tool => ({
      server, name: `mcp_${server.id}_${tool.name}`, remoteName: tool.name,
      title: tool.title, description: tool.description, inputSchema: tool.inputSchema, outputSchema: tool.outputSchema, annotations: tool.annotations,
    })).filter(tool => tool.name.length <= 64);
  })))).flat();
  const names = new Set<string>();
  return tools.filter(tool => !names.has(tool.name) && names.add(tool.name));
}

export async function callMcpTool(options: McpOptions, tool: McpTool, input: unknown, signal: AbortSignal): Promise<McpOutput> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('The tool input was not a JSON object.');
  const result = await useClient(options, tool.server, signal, client => client.callTool({
    name: tool.remoteName, arguments: input as Record<string, unknown>,
  }, { signal, timeout: 130_000 }));
  const text = result.content.flatMap(block => block.type === 'text' ? [block.text] : []).join('\n\n').slice(0, 128 * 1024);
  if (result.isError) return { text: `MCP tool failed: ${text || 'The server returned an error.'}`, images: [] };
  const images = result.content.flatMap(block => block.type === 'image' &&
    ['image/png', 'image/jpeg', 'image/webp'].includes(block.mimeType) && /^[A-Za-z0-9+/=]+$/.test(block.data) && block.data.length <= 7_000_000
    ? [`data:${block.mimeType};base64,${block.data}`] : []).slice(0, 4);
  return { text: [text, images.length ? `MCP returned ${images.length} image(s), displayed to the user.` : ''].filter(Boolean).join('\n') || 'MCP tool completed.', images };
}
