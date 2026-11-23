import { ChatApp, useAppTranslation } from '@streaik/chat';
import { createGateway, GatewayError } from '@streaik/gateway';
import { Button } from '@streaik/themes';
import { useRef, useState } from 'react';
import { appAgents } from '../../shared/appAgents';
import type { EntraAuth } from './auth';

export function EntraApp({ appName, base, auth, mcpBase }: { appName: string; base: URL; auth: EntraAuth; mcpBase?: URL }) {
  const { t } = useAppTranslation();
  const [account, setAccount] = useState(auth.getAccount);
  const [revision, setRevision] = useState(0);
  const [busy, setBusy] = useState(false);
  const [issue, setIssue] = useState('');
  const working = useRef(false);
  const [gateway] = useState(() => createGateway(base, auth.headers));
  const [mcp] = useState(() => mcpBase && { base: mcpBase, headers: auth.mcpHeaders });

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
    ready: !!account, modelRevision: revision, mcp,
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
