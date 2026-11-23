import { createContext, useContext, useState } from 'react';
import type { ReactNode } from 'react';
import { buildAgentCatalog, emptyAgentData, readAgentData, removeAgentChange, saveAgentDefinition, setRoleAssignment } from './agentCatalog';
import type { AgentData, AgentEntry, AgentKey, AgentRole, AgentsConfig } from './agentCatalog';
import type { AgentDefinition } from './agentDefinition';

type AgentStore = {
  config: AgentsConfig;
  entries: AgentEntry[];
  data: AgentData;
  notice?: string;
  save: (definition: AgentDefinition, entry?: AgentEntry) => void;
  removeChange: (entry: AgentEntry) => void;
  assign: (role: AgentRole, key: AgentKey | null | undefined) => void;
};

type Snapshot = { key?: string; data: AgentData; readFailed?: boolean; notice?: string };
const AgentsContext = createContext<AgentStore | undefined>(undefined);

function open(key: string | undefined): Snapshot {
  if (!key) return { data: emptyAgentData(), notice: 'Changes are kept only for this session.' };
  try { return { key, data: readAgentData(localStorage.getItem(key)) }; }
  catch {
    return { key, data: emptyAgentData(), readFailed: true,
      notice: 'Could not open saved agents. Changes are kept only for this session.' };
  }
}

export function AgentsProvider({ config, scope, children }: { config?: AgentsConfig; scope?: string; children: ReactNode }) {
  const key = config && scope ? `streaik.agents.v1:${scope}` : undefined;
  const [stored, setStored] = useState(() => open(key));
  let snapshot = stored;
  if (stored.key !== key) {
    // Clear the old profile before rendering its consumers, without remounting the settings dialog.
    snapshot = open(key);
    setStored(snapshot);
  }

  function commit(data: AgentData) {
    if (!key || snapshot.readFailed) { setStored({ ...snapshot, data }); return; }
    try {
      localStorage.setItem(key, JSON.stringify(data));
      setStored({ key, data });
    } catch {
      setStored({ key, data, notice: 'Could not save agents to this browser. Changes are kept only for this session.' });
    }
  }

  let value: AgentStore | undefined;
  if (config) {
    const { data, notice } = snapshot;
    const entries = buildAgentCatalog(config, data);
    value = { config, data, entries, notice,
      save: (definition, entry) => commit(saveAgentDefinition(data, entries, definition, entry, entry ? undefined : crypto.randomUUID())),
      removeChange: (entry) => commit(removeAgentChange(data, entry)),
      assign: (role, selection) => commit(setRoleAssignment(data, role, selection)),
    };
  }
  return <AgentsContext.Provider value={value}>{children}</AgentsContext.Provider>;
}

export function useAgents() { return useContext(AgentsContext); }
