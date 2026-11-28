import { ChatApp, providerDirectory, useAppTranslation } from '@streaik/chat';
import type { McpOptions } from '@streaik/chat';
import { createAgentBackend, createDirectChat, createGateway, GatewayError } from '@streaik/gateway';
import { useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { appAgents } from '../../shared/appAgents';
import { byokMcpProvider, byokRegistryRemote } from '../../shared/mcpConfig';
import { isMcpRuntime } from '@streaik/chat';
import type { McpConfig } from '../../shared/mcpConfig';
import { ProviderKeySettings } from './ProviderKeySettings';
import { agentProviderHeaders, directKeyProviderIds, providerHeaders, validProviderId, validProviderKey } from './providerKeys.ts';
import type { ProviderKeys } from './providerKeys.ts';
import { createVault, unlockVault } from './vault.ts';

type Encrypter = Awaited<ReturnType<typeof createVault>>;
type Vault = { state: 'session' } | { state: 'locked' } | { state: 'unlocked'; encrypt: Encrypter };

export function ByokApp({ appName, base, agentBase, mcpConfig, enableKeylessEcho = false }: {
  appName: string; base?: URL; agentBase?: URL; mcpConfig?: McpConfig; enableKeylessEcho?: boolean;
}) {
  const { t } = useAppTranslation();
  const scope = base?.href ?? 'direct';
  const storageKey = `streaik.byok.vault:${scope}`;
  const keys = useRef<ProviderKeys>({});
  const [vault, setVault] = useState<Vault>(() => {
    try { return { state: localStorage.getItem(storageKey) === null ? 'session' : 'locked' }; }
    catch { return { state: 'session' }; }
  });
  const [revision, setRevision] = useState(0);
  const [notice, setNotice] = useState('');
  const working = useRef(false);
  const [busy, setBusy] = useState(false);
  const [gateway] = useState(() => createGateway(base, (request) => {
    const headers = providerHeaders(keys.current, request);
    if ((request.kind === 'chat' || request.kind === 'image' || request.kind === 'video' || request.kind === 'transcription' || request.kind === 'speech' || request.kind === 'realtime') && request.provider !== 'echo' && ![...headers].length) throw new GatewayError('Set or unlock the provider key for this model.');
    return headers;
  }));
  // A catalog entry is not a grant to send keys directly to another origin.
  const [direct] = useState(() => createDirectChat(providerDirectory.providers, (provider) =>
    directKeyProviderIds.includes(provider) ? keys.current[provider] : undefined));
  const [agentBackend] = useState(() => agentBase && createAgentBackend(agentBase, request => {
    if (request.kind === 'catalog') return {};
    const headers = agentProviderHeaders(keys.current, request.modelIds);
    if (![...headers].length) throw new GatewayError('Set or unlock a provider key for this agent’s models.');
    return headers;
  }));
  const [mcp] = useState<McpOptions | undefined>(() => mcpConfig && ({ ...mcpConfig,
    filterRegistryRemote: (name, remote) => byokRegistryRemote(name, remote) || isMcpRuntime(remote.endpoint, mcpConfig.base),
    headersForRemote: (declarations) => {
    const provider = byokMcpProvider(declarations);
    if (!provider) return;
    return { ready: !!keys.current[provider], headers: () => {
      const key = keys.current[provider];
      if (!key) throw new GatewayError('Set or unlock the provider key for this MCP server.');
      return provider === 'openai' ? { Authorization: `Bearer ${key}` }
        : { [provider === 'google' ? 'x-goog-api-key' : 'x-api-key']: key };
    } };
  } }));

  function updateKeys(next: ProviderKeys) {
    keys.current = next;
    setRevision((n) => n + 1);
  }

  async function run(action: () => Promise<void>, failure: string) {
    if (working.current) return false;
    working.current = true; setBusy(true); setNotice('');
    try { await action(); return true; } catch { setNotice(failure); return false; }
    finally { working.current = false; setBusy(false); }
  }

  async function changeKey(id: string, value?: string) {
    if (vault.state === 'locked' || !validProviderId(id)) return false;
    if (value !== undefined && !validProviderKey(value)) {
      setNotice('Enter a nonempty provider key without spaces.');
      return false;
    }
    const next = value === undefined ? { ...keys.current } : { ...keys.current, [id]: value };
    if (value === undefined) delete next[id];
    return run(async () => {
      if (vault.state === 'unlocked') localStorage.setItem(storageKey, await vault.encrypt(next));
      updateKeys(next);
      setNotice(value === undefined ? 'Provider key removed.' : 'Provider key saved.');
    }, 'Could not update the encrypted vault. Provider keys were not changed.');
  }

  function submitPassphrase(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const fields = new FormData(form);
    const passphrase = String(fields.get('passphrase') ?? '');
    const repeat = fields.get('confirm');
    form.reset();
    if (vault.state === 'session' && (passphrase.length < 12 || passphrase !== repeat)) {
      setNotice('Enter a matching passphrase of at least 12 characters.');
      return;
    }
    if (vault.state === 'session') {
      void run(async () => {
        if (localStorage.getItem(storageKey) !== null) {
          updateKeys({}); setVault({ state: 'locked' });
          setNotice('An existing vault was found. Unlock it first.');
          return;
        }
        const encrypt = await createVault(passphrase, scope);
        localStorage.setItem(storageKey, await encrypt(keys.current));
        setVault({ state: 'unlocked', encrypt });
        setNotice('Encrypted storage is on.');
      }, 'Could not enable encrypted storage. Use HTTPS or localhost and allow browser storage. Keys remain session-only.');
    } else if (vault.state === 'locked') {
      void run(async () => {
        const raw = localStorage.getItem(storageKey);
        if (!raw) throw new Error('Missing vault.');
        const { keys: unlocked, encrypt } = await unlockVault(raw, passphrase, scope);
        updateKeys(unlocked); setVault({ state: 'unlocked', encrypt }); setNotice('Vault unlocked.');
      }, 'Could not unlock the vault. Check your passphrase.');
    }
  }

  function eraseVault() {
    return run(async () => {
      localStorage.removeItem(storageKey);
      updateKeys({}); setVault({ state: 'session' }); setNotice('Encrypted vault erased.');
    }, 'Could not erase the vault.');
  }

  const configured = Object.keys(keys.current);
  return <ChatApp appName={appName} gateway={gateway} agents={vault.state === 'locked' ? undefined : appAgents} connection={{
    ready: configured.length > 0 || (enableKeylessEcho && !!base && vault.state !== 'locked'), modelRevision: revision, mcp, direct, mcpSession: vault.state !== 'locked',
    agentBackend: vault.state === 'locked' ? undefined : agentBackend,
    historyProfile: vault.state === 'locked' ? undefined : 'byok',
    emptyMessage: t(vault.state === 'locked' ? 'Unlock your provider keys in Settings to start chatting.' : 'Add a provider key in Settings to start chatting.'),
    account: { name: 'BYOK' },
    apiKeySettings: <ProviderKeySettings gatewayConfigured={!!base} configured={configured}
      vault={vault.state} busy={busy} notice={notice} mcp={!!mcp}
      onChangeKey={changeKey} onPassphrase={submitPassphrase} onLock={() => {
        updateKeys({}); setVault({ state: 'locked' }); setNotice('Vault locked.');
      }} onErase={eraseVault} />,
  }} />;
}
