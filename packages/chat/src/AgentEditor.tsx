import { Button } from '@streaik/themes';
import type { CatalogModel, Gateway } from '@streaik/gateway';
import { useId, useLayoutEffect, useRef, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import type { AgentEntry } from './agentCatalog';
import { AgentDraftError, createAgentDraft, saveAgentDraft } from './agentDraft';
import type { AgentDraft, AgentTab } from './agentDraft';
import type { AgentDefinition } from './agentDefinition';
import { AgentDetailsFields, AgentGeneralFields, AgentRealtimeFields } from './AgentEditorFields';
import { AgentProviderFields, agentProviderGroups } from './AgentProviderFields';
import { AgentSkillFields } from './AgentSkillFields';
import { SkillExecutionField } from './SkillExecutionField';
import { agentSkillsTool, patchAgentSkills } from './agentTools';
import { withAgentProviderOptions } from './agentProviderSettings';
import { ChatIcon } from './ChatIcon';
import { useAppTranslation } from './i18n';
import { chatProviders } from './providerChat/settings';
import type { ChatProviderId, NativeOptions } from './providerChat/settings';

import { AgentToolConfigurationFields, AgentToolsFields } from './AgentToolFields';
import { useMcpSelection } from './useMcpServers';
import type { McpServers } from './useMcpServers';
import type { LocalSkills } from './useLocalSkills';
import type { RemoteSkills } from './useRemoteSkills';

const baseTabs = [['general', 'General'], ['details', 'Details'], ['realtime', 'Realtime'], ['skills', 'Skills'], ['tools', 'Tools'],
  ['tool-configuration', 'Tool configuration']] as const;
type EditorTab = AgentTab | `provider-${ChatProviderId}`;

function AgentDialog({ title, children, onClose }: { title: string; children: (close: () => void) => ReactNode; onClose: () => void }) {
  const { t } = useAppTranslation();
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useLayoutEffect(() => {
    const element = dialog.current;
    if (element && !element.open) element.showModal();
  }, []);
  return <dialog ref={dialog} aria-labelledby={titleId} onClose={onClose} className="chat-settings agent-dialog">
    <div className="chat-settings-header"><h2 id={titleId}>{title}</h2>
      <Button className="chat-close" aria-label={t('Close')} title={t('Close')} variant="subtle" onClick={() => dialog.current?.close()}><ChatIcon name="close" /></Button>
    </div>
    {children(() => dialog.current?.close())}
  </dialog>;
}

export function AgentEditor({ entry, seed, catalog, catalogStatus, tags, mcpServers, localSkills, remoteSkills, gateway, onSave, onClose }: {
  entry?: AgentEntry; seed?: AgentDefinition; catalog: readonly CatalogModel[]; catalogStatus?: string; tags: readonly string[];
  mcpServers: McpServers; localSkills: LocalSkills; remoteSkills: RemoteSkills; gateway: Gateway;
  onSave: (definition: AgentDefinition, entry?: AgentEntry) => void; onClose: () => void;
}) {
  const { t } = useAppTranslation();
  const source = entry?.definition ?? seed;
  const [initial] = useState(() => createAgentDraft(source));
  const [draft, setDraft] = useState(initial);
  const skills = agentSkillsTool(draft.tools);
  const [skillBusy, setSkillBusy] = useState(false);
  const discovery = useMcpSelection(mcpServers);
  const [requestedTab, setTab] = useState<EditorTab>('general');
  const [error, setError] = useState<Error>();
  const providers = agentProviderGroups(draft.models, catalog);
  const providerTabs = Array.from(providers, ([provider, entries]) => ({ provider, entries, key: `provider-${provider}` as const }));
  const tabs = [...baseTabs, ...providerTabs.map(({ key, provider }) => [key, chatProviders[provider].label] as const)];
  const tab = tabs.some(([key]) => key === requestedTab) ? requestedTab : 'general';
  const id = useId();
  const panels = useRef<HTMLDivElement>(null);
  const alert = useRef<HTMLParagraphElement>(null);
  useLayoutEffect(() => { if (panels.current) panels.current.scrollTop = 0; }, [tab]);
  useLayoutEffect(() => { if (error) alert.current?.focus(); }, [error]);

  function patch(fields: Partial<AgentDraft>) {
    setDraft((old) => ({ ...old, ...fields }));
    setError(undefined);
  }

  function patchModel(index: number, options: NativeOptions) {
    setDraft(old => ({ ...old, models: old.models.map((model, i) => i === index ? withAgentProviderOptions(model, options) : model) }));
    setError(undefined);
  }

  function save(event: FormEvent<HTMLFormElement>, close: () => void) {
    event.preventDefault();
    if (skillBusy) return;
    try {
      onSave(saveAgentDraft(draft, source), entry);
      close();
    } catch (error) {
      setTab(error instanceof AgentDraftError ? error.tab : 'general');
      setError(error instanceof Error ? error : new Error('Could not save this agent.'));
    }
  }

  return <AgentDialog title={t(entry ? 'Edit agent' : 'Create agent')} onClose={onClose}>{(close) =>
    <form className="agent-form" noValidate onSubmit={(event) => save(event, close)}>
      <div className="catalog-tabs" role="tablist" aria-label={t('Agent settings')}>
        {tabs.map(([key, label], index) => <button key={key} id={`${id}-${key}-tab`} type="button" role="tab"
          aria-selected={tab === key} aria-controls={`${id}-${key}-panel`} tabIndex={tab === key ? 0 : -1}
          onClick={() => setTab(key)} onKeyDown={(event) => {
            const next = ({ ArrowRight: (index + 1) % tabs.length, ArrowLeft: (index - 1 + tabs.length) % tabs.length,
              Home: 0, End: tabs.length - 1 } as Record<string, number>)[event.key];
            if (typeof next !== 'number') return;
            event.preventDefault();
            const target = tabs[next][0];
            setTab(target);
            event.currentTarget.ownerDocument.getElementById(`${id}-${target}-tab`)?.focus();
          }}>{t(label)}</button>)}
      </div>
      <div className="agent-panels" ref={panels}>
        {baseTabs.map(([key]) => <section key={key} className="agent-panel" id={`${id}-${key}-panel`} role="tabpanel"
          aria-labelledby={`${id}-${key}-tab`} hidden={key !== tab}>
          {key === 'general' ? <AgentGeneralFields {...{ draft, initial, patch, catalog, catalogStatus }} sample={entry?.source === 'sample'} />
            : key === 'details' ? <AgentDetailsFields {...{ draft, patch, tags }} />
              : key === 'realtime' ? <AgentRealtimeFields {...{ draft, initial, patch, catalog, catalogStatus }} />
                : key === 'skills' ? <>
                  <SkillExecutionField value={skills?.execution === 'server' ? 'hosted' : skills?.execution === 'client' ? 'client' : undefined}
                    onChange={mode => patch({ tools: patchAgentSkills(draft.tools, { execution: mode === 'hosted' ? 'server' : mode }) })} />
                  <AgentSkillFields active={tab === 'skills'} skills={skills?.skills}
                    onChange={entries => patch({ tools: patchAgentSkills(draft.tools, { skills: entries ?? [] }) })}
                    onBusyChange={setSkillBusy} local={localSkills} remote={remoteSkills} gateway={gateway} />
                </>
                  : key === 'tools' ? <AgentToolsFields {...{ draft, patch, discovery }} store={mcpServers} />
                    : <AgentToolConfigurationFields {...{ draft, patch, discovery }} store={mcpServers} />}
        </section>)}
        {providerTabs.map(({ key, provider, entries }) => <section key={key} className="agent-panel" id={`${id}-${key}-panel`}
          role="tabpanel" aria-labelledby={`${id}-${key}-tab`} hidden={key !== tab}>
          <AgentProviderFields provider={provider} entries={entries} onChange={patchModel} />
        </section>)}
      </div>
      {error && <p ref={alert} className="chat-error agent-save-error" role="alert" tabIndex={-1}>{t(error.message)}</p>}
      <div className="agent-actions">
        <Button onClick={close}>{t('Cancel')}</Button><Button type="submit" variant="primary" disabled={skillBusy}>{t('Save agent')}</Button>
      </div>
    </form>}
  </AgentDialog>;
}

export function ConfirmAgentChange({ entry, onConfirm, onClose }: { entry: AgentEntry; onConfirm: () => void; onClose: () => void }) {
  const { t } = useAppTranslation();
  const reset = entry.source === 'sample';
  const title = t(reset ? 'Reset to sample default' : 'Delete agent');
  return <AgentDialog title={title} onClose={onClose}>{(close) => <>
    <p>{t(reset ? 'Restore {{name}} to the sample definition? Its role assignments will stay in place.'
      : 'Delete {{name}} from this browser? Any role assignments to it will show as unavailable.', { name: entry.definition.name })}</p>
    <div className="agent-actions"><Button onClick={close}>{t('Cancel')}</Button>
      <Button variant="primary" onClick={() => { onConfirm(); close(); }}>{title}</Button></div>
  </>}</AgentDialog>;
}
