import type { Client, Tool } from '@modelcontextprotocol/client';
import { isObject, mcpDeclarations, mcpEndpoint } from './mcpConfiguration.ts';
import type { McpRemoteHeader, McpServerRecord } from './mcpConfiguration.ts';
export type { McpRemoteHeader } from './mcpConfiguration.ts';

const revision = '2026-07-28';

type RequestHeaders = (signal?: AbortSignal) => HeadersInit | Promise<HeadersInit>;
export type McpAppAuth = { ready: boolean; headers: RequestHeaders };
export type McpOptions = {
  base?: URL;
  registryUrl?: URL;
  browseCapabilities?: boolean;
  filterRegistryRemote?: (name: string, remote: McpCatalogServer['remotes'][number]) => boolean;
  headersForRemote?: (headers: readonly McpRemoteHeader[], endpoint: string) => McpAppAuth | undefined;
};
export type McpServer = Pick<McpServerRecord, 'id' | 'title' | 'endpoint'> & {
  requestHeaders: RequestHeaders;
};
export type McpTool = Pick<Tool, 'name' | 'title' | 'description' | 'inputSchema' | 'outputSchema' | 'annotations'> & { server: McpServer; remoteName: string };
export type McpOutput = { text: string; images: string[] };
class McpRequestError extends Error {}

export function mcpFailure(error: unknown): string {
  return error instanceof McpRequestError ? error.message : 'The MCP request could not be completed.';
}
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
  return options?.headersForRemote?.(server.declarations, server.endpoint);
}

export function preferredMcpRemote(remotes: McpCatalogServer['remotes'], options: McpOptions | undefined) {
  return remotes.find(remote => mcpAppAuth(options, { ...remote, source: 'registry' })?.ready) ??
    remotes.find(remote => isMcpRuntime(remote.endpoint, options?.base)) ?? remotes[0];
}

export function filterMcpCatalog(servers: McpCatalogServer[], filter: McpOptions['filterRegistryRemote']): McpCatalogServer[] {
  return filter ? servers.flatMap(server => {
    if (!server.remotes.length) return [server];
    const remotes = server.remotes.filter(remote => filter(server.name, remote));
    return remotes.length ? [{ ...server, remotes }] : [];
  }) : servers;
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
  // Transport compatibility is independent of whether the app trusts this URL with managed credentials.
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
      const credentials = new Headers(await server.requestHeaders(signal));
      credentials.forEach((value, key) => headers.set(key, value));
      if (headers.has('Mcp-Session-Id')) throw new Error('Stateful MCP sessions are not supported.');
      headers.set('Mcp-Protocol-Version', revision);
      signal.throwIfAborted();
      const response = await fetch(request, { headers, signal: AbortSignal.any([request.signal, signal]), redirect: 'error', credentials: 'omit',
        cache: 'no-store', referrerPolicy: 'no-referrer' });
      if (!response.ok) {
        void response.body?.cancel().catch(() => {});
        throw new McpRequestError(`The MCP endpoint rejected the ${headers.get('Mcp-Method') === 'tools/call' ? 'tool call' : 'connection'} (HTTP ${response.status}).`);
      }
      if (response.headers.has('Mcp-Session-Id')) {
        void response.body?.cancel().catch(() => {});
        throw new Error('Stateful MCP sessions are not supported.');
      }
      return response;
    },
  });
  try {
    signal.throwIfAborted();
    await client.connect(transport, { signal });
    if (client.getNegotiatedProtocolVersion() !== revision) throw new Error('The required MCP revision is unavailable.');
    return await action(client);
  } finally { await client.close(); }
}

export async function discoverMcpTools(server: McpServer, signal: AbortSignal): Promise<McpTool[]> {
  const bounded = AbortSignal.any([signal, AbortSignal.timeout(20_000)]);
  return withClient(server, bounded, async client => {
    if (!client.getServerCapabilities()?.tools) return [];
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

export function discoverMcpCapabilities(server: McpServer, signal: AbortSignal) {
  const bounded = AbortSignal.any([signal, AbortSignal.timeout(25_000)]);
  return withClient(server, bounded, async client => {
    const caps = client.getServerCapabilities();
    const options = { signal: bounded };
    const [{ resources }, { resourceTemplates }, { prompts }] = await Promise.all([
      caps?.resources ? client.listResources(undefined, options) : { resources: [] },
      caps?.resources ? client.listResourceTemplates(undefined, options) : { resourceTemplates: [] },
      caps?.prompts ? client.listPrompts(undefined, options) : { prompts: [] },
    ]);
    return { resources: resources.slice(0, 64), resourceTemplates: resourceTemplates.slice(0, 64), prompts: prompts.slice(0, 64) };
  });
}

export function mcpTemplateSlots(template: string): string[] | undefined {
  const slot = /\{([A-Za-z0-9_-]+)\}/g;
  if (/[{}]/.test(template.replace(slot, ''))) return;
  return [...new Set([...template.matchAll(slot)].map(match => match[1]))];
}

export function expandMcpResource(template: string, values: Record<string, string>): string {
  if (!mcpTemplateSlots(template)) throw new Error('This URI template is not supported.');
  const uri = template.replace(/\{([A-Za-z0-9_-]+)\}/g, (_, name: string) => {
    const value = Object.hasOwn(values, name) && values[name];
    if (!value || value.length > 2048) throw new Error('Fill in the resource template values.');
    return encodeURIComponent(value).replace(/[!'()*]/g, char => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
  });
  if (uri.length > 8192) throw new Error('The resource URI is too long.');
  return uri;
}

export function readMcpCapability(server: McpServer, item: { uri: string } | { name: string; arguments: Record<string, string> }, signal: AbortSignal) {
  const bounded = AbortSignal.any([signal, AbortSignal.timeout(45_000)]);
  return withClient(server, bounded, async client => {
    if ('uri' in item) {
      const { contents } = await client.readResource(item, { signal: bounded });
      return contents.flatMap(content => 'text' in content && typeof content.text === 'string' ? [content.text] : []).join('\n\n').slice(0, 256 * 1024);
    }
    const { messages } = await client.getPrompt(item, { signal: bounded });
    return messages.flatMap(message => message.content.type === 'text' ? [message.content.text] : []).join('\n\n').slice(0, 256 * 1024);
  });
}

export async function callMcpTool(tool: McpTool, input: unknown, signal: AbortSignal): Promise<McpOutput> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new McpRequestError('The MCP tool input must be a JSON object.');
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
