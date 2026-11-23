import { gatewayDecisionEndpoints } from '@streaik/gateway';
import type { CatalogModel, ChatMessage, DecisionChoice, GatewayDecisionEndpoint, TokenRates } from '@streaik/gateway';
import { useState } from 'react';
import { assignedAgent } from './agentCatalog';
import type { useAgents } from './AgentsProvider';
import { agentModels } from './agentDefinition';
import { convertedAttachmentName } from './chatAttachments';
import directory from './provider-directory.json';

export const selectModelRoleId = 'select-model';
export type DecisionRoute = GatewayDecisionEndpoint | 'off';

export function useDecisionRoute(scope?: string) {
  const key = scope && `streaik.decisions.v1:${scope}`;
  function load(): DecisionRoute {
    if (key) try {
      const saved = localStorage.getItem(key);
      if (saved === 'off') return saved;
      const endpoint = gatewayDecisionEndpoints.find((item) => item === saved);
      if (endpoint) return endpoint;
    } catch { /* Storage is optional. */ }
    return '/v1/decisions';
  }
  const [stored, setStored] = useState(() => ({ key, value: load() }));
  const current = stored.key === key ? stored : { key, value: load() };
  if (current !== stored) setStored(current);
  return { selected: current.value, onSelect(value: DecisionRoute) {
    setStored({ key, value });
    if (key) try { localStorage.setItem(key, value); } catch { /* Keep the session preference. */ }
  } };
}

export function modelDecisionRouter(store: ReturnType<typeof useAgents>, catalog: readonly CatalogModel[], endpoint: DecisionRoute): ModelRouter | undefined {
  if (endpoint === 'off') return;
  const agent = assignedAgent(store, selectModelRoleId);
  const model = agentModels(agent)[0];
  if (!agent || !model) return;
  // Some catalogs do not publish a separate decision entry for a dual-use model.
  if (model.type !== 'decision' && !catalog.some((item) => item.id === model.id && item.type === 'decision')) return;
  return { endpoint, model: model.id, instructions: agent.instructions };
}

export function chatDecisionInput(messages: ChatMessage[]) {
  // Only conversation text is needed here, not tool inputs/outputs, files, reasoning or metadata.
  return JSON.stringify(messages.flatMap(({ role, parts }) => {
    if (role !== 'user' && role !== 'assistant') return [];
    const text = parts.flatMap((part) => part.type === 'text' && !convertedAttachmentName(part) ? [part.text] : []).join('\n');
    return text.trim() ? [{ role, text }] : [];
  }));
}

const providers: readonly { id: string; tokenPricing?: Readonly<Partial<Record<string, TokenRates>>> }[] = directory.providers;
const bundledPricing = new Map(providers.map(({ id, tokenPricing }) => [id, tokenPricing]));

export function chatModelDecision(router: ModelRouter | undefined, candidates: readonly CatalogModel[]): ModelDecision | undefined {
  if (!router || candidates.length < 2) return;
  return { ...router, choices: candidates.map(({ id, name, provider, description, tags, contextWindow, maxTokens, pricing }) => {
    const bundled = bundledPricing.get(provider);
    const rates = pricing ?? (bundled && Object.hasOwn(bundled, id) ? bundled[id] : undefined);
    return { value: id, description: JSON.stringify({ name, provider, description, tags, contextWindow, maxTokens,
      pricing: rates && { currency: 'USD', unit: 'token', ...rates } }) };
  }) };
}

export type ModelDecision = Omit<DecisionChoice, 'input'> & { endpoint: GatewayDecisionEndpoint };
export type ModelRouter = Omit<ModelDecision, 'choices'>;
