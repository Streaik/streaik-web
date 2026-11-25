import { normalizeGatewayBase } from '@streaik/gateway';
import { ChatRouter, localizationReady } from '@streaik/chat';
import { createRoot } from 'react-dom/client';
import { readMcpConfig } from '../../shared/mcpConfig';
import { ByokApp } from './ByokApp';
import './byok.css';

const site = new URL(import.meta.env.BASE_URL, location.origin);

function trustedBase(value: string | undefined) {
  try { return value ? normalizeGatewayBase(value, site.href) : undefined; }
  catch { return undefined; }
}

const root = createRoot(document.getElementById('root')!);
void localizationReady.then(() => root.render(<ChatRouter basename={site.pathname}>
  <ByokApp appName={import.meta.env.VITE_APP_NAME}
    base={trustedBase(import.meta.env.VITE_GATEWAY_BASE ?? '/gateway')}
    agentBase={trustedBase(import.meta.env.VITE_AGENT_BASE?.trim())}
    mcpConfig={readMcpConfig(site, import.meta.env.VITE_MCP_BASE, import.meta.env.VITE_MCP_REGISTRY_URL)} />
</ChatRouter>));
