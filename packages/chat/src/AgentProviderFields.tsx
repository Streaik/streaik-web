import type { CatalogModel, ChatModel } from '@streaik/gateway';
import { useId, useState } from 'react';
import type { AgentModel } from './agentDefinition';
import { agentProviderOptions } from './agentProviderSettings';
import { useAppTranslation } from './i18n';
import { ProviderChatForm } from './providerChat/forms';
import { chatProviderForModel, chatProviders } from './providerChat/settings';
import type { ChatProviderId, NativeOptions } from './providerChat/settings';

type ProviderModel = { key: string; index: number; model: AgentModel; info: ChatModel };

export function agentProviderGroups(models: readonly AgentModel[], catalog: readonly CatalogModel[]) {
  const groups = new Map<ChatProviderId, ProviderModel[]>();
  const occurrences = new Map<string, number>();
  for (const [index, model] of models.entries()) {
    const provider = chatProviderForModel(model.id);
    if (!provider) continue;
    const occurrence = occurrences.get(model.id) ?? 0;
    occurrences.set(model.id, occurrence + 1);
    const name = catalog.find(item => item.id === model.id)?.name ?? model.id;
    const entry = { key: `${model.id}:${occurrence}`, index, model, info: { id: model.id, name, provider } };
    const group = groups.get(provider);
    if (group) group.push(entry);
    else groups.set(provider, [entry]);
  }
  return groups;
}

export function AgentProviderFields({ provider, entries, onChange }: {
  provider: ChatProviderId; entries: readonly ProviderModel[]; onChange: (index: number, options: NativeOptions) => void;
}) {
  const { t } = useAppTranslation();
  const id = useId();
  const [selected, setSelected] = useState<string>();
  const active = entries.find(({ key }) => key === selected)?.key ?? entries[0]?.key;
  return <div className="chat-provider-fields">
    {entries.length > 1 && <div className="chat-provider-select">
      <label htmlFor={id}>{t('Model')}</label>
      <select id={id} value={active} onChange={(event) => setSelected(event.currentTarget.value)}>
        {entries.map(({ key, info }) => <option key={key} value={key}>
          {info.name === info.id ? info.id : `${info.name} (${info.id})`}
        </option>)}
      </select>
    </div>}
    {/* Keep model-specific field state mounted when switching model or provider. */}
    {entries.map(({ key, index, model, info }) => <div key={key} hidden={key !== active}>
      <fieldset className="chat-provider-fields" aria-label={chatProviders[provider].label}>
        <ProviderChatForm provider={provider} models={[info]} value={agentProviderOptions(model) ?? {}}
          onChange={options => onChange(index, options)} />
      </fieldset>
    </div>)}
  </div>;
}
