import type { AgentDefinition, AgentModel, JsonObject } from './agentDefinition.ts';
import { chatProviderForModel, chatProviderRequest, chatProviders, nativeObject } from './providerChat/settings.ts';
import type { ChatProviderId, NativeOptions, NativeValue } from './providerChat/settings.ts';
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

function ownOption(options: NativeOptions, key: string) {
  return Object.hasOwn(options, key) ? options[key] : undefined;
}

function optionKeys(left: NativeOptions, right: NativeOptions) {
  return new Set([...Object.keys(left), ...Object.keys(right)]);
}

function equalOption(left?: NativeValue, right?: NativeValue): boolean {
  if (Object.is(left, right)) return true;
  if (Array.isArray(left) && Array.isArray(right)) {
    return left.length === right.length && left.every((value, i) => equalOption(value, right[i]));
  }
  const a = nativeObject(left), b = nativeObject(right);
  return !!a && !!b && [...optionKeys(a, b)].every(key => equalOption(ownOption(a, key), ownOption(b, key)));
}

// Tools and response includes are configured by individual switches, not as ordered lists.
function optionListKey(field: string, value: NativeValue) {
  if (field === 'include') return typeof value === 'string' ? value : undefined;
  if (field !== 'tools') return;
  const tool = nativeObject(value);
  if (typeof tool?.type !== 'string') return;
  const kind = tool.type.replace(/_\d{8}$/, '');
  return kind !== tool.type ? kind : JSON.stringify([kind, tool.name ?? tool.server_label]);
}

function optionList(value?: NativeValue): readonly NativeValue[] {
  return Array.isArray(value) ? value : [];
}

type OptionScope = 'provider' | 'agent' | 'nested';

function childScope(scope: OptionScope, key: string): OptionScope {
  return scope === 'provider' && key === 'agent' ? 'agent' : 'nested';
}

function isKeyedList(scope: OptionScope, key: string) {
  return (key === 'tools' && scope !== 'nested') || (key === 'include' && scope === 'provider');
}

function sharedOptions(left: NativeOptions, right: NativeOptions, scope: OptionScope): NativeOptions {
  return Object.fromEntries(Object.entries(left).flatMap(([key, value]) => {
    if (value === undefined) return [];
    const other = ownOption(right, key);
    if (equalOption(value, other)) return [[key, value]];
    const a = nativeObject(value), b = nativeObject(other);
    if (a && b) return [[key, sharedOptions(a, b, childScope(scope, key))]];
    if (!isKeyedList(scope, key)) return [];
    const candidates = optionList(other);
    const common = optionList(value).filter(item => candidates.some(match => equalOption(item, match)));
    return common.length ? [[key, common]] : [];
  }));
}

export function sharedAgentProviderOptions(models: readonly AgentModel[]): NativeOptions {
  const [first, ...rest] = models;
  return rest.reduce<NativeOptions>((shared, model) => sharedOptions(shared, agentProviderOptions(model) ?? {}, 'provider'),
    first ? agentProviderOptions(first) ?? {} : {});
}

function patchOptions(current: NativeOptions, previous: NativeOptions, next: NativeOptions, scope: OptionScope): NativeOptions {
  const changes: [string, NativeValue | undefined][] = [];
  for (const key of optionKeys(previous, next)) {
    const before = ownOption(previous, key), after = ownOption(next, key);
    if (equalOption(before, after)) continue;
    const saved = ownOption(current, key);
    const updated = isKeyedList(scope, key) && (Array.isArray(before) || Array.isArray(after))
      ? patchOptionList(key, saved, before, after) : patchOption(saved, before, after, childScope(scope, key));
    if (!equalOption(saved, updated)) changes.push([key, updated]);
  }
  return changes.length ? { ...current, ...Object.fromEntries(changes) } : current;
}

function patchOption(saved: NativeValue | undefined, before: NativeValue | undefined, after: NativeValue | undefined,
  scope: OptionScope = 'nested'): NativeValue | undefined {
  const oldObject = nativeObject(before), newObject = nativeObject(after);
  return newObject && (oldObject || before === undefined)
    ? patchOptions(nativeObject(saved) ?? {}, oldObject ?? {}, newObject, scope) : after;
}

function patchOptionList(field: string, saved?: NativeValue, before?: NativeValue, after?: NativeValue) {
  const previous = optionList(before), next = optionList(after);
  const changes = new Map<string, { before?: NativeValue; after?: NativeValue }>();
  for (const value of previous) {
    const key = optionListKey(field, value);
    if (key !== undefined) changes.set(key, { before: value });
  }
  for (const value of next) {
    const key = optionListKey(field, value);
    if (key !== undefined) changes.set(key, { before: changes.get(key)?.before, after: value });
  }
  for (const [key, change] of changes) if (equalOption(change.before, change.after)) changes.delete(key);
  const result = optionList(saved).flatMap(value => {
    const key = optionListKey(field, value);
    if (key === undefined) return [value];
    const change = changes.get(key);
    if (!change) return [value];
    changes.delete(key);
    const updated = patchOption(value, change.before, change.after);
    return updated === undefined ? [] : [updated];
  });
  for (const { after: value } of changes.values()) if (value !== undefined) result.push(value);
  return result.length ? result : undefined;
}

/** Replay only the edited options against each model's own data. */
export function patchAgentProviderModels(models: readonly AgentModel[], provider: ChatProviderId, previous: NativeOptions, next: NativeOptions) {
  return models.map(model => {
    if (chatProviderForModel(model.id) !== provider) return model;
    const current = agentProviderOptions(model) ?? {};
    const updated = patchOptions(current, previous, next, 'provider');
    return updated === current ? model : withAgentProviderOptions(model, updated);
  });
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
