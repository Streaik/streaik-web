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
  const servers = agentMcpServers(draft.tools);
  const key = newKey.trim();
  const duplicate = servers.some(server => server.key.toLowerCase() === key.toLowerCase());
  return <>
    <fieldset><legend>{t('Tools')}</legend>
      {searchTypes.map(type => {
        const tool = agentToolList(draft.tools).find(entry => isObject(entry) && entry.type === type);
        return <div key={type}>
          <label><input type="checkbox" checked={!!tool}
            onChange={event => patch({ tools: enableAgentSearch(draft.tools, type, event.currentTarget.checked) })} /> {t(agentSearchTools[type])}</label>
          {isObject(tool) && <label>{t('Execution')}<select value={tool.execution === 'server' ? 'server' : 'client'}
            onChange={event => patch({ tools: patchAgentTool(draft.tools, { type }, { execution: event.currentTarget.value === 'server' ? 'server' : 'client' }) })}>
            <option value="client">{t('Agent backend')}</option><option value="server">{t('Gateway')}</option>
          </select></label>}
        </div>;
      })}
    </fieldset>
    <fieldset><legend>{t('Add MCP server')}</legend>
      <label>{t('Server name')}<input value={newKey} onChange={event => setNewKey(event.currentTarget.value)} /></label>
      <label>{t('MCP URL')}<input type="url" value={newUrl} onChange={event => setNewUrl(event.currentTarget.value)} /></label>
      <Button type="button" disabled={!key || !newUrl.trim() || duplicate} onClick={() => {
        patch({ tools: patchAgentMcp(draft.tools, key, { server_url: newUrl.trim() }) });
        setNewKey(''); setNewUrl('');
      }}>{t('Add MCP server')}</Button>
    </fieldset>
    {servers.map(({ key, server, endpoint }) => {
      const installed = store.records.find(record => record.endpoint === endpoint);
      const status = discovery.entries.find(entry => entry.record === installed);
      const allowlist = Array.isArray(server.allowed_tools) ? server.allowed_tools.filter(name => typeof name === 'string') : undefined;
      const options = toolOptions(server);
      return <fieldset key={key}><legend>{key}</legend>
        <label>{t('MCP URL')}<input type="url" value={typeof server.server_url === 'string' ? server.server_url : ''}
          onChange={event => patch({ tools: patchAgentMcp(draft.tools, key, { server_url: event.currentTarget.value.trim() }) })} /></label>
        <label>{t('Execution')}<select value={server.execution === 'server' ? 'server' : 'client'}
          onChange={event => patch({ tools: patchAgentMcp(draft.tools, key, { execution: event.currentTarget.value }) })}>
          <option value="client">{t('Agent backend')}</option><option value="server">{t('Gateway')}</option>
        </select></label>
        <label><input type="checkbox" checked={server.defer_loading === true} onChange={event => patch({
          tools: patchAgentMcp(draft.tools, key, { defer_loading: event.currentTarget.checked }),
        })} /> {t('Search')}</label>
        {toolCallers.map(caller => <label key={caller}><input type="checkbox" checked={options.allowed_callers?.includes(caller) ?? true}
          onChange={event => {
            const selected = options.allowed_callers ?? [...toolCallers];
            const next = event.currentTarget.checked ? [...selected, caller] : selected.filter(value => value !== caller);
            if (next.length) patch({ tools: patchAgentMcp(draft.tools, key, { allowed_callers: next }) });
          }} />
          {t(caller === 'direct' ? 'Direct' : 'Programmatic')}</label>)}
        <label><input type="checkbox" checked={!!allowlist}
          onChange={event => patch({ tools: patchAgentMcp(draft.tools, key, { allowed_tools: event.currentTarget.checked ? [] : null }) })} />
          {t('Restrict allowed tools')}</label>
        {allowlist && <label>{t('Allowed tool names (one per line)')}<textarea key={key} defaultValue={allowlist.join('\n')}
          onChange={event => patch({ tools: patchAgentMcp(draft.tools, key, {
            allowed_tools: [...new Set(event.currentTarget.value.split(/\r?\n/).map(name => name.trim()).filter(Boolean))],
          }) })} /></label>}
        {installed && store.connection(installed) && server.disabled !== true
          ? <Button type="button" disabled={status?.state === 'loading' || status?.state === 'ready'}
            onClick={() => discovery.set(installed, true)}>{t(status?.state === 'loading' ? 'Connecting to MCP servers…'
              : status?.state === 'ready' ? 'Tools discovered' : status?.state === 'error' ? 'Retry' : 'Discover tools')}</Button>
          : server.disabled !== true && <small>{t('Install and authorize this MCP server in Streaik to discover its tools.')}</small>}
        <Button type="button" variant="subtle" onClick={() => patch({ tools: patchAgentMcp(draft.tools, key) })}>{t('Remove server')}</Button>
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
  for (const { key, server, endpoint } of agentMcpServers(draft.tools)) {
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
  }
  return <ToolConfigurationEditor rows={[...rows.values()]} onChange={(keys, change) => {
    const tools = keys.reduce((current, key) => patchAgentTool(current, rows.get(key)!.identity, change), draft.tools);
    patch({ tools });
  }} />;
}
