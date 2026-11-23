import { Button } from '@streaik/themes';
import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';
import { ChatIcon } from './ChatIcon';
import { ToolValue } from './ChatActivity';
import { defaultChatPreferences } from './chatPreferences';
import type { ChatPreferences } from './chatPreferences';
import type { RequestContext } from './chatContext';
import { localPlugins } from './localPlugins';
import type { ChatTool } from './localPlugins';
import { useAppTranslation } from './i18n';
import { defaultSkillVersion } from './skillBundles';
import type { LocalSkills } from './useLocalSkills';
import type { RemoteSkills } from './useRemoteSkills';

type DialogRef = RefObject<HTMLDialogElement | null>;

export function DialogTabs<T extends string>({ id, label, tabs, value, onChange }: {
  id: string; label: string; tabs: ReadonlyArray<readonly [T, string]>; value: T; onChange: (tab: T) => void;
}) {
  return <div className="chat-tool-tabs" role="tablist" aria-label={label}>
    {tabs.map(([key, title], index) => <button key={key} id={`${id}-${key}-tab`} type="button" role="tab"
      aria-selected={value === key} aria-controls={`${id}-${key}-panel`} tabIndex={value === key ? 0 : -1}
      onClick={() => onChange(key)} onKeyDown={event => {
        const count = tabs.length;
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? count - 1
          : event.key === 'ArrowRight' ? (index + 1) % count : event.key === 'ArrowLeft' ? (index + count - 1) % count : undefined;
        if (next === undefined) return;
        event.preventDefault();
        const [target] = tabs[next];
        onChange(target);
        document.getElementById(`${id}-${target}-tab`)?.focus();
      }}>{title}</button>)}
  </div>;
}

export function ChatSettingsDialog({ dialog, value, onChange, gateway, hasHistory, locked, localSkills, remoteSkills }: {
  dialog: DialogRef; value: ChatPreferences; onChange: (preferences: ChatPreferences) => void;
  gateway: boolean; hasHistory: boolean; locked: boolean; localSkills: LocalSkills; remoteSkills: RemoteSkills;
}) {
  const { t } = useAppTranslation();
  const id = useId();
  const [tab, setTab] = useState<'general' | 'tools' | 'skills'>('general');
  const { online, needsLoad, load, cursor, busy, error, skills } = remoteSkills;
  useEffect(() => {
    if (tab === 'skills' && dialog.current?.open && gateway && online && !busy && error === undefined && (needsLoad || cursor)) load(cursor);
  }, [tab, dialog, gateway, online, busy, error, needsLoad, cursor, load]);
  return <dialog ref={dialog} className="chat-settings chat-tools-dialog" aria-labelledby={`${id}-title`} onClose={() => setTab('general')}>
    <header className="chat-settings-header">
      <h2 id={`${id}-title`}>{t('Chat settings')}</h2>
      <Button className="chat-close" variant="subtle" aria-label={t('Close chat settings')} onClick={() => dialog.current?.close()}><ChatIcon name="close" /></Button>
    </header>
    <DialogTabs id={id} label={t('Chat settings sections')}
      tabs={[[ 'general', t('General') ], [ 'tools', t('Tools') ], [ 'skills', t('Skills') ]]}
      value={tab} onChange={setTab} />
    <div id={`${id}-general-panel`} role="tabpanel" aria-labelledby={`${id}-general-tab`} hidden={tab !== 'general'}>
      <section className="chat-tool-card">
        <h3>{t('Chat')}</h3>
        <label htmlFor={`${id}-delay`}>{t('Delay ({{delay, number}} ms)', { delay: value.delay })}</label>
        <input id={`${id}-delay`} type="range" min={0} max={1000} step={10} value={value.delay}
          onChange={event => onChange({ ...value, delay: event.currentTarget.valueAsNumber })} />
      </section>
    </div>
    <div id={`${id}-tools-panel`} role="tabpanel" aria-labelledby={`${id}-tools-tab`} hidden={tab !== 'tools'}>
      <section className="chat-tool-card">
        <h3>{t('Local tools')}</h3>
        {!gateway && <p>{t('Local plugins are available only on Gateway routes.')}</p>}
        <div className="chat-tool-switches">
          {localPlugins.map(plugin => <label key={plugin.id}>
            <input type="checkbox" role="switch" checked={value.plugins.includes(plugin.id)}
              disabled={locked || !gateway || (plugin.requiresHistory && !hasHistory)}
              onChange={event => onChange({ ...value, plugins: event.currentTarget.checked ? [...value.plugins, plugin.id]
                : value.plugins.filter(id => id !== plugin.id) })} />
            <span>{t(plugin.label)}</span>
          </label>)}
        </div>
        {gateway && !hasHistory && <p>{t('Chat History requires a local history profile.')}</p>}
      </section>
    </div>
    <div id={`${id}-skills-panel`} className="chat-skill-cards" role="tabpanel" aria-labelledby={`${id}-skills-tab`} hidden={tab !== 'skills'}>
      <section className="chat-tool-card" aria-labelledby={`${id}-local-skills`}>
        <h3 id={`${id}-local-skills`}>{t('Local skills')}</h3>
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
        <h3 id={`${id}-remote-skills`}>{t('Hosted skills')}</h3>
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
    <footer className="chat-tool-footer">
      <Button variant="subtle" disabled={locked} onClick={() => onChange({ ...defaultChatPreferences,
        convertAttachmentsToText: value.convertAttachmentsToText, pinnedViews: value.pinnedViews })}>{t('Defaults')}</Button>
      <Button onClick={() => dialog.current?.close()}>{t('Close')}</Button>
    </footer>
  </dialog>;
}

export function ViewContextDialog({ dialog, context, tools }: { dialog: DialogRef; context?: RequestContext; tools: readonly ChatTool[] }) {
  const { t } = useAppTranslation();
  const id = useId();
  const [tab, setTab] = useState<'system' | 'user' | 'tools'>('system');
  return <dialog ref={dialog} className="chat-settings chat-tools-dialog" aria-labelledby={`${id}-title`} onClose={() => setTab('system')}>
    <header className="chat-settings-header">
      <h2 id={`${id}-title`}>{t('View context')}</h2>
      <Button className="chat-close" variant="subtle" aria-label={t('Close')} onClick={() => dialog.current?.close()}><ChatIcon name="close" /></Button>
    </header>
    <DialogTabs id={id} label={t('Context sections')} tabs={[[ 'system', t('System') ], [ 'user', t('User') ],
      [ 'tools', t('Tools ({{count, number}})', { count: tools.length }) ]]} value={tab} onChange={setTab} />
    {(['system', 'user'] as const).map(key => <div key={key} id={`${id}-${key}-panel`} role="tabpanel" tabIndex={0}
      aria-labelledby={`${id}-${key}-tab`} hidden={tab !== key}>
      {context ? <section className="chat-tool-card"><h3>{t(key === 'system' ? 'System context' : 'User context')}</h3>
        <ToolValue value={context[key]} /></section> : <p>{t('No extra context is sent on Direct routes.')}</p>}
      {key === 'system' && context?.skills && <section className="chat-tool-card">
        <h3>{t('Available skills')}</h3><ToolValue value={context.skills} />
      </section>}
    </div>)}
    <div id={`${id}-tools-panel`} role="tabpanel" tabIndex={0} aria-labelledby={`${id}-tools-tab`} hidden={tab !== 'tools'}>
      {tools.length ? <div className="chat-tool-list">{tools.map(item => {
        const remote = item.source === 'mcp' ? item.tool : undefined;
        const labels = item.source === 'local' ? [t(item.plugin.label)] : item.source === 'skill' ? [t('Skills')] : [item.tool.server.title];
        if (remote?.annotations?.readOnlyHint) labels.push(t('Read-only'));
        if (remote?.annotations?.idempotentHint) labels.push(t('Idempotent'));
        if (remote?.annotations?.destructiveHint) labels.push(t('Destructive'));
        if (remote?.annotations?.openWorldHint) labels.push(t('Open world'));
        return <section key={item.definition.name} className="chat-tool-card">
          <h3>{remote?.title || remote?.annotations?.title || remote?.remoteName || item.definition.name}</h3>
          {(remote?.title || remote?.remoteName) && <code>{item.definition.name}</code>}
          <div className="chat-tool-badges">{labels.map((label, index) => <span key={index} className="chat-tool-badge">{label}</span>)}</div>
          {item.definition.description && <p>{item.definition.description}</p>}
          <details><summary>{t('Input schema')}</summary><ToolValue value={item.definition.inputSchema} /></details>
          {remote?.outputSchema && <details><summary>{t('Output schema')}</summary><ToolValue value={remote.outputSchema} /></details>}
        </section>;
      })}</div> : <p>{t('No tools enabled.')}</p>}
    </div>
  </dialog>;
}

export type ToolReview = { id: string; name: string; input: unknown; disabled?: boolean } & (
  { kind: 'result'; output: unknown; images?: string[] } | { kind: 'execution'; destination?: { server: string; host: string } });

export function ToolApprovalDialog({ review, onAnswer, onStop }: {
  review: ToolReview; onAnswer: (approved: boolean) => void; onStop: () => void;
}) {
  const { t } = useAppTranslation();
  const id = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const [tab, setTab] = useState<'input' | 'output'>(review.kind === 'result' ? 'output' : 'input');
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
    {review.kind === 'execution' && review.destination && <p className="chat-approval-destination">
      {t('Arguments go to {{server}} on {{host}}. The result is sent back to the chat model.', review.destination)}
    </p>}
    <DialogTabs id={id} label={t('Tool details')} tabs={review.kind === 'result' ? [[ 'input', t('Input') ], [ 'output', t('Output') ]]
      : [[ 'input', t('Input') ]]} value={tab} onChange={setTab} />
    <div id={`${id}-input-panel`} role="tabpanel" tabIndex={0} aria-labelledby={`${id}-input-tab`} hidden={tab !== 'input'}>
      <div className="chat-tool-card"><ToolValue value={review.input} /></div>
    </div>
    {review.kind === 'result' && <div id={`${id}-output-panel`} role="tabpanel" tabIndex={0} aria-labelledby={`${id}-output-tab`} hidden={tab !== 'output'}>
      <div className="chat-tool-card"><ToolValue value={review.output} />{review.images?.map((image, index) =>
        <img className="chat-mcp-image" key={index} alt={t('MCP image {{index, number}}', { index: index + 1 })} src={image} />)}</div>
    </div>}
    <footer className="chat-tool-footer">
      <Button type="button" variant="subtle" onClick={onStop}>{t('Stop')}</Button>
      <Button type="button" disabled={review.disabled} onClick={() => onAnswer(false)}>{t('Decline')}</Button>
      <Button type="button" variant="primary" disabled={review.disabled} onClick={() => onAnswer(true)}>
        {t(review.kind === 'result' ? 'Approve and share' : 'Approve and run')}
      </Button>
    </footer>
  </dialog>;
}
