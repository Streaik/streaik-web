import { normalizeGatewayBase } from '@streaik/gateway';
import { localizationReady, useAppTranslation } from '@streaik/chat';
import { createRoot } from 'react-dom/client';
import { EntraApp } from './EntraApp';

const root = createRoot(document.getElementById('root')!);
const appName = import.meta.env.VITE_APP_NAME;

function Startup({ failed = false }: { failed?: boolean }) {
  const { t } = useAppTranslation();
  return <main className="chat-start">{failed ? <><h1>{appName}</h1><p role="alert">
    {t('Could not start Microsoft Entra sign-in. Check the sample’s tenant ID, SPA client ID, gateway scope and browser storage settings.')}
  </p></> : <p role="status">{t('Starting {{appName}}…', { appName })}</p>}</main>;
}

async function start() {
  await localizationReady;
  root.render(<Startup />);
  const site = new URL(import.meta.env.BASE_URL, location.origin);
  const base = normalizeGatewayBase(import.meta.env.VITE_GATEWAY_BASE || '/gateway', site.href);
  const mcpBase = import.meta.env.VITE_MCP_BASE ? normalizeGatewayBase(import.meta.env.VITE_MCP_BASE, site.href) : undefined;
  const { createEntraAuth } = await import('./auth');
  const auth = await createEntraAuth({
    tenantId: import.meta.env.VITE_ENTRA_TENANT_ID ?? '',
    clientId: import.meta.env.VITE_ENTRA_CLIENT_ID ?? '',
    scope: import.meta.env.VITE_ENTRA_API_SCOPE ?? '',
    mcpScope: mcpBase ? import.meta.env.VITE_ENTRA_MCP_SCOPE ?? '' : undefined,
  }, site);
  root.render(<EntraApp appName={appName} base={base} auth={auth} mcpBase={mcpBase} />);
}

void start().catch(() => root.render(<Startup failed />));
