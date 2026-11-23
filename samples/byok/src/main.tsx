import { normalizeGatewayBase } from '@streaik/gateway';
import { localizationReady } from '@streaik/chat';
import { createRoot } from 'react-dom/client';
import { ByokApp } from './ByokApp';
import './byok.css';

function trustedBase(value: string | undefined) {
  try { return value ? normalizeGatewayBase(value, location.href) : undefined; }
  catch { return undefined; }
}

const root = createRoot(document.getElementById('root')!);
void localizationReady.then(() => root.render(<ByokApp appName={import.meta.env.VITE_APP_NAME}
  base={trustedBase(import.meta.env.VITE_GATEWAY_BASE ?? '/gateway')} mcpBase={trustedBase(import.meta.env.VITE_MCP_BASE)} />));
