export type McpInput = {
  description?: string;
  isRequired?: boolean;
  isSecret?: boolean;
  default?: string;
  choices?: string[];
  format?: string;
};
export type McpRemoteHeader = McpInput & { name: string; value?: string; variables?: Record<string, McpInput>; manualOnly?: boolean };
export type McpHeaderRow = { name: string; value: string };
export type McpHeaderField = McpInput & { id: string; label: string; value: string; fixed?: boolean };
export type McpServerRecord = {
  id: string;
  title: string;
  endpoint: string;
  source: 'manual' | 'registry';
  declarations: McpRemoteHeader[];
  auth: 'manual' | 'app';
  extraNames: string[];
  needsSession?: boolean;
};

export const maxMcpServers = 64;
const maxHeaders = 24;
const templateToken = /\{([\w.-]+)\}/g;
const reservedHeader = /^(?:accept(?:-.*)?|connection|content-.*|cookie2?|host|origin|referer|user-agent|upgrade|transfer-encoding|expect|te|trailer|via|access-control-.*|set-cookie|permissions-policy|keep-alive|mcp-.*|proxy-.*|sec-.*|x-http-method(?:-override)?|x-method-override)$/i;

export function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function mcpEndpoint(value: string): string | undefined {
  const raw = value.trim();
  if (raw.length > 2048 || !/^https?:\/\/[^/?#@]+(?:\/[\w.~-]+)*\/?$/i.test(raw) || /[\\\s]|\/(?:\.|\.\.)(?:\/|$)/.test(raw)) return;
  try {
    const url = new URL(raw);
    if (url.protocol === 'https:' || ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) return url.href;
  } catch { return; }
}

export function validMcpHeaderName(name: string) {
  return name.length <= 128 && /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(name) && !reservedHeader.test(name);
}

function headerValue(value: string) {
  return value.length <= 8192 && value.trim() && !/[^\x20-\x7e]/.test(value);
}

function stringField(value: unknown, max: number) {
  return typeof value === 'string' && value.length <= max ? value : undefined;
}

function input(value: Record<string, unknown>, secret: boolean): McpInput {
  const fallback = !secret ? stringField(value.default, 2048) : undefined;
  const choices = !secret && Array.isArray(value.choices) ? value.choices.slice(0, 32).filter((item): item is string =>
    typeof item === 'string' && !!headerValue(item)) : undefined;
  return { description: stringField(value.description, 500), isSecret: secret, isRequired: value.isRequired === true,
    default: fallback, choices: choices?.length ? choices : undefined, format: stringField(value.format, 24) };
}

/** Keep only form metadata. Secret defaults, values and choices are never read into form state or storage. */
export function mcpDeclarations(value: unknown): McpRemoteHeader[] | undefined {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > maxHeaders) return;
  const declarations: McpRemoteHeader[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (!isObject(item) || typeof item.name !== 'string' || !validMcpHeaderName(item.name)) return;
    const name = item.name;
    if (seen.has(name.toLowerCase())) return;
    seen.add(name.toLowerCase());
    const secret = item.isSecret === true || /(?:authorization|token|api-key|secret)/i.test(name);
    const raw = stringField(item.value, 2048);
    const keys = raw ? [...new Set([...raw.matchAll(templateToken)].map(match => match[1]!))] : [];
    if (keys.length > maxHeaders) return;
    const template = !!keys.length && !!raw && !/[{}]/.test(raw.replace(templateToken, ''));
    // Secret templates may declare a variable or a standard Bearer prefix, never a literal secret.
    const safeTemplate = template && (!secret || /^(?:Bearer )?\{[\w.-]+\}$/i.test(raw!));
    const variables = safeTemplate ? Object.fromEntries(keys.map(key => {
      const definition = isObject(item.variables) && Object.hasOwn(item.variables, key) && isObject(item.variables[key]) ? item.variables[key] : {};
      return [key, input(definition, secret || definition.isSecret === true)];
    })) : undefined;
    const manualOnly = item.manualOnly === true || (secret && (item.isSecret !== true || item.default !== undefined ||
      (item.value !== undefined && !safeTemplate) || (item.variables !== undefined && !safeTemplate)));
    declarations.push({ name, ...input(item, secret), manualOnly,
      value: safeTemplate || (!secret && !keys.length && raw && !/[{}]/.test(raw) && headerValue(raw)) ? raw : undefined,
      variables });
  }
  return declarations;
}

export function mcpHeaderFields(declarations: readonly McpRemoteHeader[], saved: ReadonlyMap<string, string>): McpHeaderField[] {
  return declarations.flatMap<McpHeaderField>(header => {
    const key = header.name.toLowerCase();
    if (!header.variables) return [{ ...header, id: key, label: header.name,
      value: header.value ?? saved.get(key) ?? header.default ?? '', fixed: header.value !== undefined }];
    return Object.entries(header.variables).map(([name, variable]) => {
      const id = `${key}:${name}`;
      return { ...variable, id, label: name, description: variable.description ?? header.description,
        isRequired: header.isRequired || variable.isRequired, value: saved.get(id) ?? variable.default ?? '' };
    });
  });
}

export function resolveMcpHeaders(declarations: readonly McpRemoteHeader[], saved: ReadonlyMap<string, string>, rows: readonly McpHeaderRow[]): Headers {
  const headers = new Headers();
  const fields = new Map(mcpHeaderFields(declarations, saved).map(field => [field.id, field]));
  const seen = new Set(declarations.map(header => header.name.toLowerCase()));
  function append(name: string, value: string) {
    if (!validMcpHeaderName(name) || !headerValue(value)) throw new Error('Enter a valid HTTP header name and value.');
    headers.set(name, value);
  }
  function validate(field: McpHeaderField) {
    const { value } = field;
    if (!value.trim() || !headerValue(value) || /\{[\w.-]+\}/.test(value)) throw new Error('Fill in the required header fields.');
    if ((field.choices && !field.choices.includes(value)) || (field.format === 'number' && !Number.isFinite(Number(value))) ||
        (field.format === 'boolean' && value !== 'true' && value !== 'false')) throw new Error('Enter a valid value for each header field.');
    return value;
  }
  for (const header of declarations) {
    const key = header.name.toLowerCase();
    if (header.variables) {
      const variables = Object.keys(header.variables).map(name => fields.get(`${key}:${name}`)!);
      if (variables.every(field => !field.isRequired && !field.value)) continue;
      append(header.name, header.value!.replace(templateToken, (_, name: string) => validate(fields.get(`${key}:${name}`)!)));
    } else {
      const field = fields.get(key)!;
      if (field.isRequired || field.value) append(header.name, validate(field));
    }
  }
  if (rows.length > maxHeaders) throw new Error('Too many custom headers.');
  for (const { name, value } of rows) {
    const key = name.toLowerCase();
    if (seen.has(key)) throw new Error('Header names must be unique.');
    seen.add(key);
    append(name, value);
  }
  return headers;
}

export function parseMcpServer(value: unknown): McpServerRecord | undefined {
  if (!isObject(value) || typeof value.id !== 'string' || !/^[\w.-]{1,80}$/.test(value.id) || typeof value.endpoint !== 'string' ||
      typeof value.title !== 'string' || !value.title.trim() || value.title.length > 160 ||
      (value.source !== 'registry' && value.source !== 'manual') || (value.auth !== 'manual' && value.auth !== 'app') ||
      (value.auth === 'app' && value.source !== 'registry') || !Array.isArray(value.extraNames) || value.extraNames.length > maxHeaders ||
      !value.extraNames.every(name => typeof name === 'string' && validMcpHeaderName(name))) return;
  const endpoint = mcpEndpoint(value.endpoint);
  const declarations = mcpDeclarations(value.declarations);
  if (!endpoint || !declarations || (value.source === 'manual' && declarations.length)) return;
  return { id: value.id, title: value.title, endpoint, source: value.source, auth: value.auth, declarations, extraNames: value.extraNames,
    needsSession: value.needsSession === true };
}
