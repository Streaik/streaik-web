import { isObject } from './agentDefinition';
import type { AgentDraft } from './agentDraft';
import { agentMcpAllows, agentMcpServers, agentMcpToolNames, agentSearchTools, agentToolKey, agentToolList, agentToolOptions,
  enableAgentSearch, patchAgentTool } from './agentTools';
import type { AgentToolIdentity } from './agentTools';
import { AgentSelectField, AgentSwitch } from './AgentToolControls';
import { useAppTranslation } from './i18n';
import { ToolConfigurationEditor } from './ToolConfigurationEditor';
import type { ToolConfigurationRow } from './ToolConfigurationEditor';
import { toolOptions } from './toolConfiguration';
import type { ToolOptions } from './toolConfiguration';
import type { McpSelection } from './useMcpServers';

type Props = { draft: AgentDraft; patch: (change: Partial<AgentDraft>) => void };
const searchTypes = Object.keys(agentSearchTools) as (keyof typeof agentSearchTools)[];

export function AgentToolsFields({ draft, patch }: Props) {
  const { t } = useAppTranslation();
  return <section className="agent-field-group"><h3>{t('Tools')}</h3>
    {searchTypes.map(type => {
      const tool = agentToolList(draft.tools).find(entry => isObject(entry) && entry.type === type);
      return <div key={type} className="agent-mcp-columns">
        <AgentSwitch label={t(agentSearchTools[type])} checked={!!tool}
          onChange={enabled => patch({ tools: enableAgentSearch(draft.tools, type, enabled) })} />
        {isObject(tool) && <AgentSelectField label={t('Execution')} value={tool.execution === 'server' ? 'server' : 'client'}
          options={[{ value: 'client', label: t('Agent backend') }, { value: 'server', label: t('Gateway') }]}
          onValueChange={value => patch({ tools: patchAgentTool(draft.tools, { type }, { execution: value === 'server' ? 'server' : 'client' }) })} />}
      </div>;
    })}
  </section>;
}

export function AgentToolConfigurationFields({ draft, patch, discovery }: Props & { discovery: McpSelection }) {
  const { t } = useAppTranslation();
  const rows = new Map<string, ToolConfigurationRow & { identity: AgentToolIdentity }>();
  const add = (identity: AgentToolIdentity, label: string, source: string, defaults?: ToolOptions) => {
    const key = agentToolKey(identity);
    if (!rows.has(key)) rows.set(key, { key, label, source, identity, options: { ...defaults, ...agentToolOptions(draft.tools, identity) } });
  };
  const local = t('Local');
  const entries = agentToolList(draft.tools);
  for (const { key, server, endpoint } of agentMcpServers(draft.tools)) {
    const found = discovery.connected.find(entry => entry.record.endpoint === endpoint)?.discovery;
    for (const name of [...(found?.tools.map(tool => tool.remoteName) ?? []), ...agentMcpToolNames(server) ?? []]) {
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
