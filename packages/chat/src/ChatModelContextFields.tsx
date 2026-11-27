import { AgentSelectField, AgentSwitch } from './AgentToolControls';
import { agentSearchTools } from './agentTools';
import { ChatExecutionField } from './ChatExecutionField';
import { browserMcpPolicy, hostedMcpDefers, normalizeChatModelContext } from './chatModelContext';
import type { ChatMcpServerOptions, ChatModelContext, hostedMcpRoute } from './chatModelContext';
import { useAppTranslation } from './i18n';
import type { McpOptions } from './mcp';
import { McpServerCard } from './McpServersView';
import { McpAllowedToolsField, McpApprovalField, McpPolicyCard } from './McpToolControls';
import { toolCallers } from './toolConfiguration';
import { useMcpRegistry } from './useMcpRegistry';
import type { McpSelection } from './useMcpServers';

export type ChatModelContextServers = {
  servers: ReadonlyArray<Pick<McpSelection['connected'][number], 'record'> & Partial<Pick<McpSelection['connected'][number], 'discovery'>>>;
  registry?: McpOptions;
  descriptions: ReadonlyMap<string, string>;
  route: ReturnType<typeof hostedMcpRoute>;
  installed?: boolean;
};

export function ChatModelContextFields({ servers, registry, descriptions, route, value, onChange, locked, hostedToolSearch, localToolSearch }: ChatModelContextServers & {
  value?: ChatModelContext; onChange: (value: ChatModelContext | undefined) => void; locked: boolean;
  hostedToolSearch: boolean; localToolSearch: boolean;
}) {
  const { t } = useAppTranslation();
  const { byEndpoint } = useMcpRegistry(registry, false, servers.map(({ record }) => record));
  const hosted = !!route && value?.execution === 'hosted';
  const provider = !!route && value?.execution === 'provider';
  const policy = { ...browserMcpPolicy, ...value?.policy };
  const change = (patch: Partial<ChatModelContext>) => onChange(normalizeChatModelContext({ ...value, ...patch }));
  const changeServer = (endpoint: string, patch: Partial<ChatMcpServerOptions>) => change({
    servers: { ...value?.servers, [endpoint]: { ...value?.servers?.[endpoint], ...patch } },
  });

  return <div className="chat-preference-cards">
    <section className="chat-tool-card">
      <ChatExecutionField value={route || value?.execution === 'client' ? value?.execution : undefined}
        disabled={locked} hostedSupported={!!route} providerSupported={!!route} onChange={execution => change({ execution })} />
    </section>
    {!hosted && !provider && <McpPolicyCard policy={policy} onChange={locked ? undefined : (flag, checked) => change({ policy: { ...policy, [flag]: checked } })} />}
    {servers.map(({ record, discovery }) => {
      const { id, endpoint, title } = record;
      const options = value?.servers?.[endpoint];
      return <McpServerCard key={id} title={title} registryEntry={byEndpoint.get(endpoint)} description={descriptions.get(endpoint)} inDialog>
        {hosted && <div className="agent-mcp-usage">
          <AgentSelectField multiple label={t('Allowed callers')} value={options?.allowedCallers ?? toolCallers} disabled={locked}
            options={toolCallers.map(caller => ({ value: caller, label: t(caller === 'direct' ? 'Direct' : 'Programmatic') }))}
            onValueChange={next => {
              const callers = toolCallers.filter(caller => next.includes(caller));
              if (callers.length) changeServer(endpoint, { allowedCallers: callers.length === toolCallers.length ? undefined : callers });
            }} />
          <AgentSwitch label={t('Search')} checked={hostedMcpDefers(options, hostedToolSearch, localToolSearch)}
            onChange={locked || localToolSearch ? undefined : deferLoading => changeServer(endpoint, { deferLoading })} />
        </div>}
        <div className="agent-mcp-columns">
          <McpAllowedToolsField available={discovery?.tools.map(tool => tool.remoteName) ?? options?.allowedTools ?? []} names={options?.allowedTools} disabled={locked || !discovery}
            onChange={allowedTools => changeServer(endpoint, { allowedTools })} />
          <McpApprovalField approval={options?.requireApproval} disabled={locked || !(hosted || provider)}
            onChange={requireApproval => changeServer(endpoint, { requireApproval })} />
        </div>
      </McpServerCard>;
    })}
    {hosted && (['toolSearch', 'resourceSearch'] as const).map(key => {
      const isToolSearch = key === 'toolSearch';
      const label = t(agentSearchTools[isToolSearch ? 'tool_search' : 'resource_search']);
      return <section key={key} className="agent-field-group" aria-label={label}>
        <header className="agent-mcp-heading"><h3>{label}</h3>
          <AgentSwitch label={label} hideLabel checked={isToolSearch ? hostedToolSearch : value?.resourceSearch === true}
            onChange={locked || (isToolSearch && localToolSearch) ? undefined : checked => change({ [key]: checked })} />
        </header>
      </section>;
    })}
  </div>;
}
