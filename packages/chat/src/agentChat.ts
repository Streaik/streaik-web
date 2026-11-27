import type { CatalogModel, ChatRoute, GatewayChatEndpoint, NativeChatEndpoint } from '@streaik/gateway';
import { agentModels } from './agentDefinition.ts';
import type { AgentDefinition, AgentModel } from './agentDefinition.ts';

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

/** Match configured answer models against the chat catalog, but find routers in the unfiltered gateway catalog. */
export function browserGatewayAgentModels(agent: AgentDefinition | undefined, catalog: readonly CatalogModel[],
  compatible: readonly CatalogModel[], preferred?: CatalogModel) {
  const answers = new Map<string, { model: CatalogModel; configuration?: AgentModel }>();
  const configured = agentModels(agent);
  const byId = new Map(compatible.map(model => [model.id, model]));
  for (const configuration of configured) {
    const { id, type } = configuration;
    if ((type != null && type !== 'language') || answers.has(id)) continue;
    const model = byId.get(id);
    if (model) answers.set(id, { model, configuration });
  }
  if (agent && !configured.length) {
    const model = (preferred && byId.get(preferred.id)) ?? compatible[0];
    if (model) answers.set(model.id, { model });
  }

  const decisionIds = new Set(catalog.filter(({ type }) => type === 'decision').map(({ id }) => id));
  // An explicit Decision entry wins. Otherwise, a configured answer ID may also
  // act as the router, without removing its Language variant from the choices.
  const router = configured.find(({ type }) => type === 'decision') ?? configured.find(({ id, type }) =>
    (type == null || type === 'language') && decisionIds.has(id));
  return { answers: [...answers.values()], router };
}
