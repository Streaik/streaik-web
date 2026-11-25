import type { ChatModel } from '@streaik/gateway';
import { agentModels } from './agentDefinition.ts';
import type { AgentDefinition } from './agentDefinition.ts';

export function defaultAgentModelIds(agent?: AgentDefinition) {
  return agentModels(agent).filter(({ type }) => type !== 'decision').map(({ id }) => id);
}

export function resolveModelSelection<T extends ChatModel>(models: readonly T[], ids: readonly string[] | undefined,
  multiple: boolean, defaultIds?: readonly string[]) {
  const byId = new Map(models.map(model => [model.id, model]));
  // Only an untouched picker inherits defaults. A cleared or unavailable explicit choice stays empty.
  const selected = [...new Set(ids ?? defaultIds)].flatMap(id => {
    const model = byId.get(id);
    return model ? [model] : [];
  });
  return { byId, selected: multiple ? selected : selected.slice(0, 1) };
}
