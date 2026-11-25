import type { NativeOptions, NativeValue } from '../settings.ts';

export const list = (value?: NativeValue): readonly NativeValue[] => Array.isArray(value) ? value : [];
export const object = (value?: NativeValue): NativeOptions =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as NativeOptions : {};
export const typedItem = (value: NativeValue | undefined, type: string) =>
  list(value).map(object).find(item => item.type === type);

// Edit a native list in place without reordering other entries or dropping types a newer provider supports.
export function updateTypedItem(value: NativeValue | undefined, type: string, next?: NativeOptions) {
  const items = list(value);
  const replacement = next && { ...next, type };
  const index = items.findIndex(item => object(item).type === type);
  const updated = index === -1 ? (replacement ? [...items, replacement] : items)
    : replacement ? items.map((item, i) => i === index ? replacement : item) : items.filter((_, i) => i !== index);
  return updated.length ? updated : undefined;
}

export function toggleInclude(value: NativeValue | undefined, key: string, enabled: boolean) {
  const entries = list(value).filter(item => item !== key);
  return enabled ? [...entries, key] : entries.length ? entries : undefined;
}

export const efforts = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'];
export const summaries = ['auto', 'concise', 'detailed'];
export const tiers = ['auto', 'default', 'flex', 'scale', 'priority', 'fast', 'ultrafast'];

function containerOptions(tool: NativeOptions, persist: boolean): NativeOptions {
  const key = tool.type === 'shell' ? 'environment' : tool.type === 'code_interpreter' ? 'container' : undefined;
  if (!key) return tool;
  const container = object(tool[key]);
  const policy = object(container.network_policy);
  if (!Array.isArray(policy.domain_secrets)) return tool;
  const domain_secrets = list(policy.domain_secrets).map(object).flatMap(secret => {
    if (persist) {
      const { value: _secret, ...metadata } = secret;
      return [metadata];
    }
    return typeof secret.domain === 'string' && secret.domain.trim() && typeof secret.name === 'string' && secret.name.trim()
      && typeof secret.value === 'string' && secret.value.length ? [secret] : [];
  });
  const { domain_secrets: _old, ...rest } = policy;
  return { ...tool, [key]: { ...container, network_policy: { ...rest, ...(domain_secrets.length && { domain_secrets }) } } };
}

export function persistOpenAIOptions(value: NativeOptions): NativeOptions {
  return Array.isArray(value.tools) ? { ...value, tools: list(value.tools).map(item => {
    const tool = object(item);
    return tool.type === 'shell' || tool.type === 'code_interpreter' ? containerOptions(tool, true) : item;
  }) } : value;
}

export function openAIChatOptions(value: NativeOptions): NativeOptions {
  // Managed session options are native to the session endpoint, not the Responses endpoint.
  const { agent: _agent, environment: _environment, tools: saved, ...response } = value;
  const tools = list(saved).flatMap(item => {
    const tool = object(item);
    if (tool.type === 'apply_patch' || tool.type === 'tool_search' && tool.execution === 'client') return [];
    if (tool.type === 'shell') {
      const environment = object(tool.environment);
      if (environment.type === 'local' || environment.type === 'container_reference') return [];
      const { skills: configured, ...rest } = environment;
      const skills = list(configured).filter(item => {
        const skill = object(item);
        return skill.type !== 'skill_reference' || typeof skill.skill_id === 'string' && skill.skill_id.trim();
      });
      return [containerOptions({ ...tool, environment: { ...rest, ...(skills.length && { skills }) } }, false)];
    }
    if (tool.type === 'code_interpreter') return tool.container === '' ? [] : [containerOptions(tool, false)];
    if (tool.type === 'file_search' && Array.isArray(tool.vector_store_ids) && !tool.vector_store_ids.length) return [];
    return [item];
  });
  return tools.length ? { ...response, tools } : response;
}

export const openAIChatHeaders = (config: NativeOptions) => object(config.multi_agent).enabled === true
  ? { 'OpenAI-Beta': 'responses_multi_agent=v1' } : undefined;
