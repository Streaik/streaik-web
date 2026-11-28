import type { AgentBackend, HostedAgent, NativeChatEndpoint } from '@streaik/gateway';
import { useEffect, useState } from 'react';
import { resolveAgentChatRoute } from './agentChat';
import type { AgentChatRoute } from './agentChat';
import type { AgentEntry } from './agentCatalog';
import { isAgentDefinition } from './agentDefinition';
import type { AgentDefinition } from './agentDefinition';

export function useAgentChat({ active, backend, ready, scope, revision, entries, gateway, direct }: {
  active: boolean; backend?: AgentBackend; ready: boolean; scope?: string; revision: number;
  entries: readonly AgentEntry[]; gateway: boolean; direct: readonly NativeChatEndpoint[];
}) {
  const stamp = JSON.stringify([scope, revision]);
  const [requested, setRoute] = useState<AgentChatRoute>();
  const [selectedKey, select] = useState<string>();
  const [probe, setProbe] = useState<{ backend: AgentBackend; stamp: string; agents?: HostedAgent[] }>();
  const [detail, setDetail] = useState<{ backend: AgentBackend; stamp: string; id: string; definition?: AgentDefinition }>();
  useEffect(() => {
    if (!active || !backend || !ready) return;
    const controller = new AbortController();
    void backend.listAgents(controller.signal).then(
      agents => { if (!controller.signal.aborted) setProbe({ backend, stamp, agents }); },
      () => { if (!controller.signal.aborted) setProbe({ backend, stamp }); },
    );
    return () => controller.abort();
  }, [active, backend, ready, stamp]);
  const current = ready && probe?.backend === backend && probe?.stamp === stamp ? probe : undefined;
  const remote = current?.agents;
  const hosted = !!remote;
  const route = resolveAgentChatRoute(requested, hosted, gateway, direct);
  const remoteOptions = (remote ?? []).map(agent => ({ ...agent, key: `remote:${agent.id}`, hosted: true }));
  const localOptions = entries.map(({ key, definition, id }) => ({ key, name: definition.name, definition, id,
    owned_by: typeof definition.owned_by === 'string' ? definition.owned_by : undefined, tags: definition.tags ?? undefined }));
  const options = [...localOptions, ...remoteOptions];
  const option = options.find(({ key }) => key === selectedKey);
  const remoteId = option && 'hosted' in option ? option.id : undefined;
  useEffect(() => {
    if (!active || !backend || !ready || !remoteId) return;
    const controller = new AbortController();
    void backend.getAgent(remoteId, controller.signal).then(
      value => { if (!controller.signal.aborted) setDetail({ backend, stamp, id: remoteId, definition: isAgentDefinition(value) ? value : undefined }); },
      () => { if (!controller.signal.aborted) setDetail({ backend, stamp, id: remoteId }); },
    );
    return () => controller.abort();
  }, [active, backend, ready, remoteId, stamp]);
  const loaded = detail?.backend === backend && detail?.stamp === stamp && detail?.id === remoteId ? detail : undefined;
  const definition = option && 'definition' in option ? option.definition : loaded?.definition;
  return { route, setRoute, options, option, select, definition, remoteId, hosted,
    checking: !!backend && ready && !current && (!requested || requested.mode === 'agents'),
    loadingDefinition: !!remoteId && !loaded, hostedUnavailable: !!current && !hosted };
}
