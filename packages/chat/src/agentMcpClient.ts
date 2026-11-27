import { isObject } from './agentDefinition.ts';
import type { JsonObject, JsonValue } from './agentDefinition.ts';

export const agentMcpPolicy = {
  openWorldHint: 'Open world', destructiveHint: 'Destructive', readOnlyHint: 'Read-only', idempotentHint: 'Idempotent',
} as const;

type PolicyFlag = keyof typeof agentMcpPolicy;
const object = (value?: JsonValue) => isObject(value) ? value as JsonObject : undefined;

export function agentMcpClientSettings(value?: JsonValue) {
  const client = object(value);
  const capabilities = object(client?.capabilities);
  return { client, policy: object(client?.policy), capabilities, elicitation: object(capabilities?.elicitation) };
}

export function setAgentMcpPolicy(value: JsonValue | undefined, flag: PolicyFlag, enabled: boolean): JsonObject {
  const { client, policy } = agentMcpClientSettings(value);
  return { ...client, policy: { ...policy, [flag]: enabled } };
}

export function setAgentElicitation(value: JsonValue | undefined, mode: 'elicitation' | 'form', enabled: boolean): JsonValue | undefined {
  const { client, capabilities, elicitation } = agentMcpClientSettings(value);
  const { elicitation: _, ...otherCapabilities } = capabilities ?? {};
  const { capabilities: _capabilities, ...otherClient } = client ?? {};
  let next = elicitation;
  if (mode === 'elicitation') next = enabled ? elicitation ?? {} : undefined;
  else {
    if (!elicitation) return value;
    const { form, ...otherModes } = elicitation;
    next = enabled ? { ...otherModes, form: form ?? {} } : otherModes;
  }
  const nextCapabilities = next ? { ...otherCapabilities, elicitation: next } : otherCapabilities;
  if (Object.keys(nextCapabilities).length) return { ...otherClient, capabilities: nextCapabilities };
  return Object.keys(otherClient).length ? otherClient : undefined;
}
