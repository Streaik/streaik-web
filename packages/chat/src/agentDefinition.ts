import type { CatalogModel } from '@streaik/gateway';

export type JsonValue = null | boolean | number | string | readonly JsonValue[] | JsonObject;
export type JsonObject = { readonly [key: string]: JsonValue };

export type AgentModel = JsonObject & { readonly id: string };

/** Portable AI Happey JSON. Fields the browser doesn't interpret remain opaque JSON. */
export type AgentDefinition = JsonObject & {
  readonly name: string;
  readonly description: string;
  readonly instructions: string;
  readonly model?: AgentModel | null;
  readonly models?: readonly AgentModel[] | null;
  readonly tags?: readonly string[] | null;
};

export function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasText(value: unknown): value is string {
  return typeof value === 'string' && !!value.trim();
}

export function isModel(value: unknown): value is AgentModel {
  return isObject(value) && hasText(value.id);
}

export function isAgentDefinition(value: unknown): value is AgentDefinition {
  return isObject(value) && hasText(value.name) && hasText(value.description) && hasText(value.instructions)
    && (value.model == null || isModel(value.model))
    && (value.models == null || (Array.isArray(value.models) && value.models.every(isModel)))
    && (value.tags == null || (Array.isArray(value.tags) && value.tags.every((tag) => typeof tag === 'string')));
}

export function agentModels(agent?: AgentDefinition): readonly AgentModel[] {
  return agent?.models?.length ? agent.models : agent?.model ? [agent.model] : [];
}

export function agentCatalogModel(model: AgentModel, catalog: readonly CatalogModel[]) {
  const { id, type } = model;
  // Old definitions do not always record a type. Prefer the answer variant
  // for display and editing when the same legacy ID serves both roles.
  return catalog.find(item => item.id === id && item.type === (type ?? 'language'))
    ?? (type == null ? catalog.find(item => item.id === id) : undefined);
}

export const agentModelKey = ({ id, type }: { id: string; type?: unknown }) => JSON.stringify([id, type]);

// Use the first answer model, not the router, for the card's provider identity.
export function primaryAgentModel(agent: AgentDefinition, isDecision = (model: AgentModel) => model.type === 'decision') {
  const models = agentModels(agent);
  return models.find((model) => !isDecision(model)) ?? models[0];
}
