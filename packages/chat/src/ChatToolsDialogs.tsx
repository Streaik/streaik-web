import { Button } from '@streaik/themes';
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { RefObject } from 'react';
import { ChatIcon } from './ChatIcon';
import { DialogTabs } from './DialogTabs';
import { ToolDetails, ToolValue } from './ToolDetails';
import { describeToolOutput } from './toolOutputContent';
import { composerToolDefaults } from './chatPreferences';
import type { ChatPreferences } from './chatPreferences';
import type { RequestContext } from './chatContext';
import { localPlugins } from './localPlugins';
import type { ChatTool } from './localPlugins';
import { useAppTranslation } from './i18n';
import { defaultSkillVersion } from './skillBundles';
import type { LocalSkills } from './useLocalSkills';
import type { RemoteSkills } from './useRemoteSkills';

type DialogRef = RefObject<HTMLDialogElement | null>;

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
        <h3 id={`${id}-remote-skills`}>{t('Central skills')}</h3>
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
      <Button variant="subtle" disabled={locked} onClick={() => onChange({ ...value, ...composerToolDefaults })}>{t('Defaults')}</Button>
      <Button onClick={() => dialog.current?.close()}>{t('Close')}</Button>
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
  const skills = context?.skills?.availableSkills.skills ?? [];
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
      {key === 'system' && tab === key && context?.mcp && <section className="chat-tool-card"><h3>{t('MCP resource catalog')}</h3><ToolValue value={context.mcp} /></section>}
      {!context?.[key] && !(key === 'system' && context?.mcp) && <p>{t(context ? 'No additional context.' : 'No extra context is sent on Direct routes.')}</p>}
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
      {skills.map(({ id, name, description }) => <article key={id} className="chat-tool-card chat-context-skill-card">
        <h3>{name}</h3>
        <code>{id}</code>
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
