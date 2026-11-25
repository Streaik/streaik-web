import { Button, ColorModeSettings, ThemeSettings, Tooltip } from '@streaik/themes';
import type { IconName } from '@streaik/themes';
import { useId, useState } from 'react';
import type { ReactNode, RefObject } from 'react';
import { useAgents } from './AgentsProvider';
import { AgentSettings } from './AgentSettings';
import { ChatIcon } from './ChatIcon';
import type { ChatPreferences, ToolOutputPreferences } from './chatPreferences';
import { languages, useAppTranslation } from './i18n';

type SettingsTab = { id: string; label: string; icon: IconName; content: ReactNode };
const toolOutputLabels = { text: 'Text', links: 'Links', images: 'Images', audio: 'Audio', video: 'Video', documents: 'Documents' } as const;

function SettingSwitch({ label, checked, onChange }: { label: string; checked: boolean; onChange: (value: boolean) => void }) {
  return <label><input type="checkbox" role="switch" checked={checked} onChange={event => onChange(event.currentTarget.checked)} />
    <span>{label}</span></label>;
}

export function SettingsDialog({ dialog, apiKeySettings, accountSettings, preferences, onPreferences }: {
  dialog: RefObject<HTMLDialogElement | null>;
  apiKeySettings?: ReactNode;
  accountSettings?: ReactNode;
  preferences: ChatPreferences;
  onPreferences: (value: ChatPreferences) => void;
}) {
  const { t, i18n } = useAppTranslation();
  const id = useId();
  const agents = useAgents();
  const [selected, setSelected] = useState('general');
  const tabs: SettingsTab[] = [{ id: 'general', label: t('General'), icon: 'settings', content:
    <div className="chat-settings-section">
      <h3>{t('General')}</h3>
      <div className="appearance-row"><label htmlFor={`${id}-language`}>{t('Language')}</label>
        <select id={`${id}-language`} value={i18n.resolvedLanguage ?? 'en'} onChange={(event) => { void i18n.changeLanguage(event.currentTarget.value); }}>
          {Object.entries(languages).map(([code, name]) => <option key={code} value={code} lang={code}>{name}</option>)}
        </select>
      </div>
      <ColorModeSettings translate={t} />
    </div>,
  }, { id: 'theme', label: t('Theme'), icon: 'palette', content:
    <div className="chat-settings-section">
      <h3>{t('Theme')}</h3>
      <ThemeSettings translate={t} themeText={(theme, action) => t(action === 'reset' ? 'Reset {{theme}} settings' : '{{theme}} settings', { theme })} />
    </div>,
  }];
  if (apiKeySettings) tabs.push({ id: 'api-keys', label: t('API keys'), icon: 'key', content: apiKeySettings });
  if (accountSettings) tabs.push({ id: 'account', label: t('Account'), icon: 'user', content: accountSettings });
  function preference(key: 'dictate' | 'showContextSize' | 'showMessageTokens' | 'showProviderLogo' | 'showMetrics' | 'convertAttachmentsToText', label: string) {
    return <SettingSwitch label={t(label)} checked={preferences[key]} onChange={value => onPreferences({ ...preferences, [key]: value })} />;
  }
  tabs.push({ id: 'chat', label: t('Chat'), icon: 'agents', content:
    <div className="chat-preference-cards">
      <section className="chat-tool-card" aria-labelledby={`${id}-input`}>
        <h3 id={`${id}-input`}>{t('Input')}</h3>
        <div className="chat-tool-switches">
          {preference('dictate', 'Dictate')}
          {preference('showContextSize', 'Show context size')}
        </div>
      </section>
      <section className="chat-tool-card" aria-labelledby={`${id}-output`}>
        <h3 id={`${id}-output`}>{t('Output')}</h3>
        <div className="chat-tool-switches">
          {preference('showMessageTokens', 'Show tokens per message')}
          {preference('showProviderLogo', 'Show provider logo')}
          {preference('showMetrics', 'Show metrics')}
        </div>
      </section>
      <section className="chat-tool-card" aria-labelledby={`${id}-tool-output`}>
        <h3 id={`${id}-tool-output`}>{t('Tool output')}</h3>
        <div className="chat-tool-switches">
          {(Object.keys(toolOutputLabels) as (keyof ToolOutputPreferences)[]).map(key =>
            <SettingSwitch key={key} label={t(toolOutputLabels[key])} checked={preferences.toolOutput[key]}
              onChange={value => onPreferences({ ...preferences, toolOutput: { ...preferences.toolOutput, [key]: value } })} />)}
        </div>
      </section>
    </div>,
  });
  if (agents?.config.roles?.length) tabs.push({ id: 'agents', label: t('Agents'), icon: 'agents', content: <AgentSettings /> });
  tabs.push({ id: 'attachments', label: t('Attachments'), icon: 'attachment', content:
    <div className="chat-tool-switches">{preference('convertAttachmentsToText', 'Convert files to text')}</div>,
  });
  const active = tabs.some((tab) => tab.id === selected) ? selected : 'general';

  return <dialog ref={dialog} className="chat-settings chat-settings-dialog" aria-labelledby={`${id}-title`}
    onClose={() => setSelected('general')}>
    <div className="chat-settings-header">
      <h2 id={`${id}-title`}>{t('Settings')}</h2>
      <Button className="chat-close" variant="subtle" aria-label={t('Close')} title={t('Close')} onClick={() => dialog.current?.close()}><ChatIcon name="close" /></Button>
    </div>
    <div className="chat-settings-layout">
      <div className="chat-settings-tabs" role="tablist" aria-label={t('Settings sections')} aria-orientation="vertical">
        {tabs.map((tab, index) => <Tooltip key={tab.id} content={tab.label}><button type="button" role="tab" id={`${id}-tab-${tab.id}`}
          aria-label={tab.label} aria-selected={tab.id === active} aria-controls={`${id}-panel-${tab.id}`}
          tabIndex={tab.id === active ? 0 : -1} onClick={() => setSelected(tab.id)} onKeyDown={(event) => {
            let next: number;
            switch (event.key) {
              case 'ArrowDown': next = (index + 1) % tabs.length; break;
              case 'ArrowUp': next = (index - 1 + tabs.length) % tabs.length; break;
              case 'Home': next = 0; break;
              case 'End': next = tabs.length - 1; break;
              default: return;
            }
            event.preventDefault();
            setSelected(tabs[next].id);
            event.currentTarget.closest('[role="tablist"]')?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]?.focus();
          }}>
          <ChatIcon name={tab.icon} /><span>{tab.label}</span>
          </button></Tooltip>)}
      </div>
      {tabs.map((tab) => <div key={tab.id} className="chat-settings-panel" role="tabpanel" id={`${id}-panel-${tab.id}`}
        aria-labelledby={`${id}-tab-${tab.id}`} hidden={tab.id !== active} tabIndex={0}>
        {tab.id === active && tab.content}
      </div>)}
    </div>
  </dialog>;
}
