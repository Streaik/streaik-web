import type { McpOptions, McpRemoteHeader } from '@streaik/chat';
import { normalizeGatewayBase } from '@streaik/gateway';

export type McpConfig = Pick<McpOptions, 'base' | 'registryUrl'>;

// Outside the configured BYOK host, keep bundled headerless remotes (which can be OAuth) out of the view.
export const byokRegistryRemote: NonNullable<McpOptions['filterRegistryRemote']> = (name, remote) =>
  !name.startsWith('io.github.streaik/') || remote.declarations.length > 0;

export function readMcpConfig(site: URL, base?: string, registry?: string): McpConfig | undefined {
  if (!base?.trim() && !registry?.trim()) return;
  try {
    const registryUrl = registry?.trim() ? new URL(registry, site) : undefined;
    // Validate without applying the base URL's trailing-slash normalization to the list endpoint.
    if (registryUrl) normalizeGatewayBase(registryUrl.href, site.href);
    return { base: base?.trim() ? normalizeGatewayBase(base, site.href) : undefined, registryUrl };
  } catch { return undefined; }
}

export function byokMcpProvider(headers: readonly McpRemoteHeader[]): 'openai' | 'google' | 'anthropic' | undefined {
  const [header] = headers;
  if (headers.length !== 1 || !header || header.manualOnly || header.default !== undefined) return;
  const name = header.name.toLowerCase();
  if (name === 'authorization' && header.value === 'Bearer {openai_api_key}') return 'openai';
  if (header.value !== undefined || header.variables !== undefined || header.isSecret !== true) return;
  if (name === 'x-goog-api-key') return 'google';
  if (name === 'x-api-key') return 'anthropic';
}

// The Fakton sample still supports the legacy direct-Entra runtime.
export function acceptsEntraMcpToken(headers: readonly McpRemoteHeader[]): boolean {
  const [header] = headers;
  return headers.length === 0 || (headers.length === 1 && !!header && !header.manualOnly && header.name.toLowerCase() === 'authorization' &&
    header.default === undefined && (header.value === 'Bearer {access_token}' || (header.value === undefined && header.isSecret === true)));
}
