import { InteractionRequiredAuthError, PublicClientApplication } from '@azure/msal-browser';
import type { AccountInfo, Configuration } from '@azure/msal-browser';
import { GatewayError } from '@streaik/gateway';

const guid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const delegatedScope = (value: string) => /^(api:\/\/|https:\/\/)[^\s]+\/[\w.-]+$/.test(value) && !value.endsWith('/.default');
const profileName = /^[a-z0-9][a-z0-9-]{0,39}$/;

type MsalClient = Pick<PublicClientApplication, 'initialize' | 'getAllAccounts' | 'getActiveAccount' | 'setActiveAccount' | 'loginPopup' | 'logoutPopup' | 'clearCache' | 'acquireTokenSilent'>;

export function readMcpScopes(value?: string): Record<string, string> | undefined {
  if (!value?.trim()) return;
  const scopes: unknown = JSON.parse(value);
  if (!scopes || typeof scopes !== 'object' || Array.isArray(scopes) || Object.entries(scopes).some(([profile, scope]) =>
    !profileName.test(profile) || typeof scope !== 'string' || !delegatedScope(scope))) throw new Error('Configure MCP scopes by profile.');
  return scopes as Record<string, string>;
}

export async function createEntraAuth(config: { tenantId: string; clientId: string; scope: string; agentScope?: string; mcpScope?: string; mcpScopes?: Record<string, string> }, site: URL,
  createClient: (config: Configuration) => MsalClient = (options) => new PublicClientApplication(options)) {
  const { tenantId, clientId, scope, mcpScope } = config;
  if (!guid.test(tenantId) || !guid.test(clientId) || !delegatedScope(scope) || (mcpScope !== undefined && !delegatedScope(mcpScope))) {
    throw new Error('Configure the tenant ID, SPA client ID, and a delegated gateway API scope.');
  }
  const mcpScopes = new Map(Object.entries({ ...(mcpScope ? { default: mcpScope } : {}), ...config.mcpScopes }));
  if ([...mcpScopes].some(([profile, value]) => !profileName.test(profile) || !delegatedScope(value))) throw new Error('Configure MCP scopes by profile.');
  const scopes = [scope];
  const agentScope = config.agentScope && delegatedScope(config.agentScope) ? config.agentScope : undefined;
  const extraScopes = [...new Set([...mcpScopes.values(), ...(agentScope ? [agentScope] : [])])].filter(value => value !== scope);
  const msal = createClient({
    auth: { clientId, authority: `https://login.microsoftonline.com/${tenantId}`, redirectUri: new URL('auth-redirect.html', site).href },
    cache: { cacheLocation: 'sessionStorage' },
  });
  await msal.initialize();
  const known = msal.getAllAccounts().filter((account) => account.tenantId.toLowerCase() === tenantId.toLowerCase());
  const previous = msal.getActiveAccount();
  const isKnown = (account: AccountInfo) => known.some((item) => item.homeAccountId === account.homeAccountId);
  let current = previous && isKnown(previous) ? previous : known.length === 1 ? known[0] : null;
  let revision = 0;
  msal.setActiveAccount(current);

  return {
    clientId,
    getAccount: () => current,
    sessionVersion: () => revision,
    hasAgentScope: !!agentScope,
    hasMcpScope: mcpScopes.size > 0,
    mcpScopeFor: (profile: string) => mcpScopes.get(profile),
    async signIn() {
      const result = await msal.loginPopup({ scopes, prompt: 'select_account',
        extraScopesToConsent: extraScopes.length ? extraScopes : undefined });
      if (result.account.tenantId.toLowerCase() !== tenantId.toLowerCase()) {
        throw new GatewayError('Sign in with an account in the configured Microsoft Entra tenant.');
      }
      current = result.account;
      revision++;
      msal.setActiveAccount(current);
      return current;
    },
    async signOut() {
      const account = current;
      current = null;
      revision++;
      msal.setActiveAccount(null);
      if (!account) return;
      try {
        await msal.logoutPopup({ account, postLogoutRedirectUri: site.href });
      } catch {
        await msal.clearCache({ account });
        throw new GatewayError('Signed out of Streaik, but Microsoft sign-out could not be confirmed.');
      }
    },
    async headers(): Promise<HeadersInit> {
      const account = current;
      const started = revision;
      if (!account) throw new GatewayError('Sign in with Microsoft to use the gateway.');
      try {
        const { accessToken } = await msal.acquireTokenSilent({ account, scopes });
        if (started !== revision || !accessToken) throw new GatewayError('Sign in again to use the gateway.');
        return { Authorization: `Bearer ${accessToken}` };
      } catch (error) {
        if (error instanceof GatewayError) throw error;
        if (error instanceof InteractionRequiredAuthError) throw new GatewayError('Your Microsoft session needs attention. Use Sign in again.');
        throw new GatewayError('Could not obtain a gateway access token. Try signing in again.');
      }
    },
    async agentHeaders(): Promise<HeadersInit> {
      const account = current;
      const started = revision;
      if (!account || !agentScope) throw new GatewayError('Sign in with Microsoft and configure the agent API scope.');
      try {
        const { accessToken } = await msal.acquireTokenSilent({ account, scopes: [agentScope] });
        if (started !== revision || !accessToken) throw new Error();
        return { Authorization: `Bearer ${accessToken}` };
      } catch {
        throw new GatewayError('Could not obtain an agent access token. Sign in again to consent to the agent API scope.');
      }
    },
    async mcpHeaders(profile = 'default'): Promise<HeadersInit> {
      const account = current;
      const started = revision;
      const mcpScope = mcpScopes.get(profile);
      if (!account || !mcpScope) throw new GatewayError('Sign in with Microsoft and configure the MCP API scope.');
      try {
        const { accessToken } = await msal.acquireTokenSilent({ account, scopes: [mcpScope] });
        if (started !== revision || !accessToken) throw new Error();
        return { Authorization: `Bearer ${accessToken}` };
      } catch {
        throw new GatewayError('Could not obtain an MCP access token. Sign in again to consent to the MCP API scope.');
      }
    },
  };
}

export type EntraAuth = Awaited<ReturnType<typeof createEntraAuth>>;
