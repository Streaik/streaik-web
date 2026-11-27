import type { AgentDefinition, AgentModel, JsonObject } from './agentDefinition.ts';
import { chatProviderForModel, chatProviderRequest, chatProviders, nativeObject } from './providerChat/settings.ts';
import type { NativeOptions } from './providerChat/settings.ts';
import { savedAnthropicHeaders } from './providerChat/anthropic/options.ts';

export function agentProviderOptions(model: AgentModel) {
  const body = nativeObject(model.providerMetadata);
  if (chatProviderForModel(model.id) !== 'anthropic') return body;
  const headers = savedAnthropicHeaders(nativeObject(model.providerHeaders) ?? {});
  return body || Object.keys(headers).length ? { ...body, ...headers } : undefined;
}

export function withAgentProviderOptions(model: AgentModel, options: NativeOptions): AgentModel {
  // Form state allows undefined; portable agent definitions contain JSON only.
  const metadata = JSON.parse(JSON.stringify(options)) as JsonObject;
  const { providerMetadata: _previous, ...rest } = model;
  if (chatProviderForModel(model.id) === 'anthropic') {
    const { providerHeaders: _previousHeaders, ...target } = rest;
    const retained = Object.entries(nativeObject(_previousHeaders) ?? {}).filter(([name]) => !/^anthropic-(version|beta)$/i.test(name));
    const headers = { ...Object.fromEntries(retained), ...savedAnthropicHeaders(options) } as JsonObject;
    const body = Object.fromEntries(Object.entries(metadata).filter(([name]) => !/^anthropic-(version|beta)$/i.test(name)));
    return { ...target, ...(Object.keys(body).length && { providerMetadata: body }),
      ...(Object.keys(headers).length && { providerHeaders: headers }) };
  }
  return Object.keys(metadata).length ? { ...rest, providerMetadata: metadata } : rest;
}

export function agentChatProviderSettings(model?: AgentModel) {
  if (!model) return;
  const provider = chatProviderForModel(model.id);
  const options = agentProviderOptions(model);
  return provider && options ? { [provider]: options } : undefined;
}

export function agentProviderRequest(model: AgentModel) {
  return chatProviderRequest(agentChatProviderSettings(model), model.id);
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
