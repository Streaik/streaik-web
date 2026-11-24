import type { EntraAuth } from './auth';

const resourceMetadata = '/.well-known/oauth-protected-resource';
const issuerMetadata = '/.well-known/oauth-authorization-server';
const exchangeGrant = 'urn:ietf:params:oauth:grant-type:token-exchange';
const accessTokenType = 'urn:ietf:params:oauth:token-type:access_token';
const fetchOptions = { redirect: 'error', credentials: 'omit', cache: 'no-store', referrerPolicy: 'no-referrer' } as const;
type Auth = Pick<EntraAuth, 'getAccount' | 'sessionVersion' | 'mcpScopeFor' | 'mcpHeaders'>;

async function json(url: string, init: RequestInit) {
  const response = await fetch(url, { ...init, ...fetchOptions });
  if (!response.ok) {
    void response.body?.cancel().catch(() => {});
    throw new Error('Could not authenticate the MCP connection.');
  }
  const value: unknown = await response.json();
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid MCP OAuth response.');
  return value as Record<string, unknown>;
}

export function createEntraMcpHeaders(base: URL, auth: Auth, clientId: string) {
  const prefix = base.pathname.replace(/\/+$/, '');
  const origin = base.origin;
  const issuerBase = `${origin}${prefix}/oauth/`;
  const cache = new Map<string, { token: string; expiresAt: number }>();
  let current = -1;

  return async (endpoint: string, signal?: AbortSignal): Promise<HeadersInit> => {
    const revision = auth.sessionVersion();
    if (revision !== current) { cache.clear(); current = revision; }
    function active() {
      signal?.throwIfAborted();
      if (!auth.getAccount() || revision !== auth.sessionVersion()) throw new Error('Microsoft sign-in changed.');
    }
    active();
    const url = new URL(endpoint);
    if (url.origin !== origin || url.username || url.password || url.search || url.hash || endpoint !== url.href ||
      !url.pathname.startsWith(`${prefix}/`) || !/^[a-z0-9-]+$/.test(url.pathname.slice(prefix.length + 1))) {
      throw new Error('The MCP endpoint is outside the configured Entra host.');
    }
    const saved = cache.get(endpoint);
    if (saved && saved.expiresAt > Date.now()) return { Authorization: `Bearer ${saved.token}` };

    const resource = await json(origin + resourceMetadata + url.pathname, { signal });
    const issuers = resource.authorization_servers;
    if (resource.resource !== endpoint || !Array.isArray(issuers) || issuers.length !== 1 || typeof issuers[0] !== 'string' || !issuers[0].startsWith(issuerBase)) {
      throw new Error('Unexpected MCP protected-resource metadata.');
    }
    const issuer = issuers[0];
    const profile = issuer.slice(issuerBase.length);
    const scope = /^[a-z0-9][a-z0-9-]{0,39}$/.test(profile) ? auth.mcpScopeFor(profile) : undefined;
    if (!scope || !Array.isArray(resource.scopes_supported) || !resource.scopes_supported.includes(scope)) throw new Error('No trusted Entra scope for this MCP server.');

    const tokenEndpoint = `${issuer}/token`;
    const metadata = await json(`${origin}${issuerMetadata}${prefix}/oauth/${profile}`, { signal });
    if (metadata.issuer !== issuer || metadata.token_endpoint !== tokenEndpoint || !Array.isArray(metadata.grant_types_supported) ||
      !metadata.grant_types_supported.includes(exchangeGrant)) throw new Error('Unexpected MCP authorization server metadata.');
    active();

    const subject = new Headers(await auth.mcpHeaders(profile)).get('Authorization');
    active();
    if (!subject?.startsWith('Bearer ')) throw new Error('No Microsoft access token for the MCP server.');
    const result = await json(tokenEndpoint, { method: 'POST', signal, body: new URLSearchParams({
      grant_type: exchangeGrant, subject_token: subject.slice(7), subject_token_type: accessTokenType,
      resource: endpoint, client_id: clientId,
    }) });
    active();
    const { access_token: token, expires_in: expiresIn } = result;
    if (result.token_type !== 'Bearer' || result.issued_token_type !== accessTokenType || typeof token !== 'string' ||
      token.length > 24_000 || !/^mcp1\.[A-Za-z0-9_-]+$/.test(token) || typeof expiresIn !== 'number' || !Number.isFinite(expiresIn) || expiresIn <= 0) {
      throw new Error('Invalid MCP access token response.');
    }
    if (cache.size >= 32) cache.clear();
    cache.set(endpoint, { token, expiresAt: Date.now() + (Math.min(expiresIn, 900) - 30) * 1000 });
    return { Authorization: `Bearer ${token}` };
  };
}
