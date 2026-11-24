import { ChatApp, useAppTranslation } from '@streaik/chat';
import type { McpOptions } from '@streaik/chat';
import { createGateway, GatewayError } from '@streaik/gateway';
import { Button } from '@streaik/themes';
import { useRef, useState } from 'react';
import { appAgents } from '../../shared/appAgents';
import type { McpConfig } from '../../shared/mcpConfig';
import type { EntraAuth } from './auth';
import { createEntraMcpHeaders } from './mcpAuth';

export function EntraApp({ appName, base, auth, mcpConfig }: { appName: string; base: URL; auth: EntraAuth; mcpConfig?: McpConfig }) {
  const { t } = useAppTranslation();
  const [account, setAccount] = useState(auth.getAccount);
  const [revision, setRevision] = useState(0);
  const [busy, setBusy] = useState(false);
  const [issue, setIssue] = useState('');
  const working = useRef(false);
  const [gateway] = useState(() => createGateway(base, auth.headers));
  const [mcp] = useState<McpOptions | undefined>(() => {
    if (!mcpConfig?.base || !auth.hasMcpScope) return mcpConfig;
    const headersFor = createEntraMcpHeaders(mcpConfig.base, auth, auth.clientId);
    return { ...mcpConfig, browseCapabilities: true, headersForRemote: (headers, endpoint) => headers.length === 0
      ? { ready: !!auth.getAccount(), headers: (signal) => headersFor(endpoint, signal) } : undefined };
  });

  async function authenticate(signOut = false) {
    if (working.current) return;
    working.current = true; setBusy(true); setIssue('');
    try {
      if (signOut) {
        setAccount(null);
        await auth.signOut();
      } else {
        setAccount(await auth.signIn());
        setRevision((n) => n + 1);
      }
    } catch (error) {
      setIssue(error instanceof GatewayError ? error.message : 'Microsoft sign-in did not complete. Check pop-up permissions and try again.');
    } finally { working.current = false; setBusy(false); }
  }

  return <ChatApp key={account?.homeAccountId ?? 'signed-out'} appName={appName} gateway={gateway} agents={account ? appAgents : undefined} connection={{
    ready: !!account, modelRevision: revision, mcp, mcpSession: !!account,
    historyProfile: account && `entra:${account.environment}:${account.tenantId}:${account.homeAccountId}` || undefined,
    emptyMessage: t(issue || 'Sign in with Microsoft to start chatting.'),
    account: account ? { name: account.name || account.username, busy, onLogout: () => { void authenticate(true); } } : undefined,
    signIn: !account && <Button onClick={() => { void authenticate(); }} disabled={busy} variant="primary">{t('Sign in')}</Button>,
    settings: <section className="chat-settings-section" aria-labelledby="account-title">
      <h3 id="account-title">Microsoft Entra</h3>
      <p>{t('Provider credentials are managed by the gateway.')}</p>
      {account && <><p>{t('Signed in as {{account}}', { account: account.username })}</p><div><Button onClick={() => { void authenticate(); }} disabled={busy}>{t('Sign in again')}</Button></div></>}
      {issue && <p role="alert">{t(issue)}</p>}
    </section>,
  }} />;
}
