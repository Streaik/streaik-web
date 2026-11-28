import { Button, Select, Tooltip } from '@streaik/themes';
import type { SelectOption } from '@streaik/themes';
import { ChatIcon } from './ChatIcon';
import { useAppTranslation } from './i18n';

export function ChatModeButtons({ agentMode, disabled, onChange }: {
  agentMode: boolean; disabled: boolean; onChange: (agents: boolean) => void;
}) {
  const { t } = useAppTranslation();
  return <div className="chat-mode-buttons" role="group" aria-label={t('Chat mode')}>
    {([{ agents: false, label: 'Chat', icon: 'brain' }, { agents: true, label: 'Agents', icon: 'agents' }] as const).map(({ agents, label, icon }) =>
      <Tooltip key={label} content={t(label)}><Button type="button" className="chat-mode-button" variant="subtle"
        aria-label={t(agents ? 'Agent chat' : 'Model chat')} aria-pressed={agentMode === agents} disabled={disabled} onClick={() => onChange(agents)}>
        <ChatIcon name={icon} />
      </Button></Tooltip>)}
  </div>;
}

export type AgentChatOption = { key: string; name: string; hosted?: boolean; owned_by?: string; tags?: readonly string[] };

export function AgentChatPicker({ options, selected, loading, disabled, onChange }: {
  options: readonly AgentChatOption[]; selected?: string; loading: boolean; disabled: boolean; onChange: (key: string) => void;
}) {
  const { t, i18n } = useAppTranslation();
  const { compare } = new Intl.Collator(i18n.resolvedLanguage, { sensitivity: 'base' });
  const metadata = new Map<string, SelectOption[]>();
  const central: SelectOption[] = [];
  const local: SelectOption[] = [];
  const centralGroup = { id: 'location:central', label: t('Central') };
  const localGroup = { id: 'location:local', label: t('Local') };
  for (const { key: value, name: label, hosted, owned_by, tags } of [...options].sort((a, b) => compare(a.name, b.name))) {
    const owner = owned_by?.trim();
    const groups = owner ? [owner] : [...new Set(tags?.map(tag => tag.trim()).filter(Boolean))];
    if (!groups.length) {
      (hosted ? central : local).push({ value, label, group: hosted ? centralGroup : localGroup });
    }
    for (const name of groups) {
      const row = { value, label, group: { id: `metadata:${name}`, label: name } };
      const group = metadata.get(name);
      if (group) group.push(row);
      else metadata.set(name, [row]);
    }
  }
  return <Select label={t('Agent')} disabled={disabled || !options.length} value={selected ?? ''} onValueChange={onChange}
    placeholder={t(options.length ? 'Select an agent' : loading ? 'Loading agents…' : 'No agent available')}
    search={{ label: t('Search agents'), placeholder: t('Search agents…'), emptyMessage: t('No matching agents.') }}
    options={[...[...metadata].sort(([a], [b]) => compare(a, b)).flatMap(([, rows]) => rows), ...central, ...local]} />;
}
