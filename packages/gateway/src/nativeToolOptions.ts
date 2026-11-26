import type { NativeChatEndpoint } from './index.ts';
import { asRecord } from './directMetrics.ts';

const ownedResponsesFields = new Set([
  'model', 'input', 'messages', 'instructions', 'prompt', 'stream', 'stream_options', 'store', 'background',
  'previous_response_id', 'conversation', 'tools', 'tool_choice', 'authorization', 'api_key', 'apikey', 'x-api-key', 'headers', 'openai',
]);

export function mergeOpenAIResponsesOptions(body: BodyInit | null | undefined, options: Record<string, unknown> | undefined,
  registeredSearch: boolean) {
  if ((!options && !registeredSearch) || typeof body !== 'string') return body;
  const request = asRecord(JSON.parse(body));
  if (!request) return body;
  // The SDK needs the search definition to decode/replay search parts. The saved native
  // definition is authoritative on the wire (and may be absent on a replay-only turn).
  const generated = (Array.isArray(request.tools) ? request.tools : []).filter(tool => asRecord(tool)?.type !== 'tool_search');
  const saved = Array.isArray(options?.tools) ? options.tools : [];
  const clientSearch = saved.map(asRecord).some(tool => tool?.type === 'tool_search' && tool.execution === 'client');
  const deferredFunction = (raw: unknown) => { const tool = asRecord(raw); return tool?.type === 'function' && tool.defer_loading === true; };
  const tools = [...generated, ...saved].flatMap(raw => {
    if (!clientSearch) return [raw];
    const tool = asRecord(raw);
    if (tool?.type === 'namespace' && Array.isArray(tool.tools)) {
      const members = tool.tools.filter(member => !deferredFunction(member));
      return members.length ? [{ ...tool, tools: members }] : [];
    }
    return deferredFunction(raw) ? [] : [raw];
  });
  for (const [key, value] of Object.entries(options ?? {})) {
    if (!ownedResponsesFields.has(key.toLowerCase())) request[key] = value;
  }
  if (tools.length) request.tools = tools;
  else { delete request.tools; delete request.tool_choice; }
  return JSON.stringify(request);
}

/** Extend only client function definitions; let the SDK own all other protocol fields. */
export function extendNativeTools(body: BodyInit | null | undefined, definitions: unknown, endpoint: NativeChatEndpoint, model: string) {
  const provider = model.split('/')[0]?.toLowerCase();
  const responses = endpoint === '/v1/responses' && provider === 'openai';
  const messages = endpoint === '/v1/messages' && provider === 'anthropic';
  if ((!responses && !messages) || !Array.isArray(definitions) || typeof body !== 'string') return body;
  const optionsByName = new Map<string, Record<string, unknown>>();
  for (const definition of definitions) {
    const entry = asRecord(definition);
    if (typeof entry?.name === 'string' && (entry.allowed_callers || entry.defer_loading || (responses && entry.namespace))) {
      optionsByName.set(entry.name, entry);
    }
  }
  if (!optionsByName.size) return body;
  const request = asRecord(JSON.parse(body));
  if (!request || !Array.isArray(request.tools)) return body;
  const namespaces = new Map<string, { type: 'namespace'; name: string; description: string; tools: object[] }>();
  const namespaceByTool = new Map<string, string>();
  const ordinary = request.tools.flatMap(raw => {
    const tool = asRecord(raw);
    if (!tool || typeof tool.name !== 'string' || (responses ? tool.type !== 'function' : tool.type && tool.type !== 'custom')) return [raw];
    const options = optionsByName.get(tool.name);
    if (!options) return [raw];
    const callers = Array.isArray(options.allowed_callers) ? options.allowed_callers.filter(caller => caller === 'direct' || caller === 'programmatic') : [];
    const configured = { ...tool, ...(callers.length && { allowed_callers: callers }), ...(options.defer_loading === true && { defer_loading: true }) };
    const name = responses && asRecord(options.namespace)?.name;
    if (typeof name !== 'string' || !/^[a-z0-9_-]{1,64}$/.test(name)) return [configured];
    let namespace = namespaces.get(name);
    if (!namespace) {
      namespace = { type: 'namespace', name, description: name === 'local' ? 'Locally available application tools.' : `Tools provided by ${name}.`, tools: [] };
      namespaces.set(name, namespace);
    }
    namespace.tools.push(configured);
    namespaceByTool.set(tool.name, name);
    return [];
  });
  const input = responses && namespaces.size > 0 && Array.isArray(request.input) ? request.input.map(raw => {
    const call = asRecord(raw);
    const namespace = typeof call?.name === 'string' && namespaceByTool.get(call.name);
    return namespace && call?.type === 'function_call' && !call.namespace ? { ...call, namespace } : raw;
  }) : request.input;
  return JSON.stringify({ ...request, tools: [...ordinary, ...namespaces.values()], ...(input !== undefined && { input }) });
}
