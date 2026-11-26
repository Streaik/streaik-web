import { Button, Select } from '@streaik/themes';
import type { ChatModel } from '@streaik/gateway';
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { RefObject } from 'react';
import { ChatIcon } from './ChatIcon';
import { DialogTabs } from './DialogTabs';
import { ToolDetails, ToolValue } from './ToolDetails';
import { describeToolOutput } from './toolOutputContent';
import { composerToolDefaults, toolConfigurationDefaults } from './chatPreferences';
import type { ChatPreferences } from './chatPreferences';
import { normalizeToolPolicy, toolPolicyForTurn } from './chatToolPolicy';
import type { ChatToolPolicy } from './chatToolPolicy';
import type { RequestContext } from './chatContext';
import { localPlugins } from './localPlugins';
import type { ChatTool } from './localPlugins';
import { useAppTranslation } from './i18n';
import { defaultSkillVersion } from './skillBundles';
import type { LocalSkills } from './useLocalSkills';
import type { RemoteSkills } from './useRemoteSkills';
import { activeChatProviders, chatProviders, normalizeProviderChatSettings } from './providerChat/settings';
import type { ChatProviderId, ProviderChatSettings } from './providerChat/settings';
import { ProviderChatForm } from './providerChat/forms';
import { ToolConfigurationEditor } from './ToolConfigurationEditor';
import type { ToolConfigurationRow } from './ToolConfigurationEditor';

type DialogRef = RefObject<HTMLDialogElement | null>;
type ChatSettingsTab = 'general' | 'tools' | 'tool-configuration' | 'skills' | ChatProviderId;

function ToolPolicyFields({ value, onChange, rows, disabled }: {
  value: ChatToolPolicy; onChange: (policy: ChatToolPolicy) => void; rows: readonly ToolConfigurationRow[]; disabled: boolean;
}) {
  const { t } = useAppTranslation();
  const id = useId();
  const active = new Map(rows.map(({ key, label }) => [key, label]));
  const effective = toolPolicyForTurn(value, new Set(active.keys()));
  const canRequire = effective.maxToolCalls !== undefined || effective.stopTools.length > 0;
  const update = (patch: Partial<ChatToolPolicy>) => onChange(normalizeToolPolicy({ ...value, ...patch }));
  const options = [...active].map(([value, label]) => ({ value, label })).sort((a, b) => a.label.localeCompare(b.label));
  for (const name of value.stopTools) {
    if (!active.has(name)) options.push({ value: name, label: t('{{tool}} (unavailable)', { tool: name }) });
  }
  return <section className="chat-tool-card">
    <h3>{t('Tools')}</h3>
    <div className="chat-tool-policy-fields">
      <div className="chat-tool-policy-field">
        <label htmlFor={`${id}-choice`}>{t('Tool choice')}</label>
        <Select id={`${id}-choice`} label={t('Tool choice')} value={effective.toolChoice ?? 'auto'} disabled={disabled}
          options={[{ value: 'auto', label: t('Automatic') }, { value: 'none', label: t('None') },
            ...(canRequire ? [{ value: 'required', label: t('Required') }] : [])]}
          onValueChange={toolChoice => update({ toolChoice: toolChoice === 'none' || toolChoice === 'required' ? toolChoice : undefined })} />
      </div>
      <label className="chat-tool-policy-field"><span>{t('Maximum tool calls')}</span>
        <input type="number" min={1} step={1} value={value.maxToolCalls ?? ''} placeholder={t('Unlimited')} disabled={disabled}
          onChange={event => update({ maxToolCalls: event.currentTarget.valueAsNumber })} />
      </label>
    </div>
    <div className="chat-tool-policy-field">
      <label htmlFor={`${id}-stop`}>{t('Tools that end the turn')}</label>
      <Select multiple id={`${id}-stop`} label={t('Tools that end the turn')} value={value.stopTools} options={options}
        disabled={disabled || !options.length} placeholder={t(options.length ? 'Select tools' : 'No tools enabled.')}
        search={{ label: t('Search tools'), placeholder: t('Search tools'), emptyMessage: t('No matching tools.') }}
        onValueChange={stopTools => update({ stopTools })} />
    </div>
  </section>;
}

export function ChatSettingsDialog({ dialog, value, onChange, gateway, browserToolsSupported, hasHistory, locked, localSkills, remoteSkills, providerModels, toolRows, namespaceSupported, toolOptionsSupported }: {
  dialog: DialogRef; value: ChatPreferences; onChange: (preferences: ChatPreferences) => void;
  gateway: boolean; browserToolsSupported: boolean; hasHistory: boolean; locked: boolean; localSkills: LocalSkills; remoteSkills: RemoteSkills;
  providerModels: readonly ChatModel[];
  toolRows: readonly ToolConfigurationRow[]; namespaceSupported: boolean; toolOptionsSupported: boolean;
}) {
  const { t } = useAppTranslation();
  const id = useId();
  const [requestedTab, setTab] = useState<ChatSettingsTab>('general');
  const [draft, setDraft] = useState<ProviderChatSettings>();
  const [resetKey, setResetKey] = useState(0);
  const providers = activeChatProviders(providerModels);
  const tabs: [ChatSettingsTab, string][] = [['general', t('General')], ['tools', t('Tools')],
    ['tool-configuration', t('Tool configuration')], ['skills', t('Skills')],
    ...[...providers.keys()].map((provider): [ChatProviderId, string] => [provider, chatProviders[provider].label])];
  const tab = tabs.some(([key]) => key === requestedTab) ? requestedTab : 'general';
  const providerTab = tab !== 'general' && tab !== 'tools' && tab !== 'skills' && tab !== 'tool-configuration' ? tab : undefined;
  const providerSettings = draft ?? value.providerSettings;
  const { online, needsLoad, load, cursor, busy, error, skills } = remoteSkills;
  useEffect(() => {
    if (tab === 'skills' && dialog.current?.open && gateway && online && !busy && error === undefined && (needsLoad || cursor)) load(cursor);
  }, [tab, dialog, gateway, online, busy, error, needsLoad, cursor, load]);
  return <dialog ref={dialog} className="chat-settings chat-tools-dialog" aria-labelledby={`${id}-title`} onClose={() => {
    setTab('general'); setDraft(undefined);
  }}>
    <header className="chat-settings-header">
      <h2 id={`${id}-title`}>{t('Chat settings')}</h2>
      <Button className="chat-close" variant="subtle" aria-label={t('Close chat settings')} onClick={() => dialog.current?.close()}><ChatIcon name="close" /></Button>
    </header>
    <DialogTabs id={id} label={t('Chat settings sections')} tabs={tabs} value={tab} onChange={setTab} />
    <div id={`${id}-general-panel`} role="tabpanel" aria-labelledby={`${id}-general-tab`} hidden={tab !== 'general'}>
      <div className="chat-preference-cards">
        <section className="chat-tool-card">
          <h3>{t('Chat')}</h3>
          <label htmlFor={`${id}-delay`}>{t('Delay ({{delay, number}} ms)', { delay: value.delay })}</label>
          <input id={`${id}-delay`} type="range" min={0} max={1000} step={10} value={value.delay}
            onChange={event => onChange({ ...value, delay: event.currentTarget.valueAsNumber })} />
        </section>
        {browserToolsSupported && <ToolPolicyFields value={value.toolPolicy} rows={toolRows} disabled={locked}
          onChange={toolPolicy => onChange({ ...value, toolPolicy })} />}
      </div>
    </div>
    <div id={`${id}-tools-panel`} role="tabpanel" aria-labelledby={`${id}-tools-tab`} hidden={tab !== 'tools'}>
      <section className="chat-tool-card">
        <h3>{t('Local')}</h3>
        <div className="chat-tool-switches">
          {localPlugins.map(plugin => <label key={plugin.id}>
            <input type="checkbox" role="switch" checked={value.plugins.includes(plugin.id)}
              disabled={locked || !browserToolsSupported || (plugin.requiresHistory && !hasHistory)}
              onChange={event => onChange({ ...value, plugins: event.currentTarget.checked ? [...value.plugins, plugin.id]
                : value.plugins.filter(id => id !== plugin.id) })} />
            <span>{t(plugin.label)}</span>
          </label>)}
        </div>
        {browserToolsSupported && !hasHistory && <p>{t('Chat History requires a local history profile.')}</p>}
      </section>
    </div>
    <div id={`${id}-tool-configuration-panel`} role="tabpanel" aria-labelledby={`${id}-tool-configuration-tab`} hidden={tab !== 'tool-configuration'}>
      {tab === 'tool-configuration' && <>
        {!toolOptionsSupported && <p>{t('This route does not send tool usage or search options.')}</p>}
        <ToolConfigurationEditor rows={toolRows} disabled={locked} namespaces={{ checked: value.useToolNamespaces, disabled: !namespaceSupported,
          onChange: useToolNamespaces => onChange({ ...value, useToolNamespaces }) }} onChange={(keys, patch) => {
          const toolRequestConfig = { ...value.toolRequestConfig, ...Object.fromEntries(keys.map(key =>
            [key, { ...(Object.hasOwn(value.toolRequestConfig, key) && value.toolRequestConfig[key]), ...patch }])) };
          onChange({ ...value, toolRequestConfig });
        }} />
      </>}
    </div>
    <div id={`${id}-skills-panel`} className="chat-skill-cards" role="tabpanel" aria-labelledby={`${id}-skills-tab`} hidden={tab !== 'skills'}>
      <section className="chat-tool-card" aria-labelledby={`${id}-local-skills`}>
        <h3 id={`${id}-local-skills`}>{t('Local')}</h3>
        {!gateway && <p>{t('Skills are available only on Gateway routes.')}</p>}
        {!localSkills.ready ? <p role="status">{t('Loading local skills…')}</p> : !localSkills.skills.length
          ? <p>{t('No local skills yet.')}</p> : <div className="chat-tool-switches">
            {localSkills.skills.map(skill => <label key={skill.id}>
              <input type="checkbox" role="switch" checked={skill.enabled} disabled={locked || !gateway}
                onChange={event => {
                  const enabled = event.currentTarget.checked;
                  localSkills.update(items => items.map(item => item.id === skill.id ? { ...item, enabled } : item));
                }} />
              <span>{defaultSkillVersion(skill).metadata.name}</span>
            </label>)}
          </div>}
        {localSkills.notice && <p role="status">{t(localSkills.notice)}</p>}
      </section>
      <section className="chat-tool-card" aria-labelledby={`${id}-remote-skills`}>
        <h3 id={`${id}-remote-skills`}>{t('Central')}</h3>
        {gateway && !online && <p>{t('Connect to a gateway to browse provider skills.')}</p>}
        {gateway && online && <>
          {skills.length > 0 && <div className="chat-tool-switches">
            {skills.map(skill => <label key={skill.id} title={skill.id}>
              <input type="checkbox" role="switch" checked={value.remoteSkillIds.includes(skill.id)} disabled={locked}
                onChange={event => onChange({ ...value, remoteSkillIds: event.currentTarget.checked ? [...value.remoteSkillIds, skill.id]
                  : value.remoteSkillIds.filter(id => id !== skill.id) })} />
              <span>{skill.name}</span>
            </label>)}
          </div>}
          {error !== undefined ? <>
            <p role="alert">{t(error || 'Could not load provider skills.')}</p>
            <div><Button onClick={() => load(cursor)}>{t('Retry')}</Button></div>
          </> : (busy || needsLoad || cursor) ? <p role="status">{t('Loading provider skills…')}</p>
            : !skills.length && <p role="status">{t('No provider skills found.')}</p>}
        </>}
        {!gateway && <p>{t('Skills are available only on Gateway routes.')}</p>}
      </section>
    </div>
    {[...providers].map(([provider, models]) => <div key={provider} id={`${id}-${provider}-panel`}
      role="tabpanel" aria-labelledby={`${id}-${provider}-tab`} hidden={tab !== provider}>
      {tab === provider && <fieldset className="chat-provider-fields" disabled={locked} aria-label={chatProviders[provider].label}>
        <ProviderChatForm key={resetKey} provider={provider} value={providerSettings[provider] ?? {}} models={models}
          onChange={next => setDraft(current => ({ ...(current ?? value.providerSettings), [provider]: next }))} />
      </fieldset>}
    </div>)}
    <footer className="chat-tool-footer">
      <Button variant="subtle" disabled={locked} onClick={() => {
        if (providerTab) {
          setDraft(current => ({ ...(current ?? value.providerSettings), [providerTab]: undefined }));
          setResetKey(key => key + 1);
        } else onChange({ ...value, ...(tab === 'tool-configuration' ? toolConfigurationDefaults : composerToolDefaults) });
      }}>{t(providerTab ? 'Reset provider settings' : 'Defaults')}</Button>
      <Button variant={draft ? 'subtle' : undefined} onClick={() => dialog.current?.close()}>{t(draft ? 'Cancel' : 'Close')}</Button>
      {(providerTab || draft) && <Button disabled={locked || !draft || !providers.size} onClick={() => {
        onChange({ ...value, providerSettings: normalizeProviderChatSettings(draft) });
        dialog.current?.close();
      }}>{t('Save')}</Button>}
    </footer>
  </dialog>;
}

function ToolSchema({ title, value }: { title: string; value: unknown }) {
  const [open, setOpen] = useState(false);
  return <details onToggle={event => setOpen(event.currentTarget.open)}><summary>{title}</summary>{open && <ToolValue value={value} />}</details>;
}

export function ViewContextDialog({ context, tools, onClose }: { context?: RequestContext; tools: readonly ChatTool[]; onClose: () => void }) {
  const { t } = useAppTranslation();
  const id = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const [tab, setTab] = useState<'system' | 'user' | 'tools' | 'skills'>('system');
  const skills = context?.skills?.skills ?? [];
  if (tab === 'skills' && !skills.length) setTab('system');
  useLayoutEffect(() => { dialog.current?.showModal(); }, []);
  return <dialog ref={dialog} className="chat-settings chat-tools-dialog" aria-labelledby={`${id}-title`} onClose={onClose}>
    <header className="chat-settings-header">
      <h2 id={`${id}-title`}>{t('Context')}</h2>
      <Button className="chat-close" variant="subtle" aria-label={t('Close')} onClick={() => dialog.current?.close()}><ChatIcon name="close" /></Button>
    </header>
    <DialogTabs id={id} label={t('Context sections')} tabs={[[ 'system', t('System') ], [ 'user', t('User') ],
      [ 'tools', t('Tools ({{count, number}})', { count: tools.length }) ], ...(skills.length ? [[ 'skills', t('Skills') ] as const] : [])]}
      value={tab} onChange={setTab} />
    {(['system', 'user'] as const).map(key => <div key={key} id={`${id}-${key}-panel`} role="tabpanel" tabIndex={0}
      aria-labelledby={`${id}-${key}-tab`} hidden={tab !== key}>
      {tab === key && context?.[key] && <section className="chat-tool-card"><h3>{t(key === 'system' ? 'System context' : 'User context')}</h3>
        <ToolValue value={context[key]} /></section>}
      {key === 'system' && tab === key && context?.chatInstructions && <section className="chat-tool-card">
        <h3>{t('Instructions')}</h3><ToolValue value={context.chatInstructions} /></section>}
      {key === 'system' && tab === key && context?.mcp && <section className="chat-tool-card"><h3>{t('MCP resource catalog')}</h3><ToolValue value={context.mcp} /></section>}
      {!context?.[key] && !(key === 'system' && (context?.mcp || context?.chatInstructions)) && <p>{t(context ? 'No additional context.' : 'No extra context is sent on Direct routes.')}</p>}
    </div>)}
    <div id={`${id}-tools-panel`} role="tabpanel" tabIndex={0} aria-labelledby={`${id}-tools-tab`} hidden={tab !== 'tools'}>
      {tab === 'tools' && (tools.length ? <div className="chat-tool-list">{tools.map(item => {
        const remote = item.source === 'mcp' ? item.tool : undefined;
        const labels = item.source === 'local' ? [t(item.plugin.label)] : item.source === 'skill' ? [t('Skills')] : remote ? [remote.server.title] : [t('MCP'), t('Read-only')];
        if (remote?.annotations?.readOnlyHint) labels.push(t('Read-only'));
        if (remote?.annotations?.idempotentHint) labels.push(t('Idempotent'));
        if (remote?.annotations?.destructiveHint) labels.push(t('Destructive'));
        if (remote?.annotations?.openWorldHint) labels.push(t('Open world'));
        return <section key={item.definition.name} className="chat-tool-card">
          <h3>{remote?.title || remote?.annotations?.title || remote?.remoteName || item.definition.name}</h3>
          {(remote?.title || remote?.remoteName) && <code>{item.definition.name}</code>}
          <div className="chat-tool-badges">{labels.map((label, index) => <span key={index} className="chat-tool-badge">{label}</span>)}</div>
          {item.definition.description && <p>{item.definition.description}</p>}
          <ToolSchema title={t('Input schema')} value={item.definition.inputSchema} />
          {remote?.outputSchema && <ToolSchema title={t('Output schema')} value={remote.outputSchema} />}
        </section>;
      })}</div> : <p>{t('No tools enabled.')}</p>)}
    </div>
    {skills.length > 0 && <div id={`${id}-skills-panel`} className="chat-skill-cards" role="tabpanel" tabIndex={0}
      aria-labelledby={`${id}-skills-tab`} hidden={tab !== 'skills'}>
      {skills.map(({ skill_id, name, description }) => <article key={skill_id} className="chat-tool-card chat-context-skill-card">
        <h3>{name}</h3>
        <code>{skill_id}</code>
        <p>{description}</p>
      </article>)}
    </div>}
  </dialog>;
}

export type ToolReview = { id: string; name: string; input: unknown; disabled?: boolean } & (
  { kind: 'result'; output: unknown } | { kind: 'execution' });

export function ToolApprovalDialog({ review, onAnswer, onStop }: {
  review: ToolReview; onAnswer: (approved: boolean) => void; onStop: () => void;
}) {
  const { t } = useAppTranslation();
  const id = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const output = review.kind === 'result' ? review.output : undefined;
  const result = useMemo(() => describeToolOutput(output), [output]);
  useLayoutEffect(() => {
    const node = dialog.current;
    if (node && !node.open) node.showModal();
    return () => node?.close();
  }, []);
  return <dialog ref={dialog} className="chat-settings chat-tools-dialog chat-approval-dialog" aria-labelledby={`${id}-title`}
    onCancel={event => { event.preventDefault(); if (!review.disabled) onAnswer(false); }}>
    <header className="chat-settings-header">
      <h2 id={`${id}-title`}>{t(review.kind === 'result' ? 'Review tool result' : 'Approve tool execution')}</h2>
    </header>
    <div className="chat-approval-name"><ChatIcon name="tool" /><strong>{review.name}</strong></div>
    <ToolDetails input={review.input} result={result} mode={review.kind} />
    <footer className="chat-tool-footer">
      <Button type="button" variant="subtle" onClick={onStop}>{t('Stop')}</Button>
      <Button type="button" disabled={review.disabled} onClick={() => onAnswer(false)}>{t('Decline')}</Button>
      <Button type="button" variant="primary" disabled={review.disabled} onClick={() => onAnswer(true)}>
        {t(review.kind === 'result' ? 'Approve and share' : 'Approve and run')}
      </Button>
    </footer>
  </dialog>;
}
