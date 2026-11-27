import { AgentSwitch } from './AgentToolControls';
import { agentSearchTools } from './agentTools';
import { ChatExecutionField } from './ChatExecutionField';
import { browserMcpPolicy, normalizeChatModelContext } from './chatModelContext';
import type { ChatMcpServerOptions, ChatModelContext, hostedMcpRoute } from './chatModelContext';
import { useAppTranslation } from './i18n';
import type { McpOptions } from './mcp';
import { McpServerCard } from './McpServersView';
import { McpAllowedToolsField, McpApprovalField, McpPolicyCard } from './McpToolControls';
import { useMcpRegistry } from './useMcpRegistry';
import type { McpSelection } from './useMcpServers';

export type ChatModelContextServers = {
  servers: McpSelection['connected'];
  registry?: McpOptions;
  descriptions: ReadonlyMap<string, string>;
  route: ReturnType<typeof hostedMcpRoute>;
};

export function ChatModelContextFields({ servers, registry, descriptions, route, value, onChange, locked }: ChatModelContextServers & {
  value?: ChatModelContext; onChange: (value: ChatModelContext | undefined) => void; locked: boolean;
}) {
  const { t } = useAppTranslation();
  const { byEndpoint } = useMcpRegistry(registry, false, servers.map(({ record }) => record));
  const hosted = !!route && value?.execution === 'hosted';
  const policy = { ...browserMcpPolicy, ...value?.policy };
  const change = (patch: Partial<ChatModelContext>) => onChange(normalizeChatModelContext({ ...value, ...patch }));
  const changeServer = (endpoint: string, patch: Partial<ChatMcpServerOptions>) => change({
    servers: { ...value?.servers, [endpoint]: { ...value?.servers?.[endpoint], ...patch } },
  });

  return <div className="chat-preference-cards">
    <section className="chat-tool-card">
      <ChatExecutionField value={route || value?.execution !== 'hosted' ? value?.execution : undefined}
        disabled={locked} hostedSupported={!!route} onChange={execution => change({ execution })} />
    </section>
    <McpPolicyCard policy={policy} onChange={hosted || locked ? undefined : (flag, checked) => change({ policy: { ...policy, [flag]: checked } })} />
    {hosted && <p>{t(route === '/v1/responses' ? 'Select Always to review hosted tool arguments before execution.' : 'Select Always to review hosted tool results before sharing them with the model.')}</p>}
    {servers.map(({ record, discovery }) => {
      const { id, endpoint, title } = record;
      const options = value?.servers?.[endpoint];
      return <McpServerCard key={id} title={title} registryEntry={byEndpoint.get(endpoint)} description={descriptions.get(endpoint)} inDialog>
        <div className="agent-mcp-columns">
          <McpAllowedToolsField available={discovery.tools.map(tool => tool.remoteName)} names={options?.allowedTools} disabled={locked}
            onChange={allowedTools => changeServer(endpoint, { allowedTools })} />
          <McpApprovalField approval={options?.requireApproval} disabled={locked || !hosted}
            onChange={requireApproval => changeServer(endpoint, { requireApproval })} />
        </div>
      </McpServerCard>;
    })}
    {hosted && (['toolSearch', 'resourceSearch'] as const).map(key => {
      const label = t(agentSearchTools[key === 'toolSearch' ? 'tool_search' : 'resource_search']);
      return <section key={key} className="agent-field-group" aria-label={label}>
        <header className="agent-mcp-heading"><h3>{label}</h3>
          <AgentSwitch label={label} hideLabel checked={value?.[key] === true} onChange={locked ? undefined : checked => change({ [key]: checked })} />
        </header>
      </section>;
    })}
  </div>;
}
