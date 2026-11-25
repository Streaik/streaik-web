import type { AgentDefinition, AgentModel, JsonObject } from './agentDefinition.ts';
import { chatProviderForModel, chatProviderRequest, chatProviders, nativeObject } from './providerChat/settings.ts';
import type { NativeOptions } from './providerChat/settings.ts';

export const agentProviderOptions = (model: AgentModel) => nativeObject(model.providerMetadata);

export function withAgentProviderOptions(model: AgentModel, options: NativeOptions): AgentModel {
  // Form state allows undefined; portable agent definitions contain JSON only.
  const metadata = JSON.parse(JSON.stringify(options)) as JsonObject;
  const { providerMetadata: _previous, ...rest } = model;
  return Object.keys(metadata).length ? { ...rest, providerMetadata: metadata } : rest;
}

export function agentProviderRequest(model: AgentModel) {
  const provider = chatProviderForModel(model.id);
  const options = agentProviderOptions(model);
  if (provider && options && Object.keys(options).length) return chatProviderRequest({ [provider]: options }, model.id);
}

function persistentModel(model: AgentModel): AgentModel {
  const provider = chatProviderForModel(model.id);
  const options = agentProviderOptions(model);
  if (!provider || !options) return model;
  const adapter = chatProviders[provider];
  if (!('persist' in adapter)) return model;
  const safe = adapter.persist(options);
  return safe === options ? model : withAgentProviderOptions(model, safe);
}

export function persistentAgentDefinition(agent: AgentDefinition): AgentDefinition {
  // Keep the legacy entry even when a model collection takes precedence. Redact
  // both shapes on disk, but keep the live definition intact for this session.
  return { ...agent, ...(agent.model && { model: persistentModel(agent.model) }),
    ...(agent.models && { models: agent.models.map(persistentModel) }) };
}
