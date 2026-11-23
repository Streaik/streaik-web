import type { Client, Tool } from '@modelcontextprotocol/client';

const revision = '2026-07-28';

export type McpOptions = {
  base: URL;
  headers: (provider: McpProvider) => HeadersInit | Promise<HeadersInit>;
};
type McpProvider = 'openai' | 'google' | 'anthropic';
type McpServer = { id: string; title: string; path: string; provider: McpProvider };
export type McpTool = Pick<Tool, 'name' | 'title' | 'description' | 'inputSchema' | 'outputSchema' | 'annotations'> & { server: McpServer; remoteName: string };
export type McpOutput = { text: string; images: string[] };

async function useClient<T>(options: McpOptions, server: McpServer, signal: AbortSignal, action: (client: Client) => Promise<T>): Promise<T> {
  const { Client, StreamableHTTPClientTransport } = await import('@modelcontextprotocol/client');
  const endpoint = new URL(server.path.slice(1), options.base).href;
  const client = new Client({ name: 'Streaik Web', version: '1.0.0' }, { versionNegotiation: { mode: { pin: revision } } });
  const transport = new StreamableHTTPClientTransport(new URL(endpoint), {
    protocolVersion: revision,
    requestInit: { redirect: 'error' },
    fetch: async (input, init) => {
      const request = new Request(input, init);
      // Bind credentials to the configured origin AND exact server path. Never follow redirects.
      if (request.url !== endpoint || request.method !== 'POST') throw new Error('Unexpected MCP request.');
      const headers = new Headers(request.headers);
      const credentials = new Headers(await options.headers(server.provider));
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
  const response = await fetch(new URL('catalog.json', options.base), { signal, redirect: 'error', credentials: 'omit', cache: 'no-store', referrerPolicy: 'no-referrer' });
  if (!response.ok) throw new Error('The MCP catalog is unavailable.');
  const catalog = await response.json();
  if (catalog?.schemaVersion !== 1 || catalog.protocolVersion !== revision || !Array.isArray(catalog.servers) || catalog.servers.length > 16)
    throw new Error('Invalid MCP catalog.');
  const seen = new Set<string>();
  const servers: McpServer[] = catalog.servers.map((server: Partial<McpServer> | null) => {
    if (!server || typeof server.id !== 'string' || !/^[a-z][a-z0-9-]{0,31}$/.test(server.id) || seen.has(server.id) ||
        server.path !== `/${server.id}` || typeof server.title !== 'string' ||
        (server.provider !== 'openai' && server.provider !== 'google' && server.provider !== 'anthropic')) throw new Error('Invalid MCP catalog entry.');
    seen.add(server.id);
    return { id: server.id, title: server.title, path: server.path, provider: server.provider };
  });
  const tools = (await Promise.all(servers.map(server => useClient(options, server, signal, async client => {
    const { tools } = await client.listTools(undefined, { signal });
    return tools.filter(tool => /^[a-zA-Z0-9_-]+$/.test(tool.name)).map(tool => ({
      server, name: `mcp_${server.id.replaceAll('-', '_')}_${tool.name}`, remoteName: tool.name,
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
