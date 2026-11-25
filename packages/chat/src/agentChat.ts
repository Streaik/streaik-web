import type { CatalogModel, ChatRoute, GatewayChatEndpoint, NativeChatEndpoint } from '@streaik/gateway';
import { agentModels } from './agentDefinition.ts';
import type { AgentDefinition } from './agentDefinition.ts';

export type AgentChatRoute = ChatRoute | { mode: 'agents'; endpoint: GatewayChatEndpoint };

export function resolveAgentChatRoute(requested: AgentChatRoute | undefined, hosted: boolean,
  gateway: boolean, direct: readonly NativeChatEndpoint[]): AgentChatRoute | undefined {
  if (requested && (requested.mode === 'agents' ? hosted : requested.mode === 'gateway' ? gateway : direct.includes(requested.endpoint))) return requested;
  if (hosted && (!requested || requested.mode === 'agents')) return { mode: 'agents', endpoint: '/api/chat' };
  if (gateway) return { mode: 'gateway', endpoint: '/api/chat' };
  if (direct[0]) return { mode: 'direct', endpoint: direct[0] };
}

export function browserAgentModel(agent: AgentDefinition | undefined, compatible: readonly CatalogModel[], preferred?: CatalogModel) {
  if (!agent) return;
  const models = agentModels(agent).filter(({ type }) => type !== 'decision');
  return models.length ? models.map(model => compatible.find(({ id }) => id === model.id)).find(Boolean)
    : agentModels(agent).length ? undefined : compatible.find(({ id }) => id === preferred?.id) ?? compatible[0];
}
