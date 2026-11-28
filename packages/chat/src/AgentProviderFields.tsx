import type { CatalogModel, ChatModel } from '@streaik/gateway';
import { useId, useState } from 'react';
import { agentCatalogModel, agentModelKey } from './agentDefinition';
import type { AgentModel } from './agentDefinition';
import { agentProviderOptions, sharedAgentProviderOptions } from './agentProviderSettings';
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
    const modelKey = agentModelKey(model);
    const occurrence = occurrences.get(modelKey) ?? 0;
    occurrences.set(modelKey, occurrence + 1);
    const name = agentCatalogModel(model, catalog)?.name ?? model.id;
    const entry = { key: `${modelKey}:${occurrence}`, index, model, info: { id: model.id, name, provider } };
    const group = groups.get(provider);
    if (group) group.push(entry);
    else groups.set(provider, [entry]);
  }
  return groups;
}

export function AgentProviderFields({ provider, entries, onChange, onChangeAll }: {
  provider: ChatProviderId; entries: readonly ProviderModel[]; onChange: (index: number, options: NativeOptions) => void;
  onChangeAll: (provider: ChatProviderId, previous: NativeOptions, next: NativeOptions) => void;
}) {
  const { t } = useAppTranslation();
  const id = useId();
  const [selected, setSelected] = useState('all');
  const multiple = entries.length > 1;
  const active = entries.some(({ key }) => key === selected) ? selected : 'all';
  const shared = multiple ? sharedAgentProviderOptions(entries.map(({ model }) => model)) : {};
  const tabs = [
    { key: 'all', label: t('All'), description: undefined },
    ...entries.map(({ key, model }) => {
      const label = model.id.slice(provider.length + 1);
      const description = entries.some(entry => entry.key !== key && entry.model.id === model.id && entry.model.type !== model.type)
        ? `${label} · ${t(model.type === 'decision' ? 'Decision' : 'Language')}` : undefined;
      return { key, label, description };
    }),
  ];

  function select(key: string, button: HTMLButtonElement) {
    if (key === active) return;
    setSelected(key);
    button.closest('.agent-panels')?.scrollTo({ top: 0 });
  }

  return <div className={multiple ? 'agent-provider-models' : undefined}>
    {multiple && <div className="chat-settings-tabs agent-provider-tabs" role="tablist" aria-label={t('Models')} aria-orientation="vertical">
      {tabs.map(({ key, label, description }, index) => <button key={key} type="button" role="tab" id={`${id}-${index}-tab`}
        aria-label={description} title={description ?? label} aria-selected={key === active} aria-controls={`${id}-${index}-panel`}
        tabIndex={key === active ? 0 : -1} onClick={event => select(key, event.currentTarget)} onKeyDown={event => {
          let next: number;
          switch (event.key) {
            case 'ArrowDown': next = (index + 1) % tabs.length; break;
            case 'ArrowUp': next = (index + tabs.length - 1) % tabs.length; break;
            case 'Home': next = 0; break;
            case 'End': next = tabs.length - 1; break;
            default: return;
          }
          event.preventDefault();
          select(tabs[next].key, event.currentTarget);
          event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]?.focus();
        }}>{label}</button>)}
    </div>}
    {multiple && <div className="agent-provider-model-panel" role="tabpanel" id={`${id}-0-panel`} aria-labelledby={`${id}-0-tab`} hidden={active !== 'all'}>
      <fieldset className="chat-provider-fields" aria-label={chatProviders[provider].label}>
        <ProviderChatForm provider={provider} models={entries.map(({ info }) => info)} value={shared}
          onChange={options => onChangeAll(provider, shared, options)} />
      </fieldset>
    </div>}
    {/* Keep model-specific field state mounted when switching model or provider. */}
    {entries.map(({ key, index, model, info }, position) => <div key={key} className="agent-provider-model-panel"
      role={multiple ? 'tabpanel' : undefined} id={multiple ? `${id}-${position + 1}-panel` : undefined}
      aria-labelledby={multiple ? `${id}-${position + 1}-tab` : undefined} hidden={multiple && key !== active}>
      <fieldset className="chat-provider-fields" aria-label={chatProviders[provider].label}>
        <ProviderChatForm provider={provider} models={[info]} value={agentProviderOptions(model) ?? {}}
          onChange={options => onChange(index, options)} />
      </fieldset>
    </div>)}
  </div>;
}
