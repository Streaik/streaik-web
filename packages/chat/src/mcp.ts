import type { Client, Tool } from '@modelcontextprotocol/client';
import { defaultMcpPreferences } from './mcpPreferences.ts';
import type { McpPreferences } from './mcpPreferences.ts';
import type { RequestElicitation } from './elicitation.ts';
import { isObject, mcpDeclarations, mcpEndpoint } from './mcpConfiguration.ts';
import type { McpRemoteHeader, McpServerRecord } from './mcpConfiguration.ts';
import { maxMcpImagePreviews, mcpImagePreview } from './toolOutputContent.ts';
export type { McpRemoteHeader } from './mcpConfiguration.ts';

const revision = '2026-07-28';
const entraProtectedRemotes = 'net.streaik/entra-protected-remotes';

type RequestHeaders = (signal?: AbortSignal) => HeadersInit | Promise<HeadersInit>;
export type McpAppAuth = { ready: boolean; headers: RequestHeaders; challengeOnly?: boolean };
export type McpOptions = {
  base?: URL;
  registryUrl?: URL;
  filterRegistryRemote?: (name: string, remote: McpCatalogServer['remotes'][number]) => boolean;
  headersForRemote?: (headers: readonly McpRemoteHeader[], endpoint: string) => McpAppAuth | undefined;
};
export type McpServer = Pick<McpServerRecord, 'id' | 'title' | 'endpoint'> & {
  requestHeaders: RequestHeaders;
  challengeOnly?: boolean;
};
export type McpTool = Pick<Tool, 'name' | 'title' | 'description' | 'inputSchema' | 'outputSchema' | 'annotations'> & { server: McpServer; remoteName: string };
export type McpOutput = { text: string; images: string[] };
export type McpResource = Awaited<ReturnType<Client['listResources']>>['resources'][number];
export type McpResourceTemplate = Awaited<ReturnType<Client['listResourceTemplates']>>['resourceTemplates'][number];
export type McpPrompt = Awaited<ReturnType<Client['listPrompts']>>['prompts'][number];
type McpCompletionParams = Parameters<Client['complete']>[0];
export type McpCompletionReference = McpCompletionParams['ref'];
export const maxMcpArgumentLength = 2048;
class McpRequestError extends Error {}

export function mcpFailure(error: unknown): string {
  return error instanceof McpRequestError ? error.message : 'The MCP request could not be completed.';
}
export type McpCatalogServer = { name: string; title: string; description?: string; version?: string;
  remotes: (Pick<McpServerRecord, 'endpoint' | 'declarations'> & { requiresEntra?: true })[] };

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
    const { name, title, description, version, remotes, _meta } = item.server;
    if (typeof name !== 'string' || !name.trim() || name.length > 240 || names.has(name)) continue;
    const protectedUrls = isObject(_meta) ? _meta[entraProtectedRemotes] : undefined;
    const protectedEndpoints = new Set(Array.isArray(protectedUrls) ? protectedUrls.flatMap(url => {
      const endpoint = typeof url === 'string' ? mcpEndpoint(url) : undefined;
      return endpoint ? [endpoint] : [];
    }) : []);
    const choices: McpCatalogServer['remotes'] = [];
    for (const remote of Array.isArray(remotes) ? remotes : []) {
      if (!isObject(remote) || remote.type !== 'streamable-http' || typeof remote.url !== 'string') continue;
      const endpoint = mcpEndpoint(remote.url);
      const declarations = mcpDeclarations(remote.headers);
      if (endpoint && declarations && !choices.some(remote => remote.endpoint === endpoint)) {
        choices.push({ endpoint, declarations, ...(protectedEndpoints.has(endpoint) ? { requiresEntra: true } : {}) });
      }
    }
    names.add(name);
    servers.push({ name, title: (typeof title === 'string' && title.trim() || name.split('/').at(-1) || name).slice(0, 160),
      description: typeof description === 'string' ? description.slice(0, 1600) : undefined,
      version: typeof version === 'string' ? version.slice(0, 80) : undefined, remotes: choices });
  }
  const next = isObject(listing.metadata) ? listing.metadata.nextCursor : undefined;
  return { servers, cursor: typeof next === 'string' && next.length <= 2048 && next !== cursor ? next : undefined };
}

async function withClient<T>(server: McpServer, signal: AbortSignal, action: (client: Client) => Promise<T>, elicit?: RequestElicitation): Promise<T> {
  const endpoint = mcpEndpoint(server.endpoint);
  if (!endpoint || endpoint !== server.endpoint) throw new Error('Invalid MCP endpoint.');
  const { Client, StreamableHTTPClientTransport } = await import('@modelcontextprotocol/client');
  // Transport compatibility is independent of whether the app trusts this URL with managed credentials.
  const client = new Client({ name: 'Streaik Web', version: '1.0.0' }, {
    versionNegotiation: { mode: { pin: revision } },
    ...(elicit ? { capabilities: { elicitation: { form: {} } } } : {}),
  });
  if (elicit) client.setRequestHandler('elicitation/create', ({ params }, context) => {
    if (params.mode === 'url') throw new McpRequestError('URL elicitation is not supported yet.');
    return elicit(params, { title: server.title, origin: new URL(endpoint).origin }, AbortSignal.any([signal, context.mcpReq.signal]));
  });
  let sendCredentials = !server.challengeOnly;
  const transport = new StreamableHTTPClientTransport(new URL(endpoint), {
    protocolVersion: revision,
    requestInit: { redirect: 'error' },
    fetch: async (input, init) => {
      const request = new Request(input, init);
      // Bind credentials to the configured origin AND exact server path. Never follow redirects.
      if (request.url !== endpoint || request.method !== 'POST') throw new Error('Unexpected MCP request.');
      const headers = new Headers(request.headers);
      const canChallenge = !sendCredentials && headers.get('Mcp-Method') === 'server/discover';
      async function send(message: Request) {
        signal.throwIfAborted();
        if (sendCredentials) new Headers(await server.requestHeaders(signal)).forEach((value, key) => headers.set(key, value));
        if (headers.has('Mcp-Session-Id')) throw new Error('Stateful MCP sessions are not supported.');
        headers.set('Mcp-Protocol-Version', revision);
        signal.throwIfAborted();
        return fetch(message, { headers, signal: AbortSignal.any([request.signal, signal]), redirect: 'error', credentials: 'omit',
          cache: 'no-store', referrerPolicy: 'no-referrer' });
      }
      let response = await send(canChallenge ? request.clone() : request);
      if (canChallenge && response.status === 401 && /^Bearer(?:\s|$)/i.test(response.headers.get('WWW-Authenticate') ?? '')) {
        void response.body?.cancel().catch(() => {});
        sendCredentials = true;
        response = await send(request);
      }
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

async function listMcpEntries<T>(fetchPage: (cursor?: string) => Promise<readonly [readonly T[], string?]>,
  key: (item: T) => string, accept: (item: T) => boolean = () => true): Promise<T[]> {
  const result = new Map<string, T>();
  const cursors = new Set<string>();
  let cursor: string | undefined;
  for (let page = 0; page < 4; page++) {
    const [items, nextCursor] = await fetchPage(cursor);
    for (const item of items) {
      if (accept(item) && !result.has(key(item))) result.set(key(item), item);
      if (result.size === 64) return [...result.values()];
    }
    if (!nextCursor || nextCursor.length > 2048 || cursors.has(nextCursor)) break;
    cursors.add(nextCursor);
    cursor = nextCursor;
  }
  return [...result.values()];
}

export function discoverMcpServer(server: McpServer, signal: AbortSignal) {
  const bounded = AbortSignal.any([signal, AbortSignal.timeout(25_000)]);
  return withClient(server, bounded, async client => {
    const caps = client.getServerCapabilities();
    const options = { signal: bounded };
    const [toolsResult, resourcesResult, templatesResult, promptsResult] = await Promise.allSettled([
      caps?.tools ? listMcpEntries(async cursor => {
        const { tools, nextCursor } = await client.listTools(cursor ? { cursor } : undefined, options);
        return [tools, nextCursor];
      }, (tool: Tool) => tool.name, tool => /^[\w-]+$/.test(tool.name) && `mcp_${server.id}_${tool.name}`.length <= 64) : [],
      caps?.resources ? listMcpEntries(async cursor => {
        const { resources, nextCursor } = await client.listResources(cursor ? { cursor } : undefined, options);
        return [resources, nextCursor];
      }, (resource: McpResource) => resource.uri, resource => validMcpResourceUri(resource.uri)) : [],
      caps?.resources ? listMcpEntries(async cursor => {
        const { resourceTemplates, nextCursor } = await client.listResourceTemplates(cursor ? { cursor } : undefined, options);
        return [resourceTemplates, nextCursor];
      }, (template: McpResourceTemplate) => template.uriTemplate, template => template.uriTemplate.length <= 8192) : [],
      caps?.prompts ? listMcpEntries(async cursor => {
        const { prompts, nextCursor } = await client.listPrompts(cursor ? { cursor } : undefined, options);
        return [prompts, nextCursor];
      }, (prompt: McpPrompt) => prompt.name, prompt => prompt.name.length <= 512) : [],
    ]);
    signal.throwIfAborted();
    if (toolsResult.status === 'rejected' && !caps?.resources && !caps?.prompts) throw toolsResult.reason;
    const tools: McpTool[] = toolsResult.status === 'fulfilled' ? toolsResult.value.map(tool => {
      const name = `mcp_${server.id}_${tool.name}`;
      return { server, name, remoteName: tool.name, title: tool.title, description: tool.description,
        inputSchema: tool.inputSchema, outputSchema: tool.outputSchema, annotations: tool.annotations };
    }) : [];
    return { tools, hasResources: !!caps?.resources, hasPrompts: !!caps?.prompts, hasCompletions: !!caps?.completions,
      resources: resourcesResult.status === 'fulfilled' ? resourcesResult.value : [],
      resourceTemplates: templatesResult.status === 'fulfilled' ? templatesResult.value : [],
      prompts: promptsResult.status === 'fulfilled' ? promptsResult.value : [], promptsFailed: promptsResult.status === 'rejected' };
  });
}

export type McpDiscovery = Awaited<ReturnType<typeof discoverMcpServer>>;

export function completeMcpArgument(server: McpServer, params: McpCompletionParams, signal: AbortSignal) {
  const bounded = AbortSignal.any([signal, AbortSignal.timeout(10_000)]);
  return withClient(server, bounded, async client => {
    if (!client.getServerCapabilities()?.completions) return [];
    const { completion } = await client.complete(params, { signal: bounded });
    return [...new Set(completion.values.slice(0, 100).filter(value =>
      value.length <= maxMcpArgumentLength && value.trim() && !/[\r\n]/.test(value)))];
  });
}

export function validMcpResourceUri(uri: unknown): uri is string {
  return typeof uri === 'string' && uri.length <= 8192 && /^[a-z][a-z\d+.-]*:[^\s]*$/i.test(uri);
}

export function mcpTemplateSlots(template: string): string[] | undefined {
  const slot = /\{([A-Za-z0-9_-]+)\}/g;
  if (/[{}]/.test(template.replace(slot, ''))) return;
  return [...new Set([...template.matchAll(slot)].map(match => match[1]))];
}

export function expandMcpResource(template: string, values: Record<string, string>): string {
  if (!mcpTemplateSlots(template)) throw new McpRequestError('This URI template is not supported.');
  const uri = template.replace(/\{([A-Za-z0-9_-]+)\}/g, (_, name: string) => {
    const value = Object.hasOwn(values, name) && values[name];
    if (!value || value.length > maxMcpArgumentLength) throw new McpRequestError('Fill in the resource template values.');
    return encodeURIComponent(value).replace(/[!'()*]/g, char => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
  });
  if (uri.length > 8192) throw new McpRequestError('The resource URI is too long.');
  return uri;
}

export function readMcpResource(server: McpServer, uri: string, signal: AbortSignal, elicit?: RequestElicitation) {
  if (!validMcpResourceUri(uri)) throw new McpRequestError('Use an absolute MCP resource URI.');
  const bounded = AbortSignal.any([signal, AbortSignal.timeout(45_000)]);
  return withClient(server, bounded, async client => {
    // A resource URI is an opaque RPC argument, not a browser fetch destination.
    const { contents } = await client.readResource({ uri }, { signal: bounded });
    return { contents, ...mcpOutput(contents.map(content => 'text' in content ? { type: 'text', text: content.text }
      : { type: 'image', mimeType: content.mimeType, data: content.blob })) };
  }, elicit);
}

export function getMcpPrompt(server: McpServer, name: string, args: Record<string, string>, signal: AbortSignal, elicit?: RequestElicitation) {
  const bounded = AbortSignal.any([signal, AbortSignal.timeout(45_000)]);
  return withClient(server, bounded, async client => {
    const { messages } = await client.getPrompt({ name, arguments: args }, { signal: bounded });
    // Like AI Happy, use the prompt as a user turn, never as trusted system instructions.
    return messages.flatMap(({ content }) => content.type === 'text' ? [content.text]
      : content.type === 'resource' && 'text' in content.resource ? [content.resource.text] : []).join('\n\n').slice(0, 128 * 1024);
  }, elicit);
}

function mcpOutput(content: readonly { type: string; text?: string; mimeType?: string; data?: string }[]): McpOutput {
  const text = content.flatMap(block => block.type === 'text' && block.text ? [block.text] : []).join('\n\n').slice(0, 128 * 1024);
  const images: string[] = [];
  for (const block of content) {
    if (block.type !== 'image') continue;
    const preview = mcpImagePreview(block.mimeType, block.data);
    if (preview) images.push(preview);
    if (images.length === maxMcpImagePreviews) break;
  }
  return { text, images };
}

export async function callMcpTool(tool: McpTool, input: unknown, signal: AbortSignal,
  preferences: McpPreferences = defaultMcpPreferences, elicit?: RequestElicitation) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new McpRequestError('The MCP tool input must be a JSON object.');
  const timeout = preferences.toolTimeoutMinutes * 60_000;
  const resetTimeoutOnProgress = preferences.resetTimeoutOnProgress;
  // Bound the whole operation, including time spent awaiting form input. The SDK's idle timeout applies per HTTP leg.
  const bounded = AbortSignal.any([signal, AbortSignal.timeout(resetTimeoutOnProgress ? timeout * 2 : timeout)]);
  const result = await withClient(tool.server, bounded, client => client.callTool({
    name: tool.remoteName, arguments: input as Record<string, unknown>,
  }, { signal: bounded, timeout, resetTimeoutOnProgress, ...(resetTimeoutOnProgress ? { onprogress: () => {} } : {}) }),
  preferences.formElicitation ? elicit : undefined);
  // Keep the model-visible fields intact. Request metadata (including result _meta) is for the client, not the model.
  const { content, structuredContent, isError } = result;
  const output = { content, ...(structuredContent !== undefined && { structuredContent }), ...(isError !== undefined && { isError }) };
  return { output };
}
