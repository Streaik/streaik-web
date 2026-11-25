import { useState } from 'react';
import { Button } from '@streaik/themes';
import { isObject } from './agentDefinition';
import type { AgentDraft } from './agentDraft';
import { agentMcpAllows, agentMcpServers, agentSearchTools, agentToolKey, agentToolList, agentToolOptions,
  enableAgentSearch, patchAgentMcp, patchAgentTool } from './agentTools';
import type { AgentToolIdentity } from './agentTools';
import { useAppTranslation } from './i18n';
import { ToolConfigurationEditor } from './ToolConfigurationEditor';
import type { ToolConfigurationRow } from './ToolConfigurationEditor';
import { toolCallers, toolOptions } from './toolConfiguration';
import type { ToolOptions } from './toolConfiguration';
import type { McpSelection, McpServers } from './useMcpServers';

type Props = { draft: AgentDraft; patch: (change: Partial<AgentDraft>) => void; store: McpServers; discovery: McpSelection };
const searchTypes = Object.keys(agentSearchTools) as (keyof typeof agentSearchTools)[];

export function AgentToolsFields({ draft, patch, store, discovery }: Props) {
  const { t } = useAppTranslation();
  const [newKey, setNewKey] = useState('');
  const [newUrl, setNewUrl] = useState('');
  const servers = agentMcpServers(draft.mcpServers);
  const key = newKey.trim();
  const duplicate = isObject(draft.mcpServers) && Object.keys(draft.mcpServers).some(name => name.toLowerCase() === key.toLowerCase());
  return <>
    <fieldset><legend>{t('Tools')}</legend>
      {searchTypes.map(type => <label key={type}><input type="checkbox" checked={agentToolList(draft.tools).some(tool => isObject(tool) && tool.type === type)}
        onChange={event => patch({ tools: enableAgentSearch(draft.tools, type, event.currentTarget.checked) })} /> {t(agentSearchTools[type])}</label>)}
    </fieldset>
    <fieldset><legend>{t('Add MCP server')}</legend>
      <label>{t('Server name')}<input value={newKey} onChange={event => setNewKey(event.currentTarget.value)} /></label>
      <label>{t('MCP URL')}<input type="url" value={newUrl} onChange={event => setNewUrl(event.currentTarget.value)} /></label>
      <Button type="button" disabled={!key || !newUrl.trim() || duplicate} onClick={() => {
        patch({ mcpServers: patchAgentMcp(draft.mcpServers, key, { type: 'http', url: newUrl.trim() }) });
        setNewKey(''); setNewUrl('');
      }}>{t('Add MCP server')}</Button>
    </fieldset>
    {servers.map(({ key, server, endpoint }) => {
      const installed = store.records.find(record => record.endpoint === endpoint);
      const status = discovery.entries.find(entry => entry.record === installed);
      const allowlist = Array.isArray(server.allowed_tools) ? server.allowed_tools.filter(name => typeof name === 'string') : undefined;
      const options = toolOptions(server);
      return <fieldset key={key}><legend>{key}</legend>
        <label>{t('MCP URL')}<input type="url" value={typeof server.url === 'string' ? server.url : ''}
          onChange={event => patch({ mcpServers: patchAgentMcp(draft.mcpServers, key, { url: event.currentTarget.value.trim() }) })} /></label>
        {(['disabled', 'required', 'namespace', 'defer_loading'] as const).map((option, index) => <label key={option}>
          <input type="checkbox" checked={server[option] === true} onChange={event => patch({
            mcpServers: patchAgentMcp(draft.mcpServers, key, { [option]: event.currentTarget.checked }),
          })} /> {t((['Disabled', 'Required', 'Namespace', 'Search'] as const)[index])}</label>)}
        {toolCallers.map(caller => <label key={caller}><input type="checkbox" checked={options.allowed_callers?.includes(caller) ?? false}
          onChange={event => patch({ mcpServers: patchAgentMcp(draft.mcpServers, key, { allowed_callers: event.currentTarget.checked
            ? [...(options.allowed_callers ?? []), caller] : (options.allowed_callers ?? []).filter(value => value !== caller) }) })} />
          {t(caller === 'direct' ? 'Direct' : 'Programmatic')}</label>)}
        <label><input type="checkbox" checked={!!allowlist}
          onChange={event => patch({ mcpServers: patchAgentMcp(draft.mcpServers, key, { allowed_tools: event.currentTarget.checked ? [] : null }) })} />
          {t('Restrict allowed tools')}</label>
        {allowlist && <label>{t('Allowed tool names (one per line)')}<textarea key={key} defaultValue={allowlist.join('\n')}
          onChange={event => patch({ mcpServers: patchAgentMcp(draft.mcpServers, key, {
            allowed_tools: [...new Set(event.currentTarget.value.split(/\r?\n/).map(name => name.trim()).filter(Boolean))],
          }) })} /></label>}
        {installed && store.connection(installed) && server.disabled !== true
          ? <Button type="button" disabled={status?.state === 'loading' || status?.state === 'ready'}
            onClick={() => discovery.set(installed, true)}>{t(status?.state === 'loading' ? 'Connecting to MCP servers…'
              : status?.state === 'ready' ? 'Tools discovered' : status?.state === 'error' ? 'Retry' : 'Discover tools')}</Button>
          : server.disabled !== true && <small>{t('Install and authorize this MCP server in Streaik to discover its tools.')}</small>}
        <Button type="button" variant="subtle" onClick={() => patch({ mcpServers: patchAgentMcp(draft.mcpServers, key) })}>{t('Remove server')}</Button>
      </fieldset>;
    })}
  </>;
}

export function AgentToolConfigurationFields({ draft, patch, discovery }: Props) {
  const { t } = useAppTranslation();
  const rows = new Map<string, ToolConfigurationRow & { identity: AgentToolIdentity }>();
  const add = (identity: AgentToolIdentity, label: string, source: string, defaults?: ToolOptions) => {
    const key = agentToolKey(identity);
    if (!rows.has(key)) rows.set(key, { key, label, source, identity, options: { ...defaults, ...agentToolOptions(draft.tools, identity) } });
  };
  const local = t('Local');
  const entries = agentToolList(draft.tools);
  for (const { key, server, endpoint } of agentMcpServers(draft.mcpServers)) {
    if (server.disabled === true) continue;
    const found = discovery.connected.find(entry => entry.record.endpoint === endpoint)?.discovery;
    for (const name of [...(found?.tools.map(tool => tool.remoteName) ?? []), ...(Array.isArray(server.allowed_tools) ? server.allowed_tools : [])]) {
      if (typeof name === 'string' && name && agentMcpAllows(server, name)) add({ type: 'function', name }, name, key, toolOptions(server));
    }
    if (found?.hasResources) add({ type: 'read_resource' }, 'read_resource', local);
  }
  for (const entry of entries) {
    if (!isObject(entry)) continue;
    if (entry.type === 'function' && typeof entry.name === 'string' && entry.name) {
      add({ type: 'function', name: entry.name }, entry.name, t('Blueprint'));
    } else if (entry.type === 'read_resource') add({ type: 'read_resource' }, 'read_resource', local);
    else if (entry.type === 'tool_search' || entry.type === 'resource_search') add({ type: entry.type }, t(agentSearchTools[entry.type]), local);
  }
  return <ToolConfigurationEditor rows={[...rows.values()]} onChange={(keys, change) => {
    const tools = keys.reduce((current, key) => patchAgentTool(current, rows.get(key)!.identity, change), draft.tools);
    patch({ tools });
  }} />;
}
