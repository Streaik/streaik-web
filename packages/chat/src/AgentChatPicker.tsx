import { Button, Select, Tooltip } from '@streaik/themes';
import { ChatIcon } from './ChatIcon';
import { useAppTranslation } from './i18n';

export function ChatModeButtons({ agentMode, disabled, onChange }: {
  agentMode: boolean; disabled: boolean; onChange: (agents: boolean) => void;
}) {
  const { t } = useAppTranslation();
  return <div className="chat-mode-buttons" role="group" aria-label={t('Chat mode')}>
    {([{ agents: false, label: 'Chat', icon: 'brain' }, { agents: true, label: 'Agents', icon: 'agents' }] as const).map(({ agents, label, icon }) =>
      <Tooltip key={label} content={t(label)}><Button type="button" className="chat-mode-button" variant="subtle"
        aria-label={t(label)} aria-pressed={agentMode === agents} disabled={disabled} onClick={() => onChange(agents)}>
        <ChatIcon name={icon} />
      </Button></Tooltip>)}
  </div>;
}

export type AgentChatOption = { key: string; name: string; hosted?: boolean };

export function AgentChatPicker({ options, selected, loading, disabled, onChange }: {
  options: readonly AgentChatOption[]; selected?: string; loading: boolean; disabled: boolean; onChange: (key: string) => void;
}) {
  const { t } = useAppTranslation();
  return <Select label={t('Agent')} disabled={disabled || !options.length} value={selected ?? ''} onValueChange={onChange}
    placeholder={t(options.length ? 'Select an agent' : loading ? 'Loading agents…' : 'No agent available')}
    search={{ label: t('Search agents'), placeholder: t('Search agents…'), emptyMessage: t('No matching agents.') }}
    options={options.map(({ key, name, hosted }) => ({ value: key, label: name,
      group: { id: hosted ? 'hosted' : 'browser', label: t(hosted ? 'Hosted agents' : 'Browser agents') } }))} />;
}
