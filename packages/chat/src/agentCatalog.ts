import { isAgentDefinition, isObject } from './agentDefinition.ts';
import type { AgentDefinition } from './agentDefinition.ts';

export type AgentKey = `${'sample' | 'local' | 'remote'}:${string}`;
type AgentRecord = { id: string; definition: AgentDefinition };
export type AgentRole = { id: string; label: string; defaultAgentId?: string };
export type AgentsConfig = {
  defaults: readonly AgentRecord[];
  roles?: readonly AgentRole[];
};

export type AgentEntry =
  | (AgentRecord & { key: `sample:${string}`; source: 'sample'; overridden: boolean })
  | (AgentRecord & { key: `local:${string}`; source: 'local' });

export type AgentData = {
  version: 1;
  local: AgentRecord[];
  overrides: AgentRecord[];
  assignments: Record<string, AgentKey | null>;
};

export function emptyAgentData(): AgentData {
  return { version: 1, local: [], overrides: [], assignments: {} };
}

function isAgentKey(value: unknown): value is AgentKey {
  return typeof value === 'string' && /^(sample|local|remote):.+$/.test(value);
}

function isAgentRecord(value: unknown): value is AgentRecord {
  return isObject(value) && typeof value.id === 'string' && !!value.id && isAgentDefinition(value.definition);
}

export function readAgentData(raw: string | null): AgentData {
  if (raw === null) return emptyAgentData();
  const data: unknown = JSON.parse(raw);
  if (!isObject(data) || data.version !== 1 || !Array.isArray(data.local) || !data.local.every(isAgentRecord)
      || !Array.isArray(data.overrides) || !data.overrides.every(isAgentRecord) || !isObject(data.assignments)
      || !Object.values(data.assignments).every((value) => value === null || isAgentKey(value))) {
    throw new Error('Unsupported local agent data.');
  }
  return { version: 1, local: data.local, overrides: data.overrides, assignments: data.assignments as AgentData['assignments'] };
}

export function buildAgentCatalog(config: AgentsConfig, data: AgentData): AgentEntry[] {
  const overrides = new Map(data.overrides.map(({ id, definition }) => [id, definition]));
  return [
    ...config.defaults.map(({ id, definition }): AgentEntry => {
      const override = overrides.get(id);
      // IDs are stable across deployments. Keep the current sample's name on overrides.
      return { id, key: `sample:${id}`, source: 'sample', overridden: !!override,
        definition: override ? { ...override, name: definition.name } : definition };
    }),
    ...data.local.map(({ id, definition }): AgentEntry => ({ id, definition, key: `local:${id}`, source: 'local' })),
  ].sort((a, b) => a.definition.name.localeCompare(b.definition.name));
}

export function saveAgentDefinition(data: AgentData, entries: readonly AgentEntry[],
  definition: AgentDefinition, entry?: AgentEntry, newId?: string): AgentData {
  const name = definition.name.trim();
  if (entry?.source === 'sample' && entry.definition.name !== name) throw new Error('Sample agent names cannot be changed.');
  if (entry?.definition.name !== name && entries.some((item) => item.key !== entry?.key
      && item.definition.name.trim().toLowerCase() === name.toLowerCase())) {
    throw new Error('An agent with this name already exists.');
  }
  if (entry?.source === 'sample') {
    return { ...data, overrides: [...data.overrides.filter(({ id }) => id !== entry.id), { id: entry.id, definition }] };
  }
  if (entry) return { ...data, local: data.local.map((record) => record.id === entry.id ? { ...record, definition } : record) };
  if (!newId) throw new Error('Could not create an agent ID.');
  return { ...data, local: [...data.local, { id: newId, definition }] };
}

/** Removing an entry leaves explicit role assignments unavailable until the user changes them. */
export function removeAgentChange(data: AgentData, entry: AgentEntry): AgentData {
  return entry.source === 'sample'
    ? { ...data, overrides: data.overrides.filter(({ id }) => id !== entry.id) }
    : { ...data, local: data.local.filter(({ id }) => id !== entry.id) };
}

export function defaultAgentKey(role: AgentRole): AgentKey | null {
  return role.defaultAgentId ? `sample:${role.defaultAgentId}` : null;
}

export function roleAssignment(data: AgentData, role: AgentRole): AgentKey | null | undefined {
  return Object.hasOwn(data.assignments, role.id) ? data.assignments[role.id] : undefined;
}

export function effectiveRoleAssignment(data: AgentData, role: AgentRole): AgentKey | null {
  const assigned = roleAssignment(data, role);
  return assigned === undefined ? defaultAgentKey(role) : assigned;
}

export function assignedAgent(store: { config: AgentsConfig; data: AgentData; entries: readonly AgentEntry[] } | undefined, roleId: string) {
  const role = store?.config.roles?.find(({ id }) => id === roleId);
  if (!store || !role) return;
  const key = effectiveRoleAssignment(store.data, role);
  return store.entries.find((entry) => entry.key === key)?.definition;
}

/** undefined inherits the host default; null explicitly disables the role. */
export function setRoleAssignment(data: AgentData, role: AgentRole, key: AgentKey | null | undefined): AgentData {
  if (key !== undefined) return { ...data, assignments: { ...data.assignments, [role.id]: key } };
  const assignments = { ...data.assignments };
  delete assignments[role.id];
  return { ...data, assignments };
}
