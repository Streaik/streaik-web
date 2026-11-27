import { Button } from '@streaik/themes';
import { useState } from 'react';
import type { RefObject } from 'react';
import { createPortal } from 'react-dom';
import type { AgentDraft } from './agentDraft';
import { isObject } from './agentDefinition';
import type { JsonObject, JsonValue } from './agentDefinition';
import { agentMcpClientSettings, agentMcpPolicy, setAgentElicitation, setAgentMcpPolicy } from './agentMcpClient';
import { agentMcpServers, agentMcpToolNames, patchAgentMcp } from './agentTools';
import { AgentExecutionField, AgentSelectField, AgentSwitch } from './AgentToolControls';
import { ChatIcon } from './ChatIcon';
import { useAppTranslation } from './i18n';
import type { McpCatalogServer, McpOptions } from './mcp';
import { AgentMcpCatalogDialog, CopyServerUrl, McpEndpointEditor, McpServerCard } from './McpServersView';
import { toolCallers, toolOptions } from './toolConfiguration';
import { useMcpRegistry } from './useMcpRegistry';
import type { McpSelection, McpServers } from './useMcpServers';

type Server = ReturnType<typeof agentMcpServers>[number];
type ServerPatch = Readonly<Record<string, JsonValue | undefined>>;
const policyFlags = Object.keys(agentMcpPolicy) as (keyof typeof agentMcpPolicy)[];
const toolValue = (name: string) => `tool:${name}`;

function AgentMcpServerFields({ entry, change, installed, discovery, registryEntry, onEdit, onRemove }: {
  entry: Server; change: (patch: ServerPatch) => void; installed: McpServers; discovery: McpSelection;
  registryEntry?: McpCatalogServer; onEdit: () => void; onRemove: () => void;
}) {
  const { t } = useAppTranslation();
  const { key, server, endpoint } = entry;
  const record = installed.records.find(item => item.endpoint === endpoint);
  const status = discovery.entries.find(item => item.record === record);
  const callers = toolOptions(server).allowed_callers ?? [...toolCallers];
  const names = agentMcpToolNames(server);
  const filter = isObject(server.allowed_tools) ? server.allowed_tools as JsonObject : undefined;
  const connected = status?.state === 'ready';
  const discoveredNames = connected ? status.discovery.tools.map(tool => tool.remoteName) : [];
  // Retain existing tool names even if the server is offline or no longer lists them.
  const availableNames = [...new Set([...discoveredNames, ...(names ?? [])])].sort();
  const selectedTools = names?.length ? names.map(toolValue) : [names ? 'none' : filter ? 'custom' : 'all'];
  const approval = server.require_approval;
  const approvalMode = approval === 'always' || approval === 'never' ? approval : approval == null ? 'default' : 'custom';
  const canConnect = record && installed.connection(record);
  const connecting = status?.state === 'loading';
  const connectLabel = t(connecting ? 'Connecting...' : connected ? 'Connected' : status?.state === 'error' ? 'Retry connection' : 'Connect Model Context');
  const editLabel = t('Edit MCP URL');
  const removeLabel = t('Remove {{name}}', { name: key });
  const changeNames = (next: readonly string[]) => change({ allowed_tools: filter ? { ...filter, tool_names: next } : next });

  return <McpServerCard title={key} registryEntry={registryEntry} inDialog
    description={typeof server.server_description === 'string' ? server.server_description : undefined}
    actions={<>
      {!canConnect && <small role="status">{t('Install and authorize this server first.')}</small>}
      {endpoint && <CopyServerUrl key={endpoint} endpoint={endpoint} />}
      {canConnect && <Button type="button" variant="subtle" className="chat-composer-icon" title={connectLabel} aria-label={connectLabel}
        aria-busy={connecting || undefined} disabled={connecting || connected} onClick={() => discovery.set(record, true)}>
        <ChatIcon name={connected ? 'check' : 'providers'} />
      </Button>}
      <Button type="button" variant="subtle" className="chat-composer-icon" title={editLabel} aria-label={editLabel} aria-haspopup="dialog" onClick={onEdit}>
        <ChatIcon name="link" />
      </Button>
      <Button type="button" variant="subtle" className="chat-composer-icon" title={removeLabel} aria-label={removeLabel} onClick={onRemove}>
        <ChatIcon name="trash" />
      </Button>
    </>}>
    <div className="agent-mcp-server-fields">
      <AgentExecutionField execution={server.execution} allowProvider onChange={execution => change({ execution })} />
      <div className="agent-mcp-usage">
        <AgentSelectField multiple label={t('Allowed callers')} value={callers} options={toolCallers.map(caller => ({
          value: caller, label: t(caller === 'direct' ? 'Direct' : 'Programmatic'),
        }))} onValueChange={next => {
          if (next.length) change({ allowed_callers: next.length === toolCallers.length ? undefined : next });
        }} />
        <AgentSwitch label={t('Search')} checked={server.defer_loading === true} onChange={checked => change({ defer_loading: checked || undefined })} />
        <AgentSwitch label={t('Namespace')} checked={server.namespace === true} onChange={checked => change({ namespace: checked || undefined })} />
      </div>
      <div className="agent-mcp-columns">
        <AgentSelectField multiple label={t('Allowed tools')} value={selectedTools} disabled={!connected} options={[
          { value: 'all', label: t('All tools') }, { value: 'none', label: t('No tools') },
          ...(selectedTools.includes('custom') ? [{ value: 'custom', label: t('Custom filter') }] : []),
          ...availableNames.map(name => ({ value: toolValue(name), label: name })),
        ]} onValueChange={next => {
          if (next.includes('all') && !selectedTools.includes('all')) change({ allowed_tools: undefined });
          else if (next.includes('none') && !selectedTools.includes('none')) changeNames([]);
          else {
            const picked = next.filter(value => value.startsWith('tool:')).map(value => value.slice('tool:'.length));
            // Toggling the current All/No/Custom mode does not change the allowlist.
            if (picked.length || names?.length) changeNames(picked);
          }
        }} />
        <AgentSelectField label={t('Require approval')} value={approvalMode} options={[
          { value: 'default', label: t('Default') }, { value: 'always', label: t('Always') }, { value: 'never', label: t('Never') },
          ...(approvalMode === 'custom' ? [{ value: 'custom', label: t('Custom filter') }] : []),
        ]} onValueChange={value => {
          if (value !== 'custom') change({ require_approval: value === 'default' ? undefined : value });
        }} />
      </div>
    </div>
  </McpServerCard>;
}

export function AgentModelContextFields({ draft, patch, store, discovery, options, dialogHost }: {
  draft: AgentDraft; patch: (change: Partial<AgentDraft>) => void; store: McpServers; discovery: McpSelection;
  options?: McpOptions; dialogHost: RefObject<HTMLDivElement | null>;
}) {
  const { t } = useAppTranslation();
  const [dialog, setDialog] = useState<{ type: 'catalog' } | { type: 'url'; entry?: Server }>();
  const registry = useMcpRegistry(options, dialog?.type === 'catalog');
  const servers = agentMcpServers(draft.tools);
  const endpoints = new Set(servers.flatMap(({ endpoint }) => endpoint ?? []));
  const { policy, elicitation } = agentMcpClientSettings(draft.mcpClient);
  const addLabel = t('Add by URL');
  const catalogLabel = t('Catalog');
  const close = () => setDialog(undefined);
  const change = (key: string, patchFields?: ServerPatch) => patch({ tools: patchAgentMcp(draft.tools, key, patchFields) });

  function addServer(name: string, endpoint: string, description?: string) {
    const labels = new Set(servers.map(({ key }) => key.toLowerCase()));
    let key = name;
    for (let i = 2; labels.has(key.toLowerCase()); i++) key = `${name} (${i})`;
    change(key, { server_url: endpoint, ...(description && { server_description: description }) });
  }

  return <>
    <section className="agent-field-group">
      <h3>{t('Policy')}</h3>
      <div className="agent-mcp-columns">{policyFlags.map(flag => <AgentSwitch key={flag} label={t(agentMcpPolicy[flag])} checked={policy?.[flag] === true}
        onChange={checked => patch({ mcpClient: setAgentMcpPolicy(draft.mcpClient, flag, checked) })} />)}</div>
    </section>
    <section className="agent-field-group">
      <div className="agent-mcp-heading"><h3>{t('Capabilities')}</h3>
        <AgentSwitch label={t('Elicitation')} hideLabel checked={!!elicitation} onChange={checked =>
          patch({ mcpClient: setAgentElicitation(draft.mcpClient, 'elicitation', checked) })} /></div>
      <div className="agent-mcp-columns">
        <AgentSwitch label={t('Form')} checked={elicitation?.form != null} onChange={elicitation ? checked =>
          patch({ mcpClient: setAgentElicitation(draft.mcpClient, 'form', checked) }) : undefined} />
        <AgentSwitch label={t('URL')} checked={elicitation?.url != null} title={t('URL elicitation is not supported yet.')} />
      </div>
    </section>
    {servers.map(entry => <AgentMcpServerFields key={entry.key} entry={entry} change={fields => change(entry.key, fields)} installed={store} discovery={discovery}
      registryEntry={entry.endpoint ? registry.byEndpoint.get(entry.endpoint) : undefined}
      onEdit={() => setDialog({ type: 'url', entry })} onRemove={() => change(entry.key)} />)}
    <div className="agent-mcp-actions">
      <Button type="button" variant="subtle" className="chat-composer-icon" title={addLabel} aria-label={addLabel} aria-haspopup="dialog"
        onClick={() => setDialog({ type: 'url' })}><ChatIcon name="link" /></Button>
      <Button type="button" variant="subtle" className="chat-composer-icon" title={catalogLabel} aria-label={catalogLabel} aria-haspopup="dialog"
        onClick={() => setDialog({ type: 'catalog' })}><ChatIcon name="tool" /></Button>
    </div>
    {dialog && dialogHost.current && createPortal(dialog.type === 'catalog'
      ? <AgentMcpCatalogDialog options={options} registry={registry} close={close} picker={{ endpoints, add: (item, endpoint) =>
        addServer(item.title, endpoint, item.description) }} />
      : <McpEndpointEditor close={close} initial={dialog.entry && { name: dialog.entry.key,
        url: typeof dialog.entry.server.server_url === 'string' ? dialog.entry.server.server_url : '' }} save={(name, endpoint) => {
        if (endpoint !== dialog.entry?.endpoint && endpoints.has(endpoint)) throw new Error('This MCP URL is already on this agent.');
        if (dialog.entry) change(dialog.entry.key, { server_url: endpoint,
          ...(dialog.entry.endpoint !== endpoint && { headers: undefined, authorization: undefined }) });
        else addServer(name, endpoint);
      }} />, dialogHost.current)}
  </>;
}
