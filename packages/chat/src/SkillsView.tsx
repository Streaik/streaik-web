import * as Menu from '@radix-ui/react-dropdown-menu';
import { Button, Tooltip } from '@streaik/themes';
import type { Gateway, RemoteSkill } from '@streaik/gateway';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { CatalogMark } from './CatalogMark';
import { ChatIcon } from './ChatIcon';
import { useAppTranslation } from './i18n';
import { defaultSkillVersion, importSkillZip, saveSkillVersion } from './skillBundles';
import type { SkillBundle, SkillVersion } from './skillBundles';
import { LocalSkillDetails, RemoteSkillDetails, SkillDialog, SkillEditor, SkillTabs, SkillUploadDialog, skillError } from './SkillDialogs';
import type { LocalSkills } from './useLocalSkills';
import type { RemoteSkills } from './useRemoteSkills';
import './skills.css';

type Action = { kind: 'create' } | { kind: 'edit' | 'details' | 'delete'; id: string }
  | { kind: 'remote-details'; skill: RemoteSkill }
  | { kind: 'upload'; source: { local: SkillVersion } | { remote: RemoteSkill; version?: string } };

function SkillCardMenu({ name, container, actions, onAction }: {
  name: string; container: HTMLDivElement | null; actions: { label: string; action: Action; danger?: boolean }[];
  onAction: (action: Action, opener: HTMLElement) => void;
}) {
  const { t } = useAppTranslation();
  const trigger = useRef<HTMLButtonElement>(null);
  const pending = useRef<Action | undefined>(undefined);
  return <Menu.Root modal={false}>
    <Tooltip content={t('More actions')}><Menu.Trigger ref={trigger} type="button" className="chat-row-button"
      aria-label={t('More actions for {{title}}', { title: name })}><ChatIcon name="more" /></Menu.Trigger></Tooltip>
    {container && <Menu.Portal container={container}><Menu.Content className="chat-menu" align="end" sideOffset={4} collisionPadding={8}
      onCloseAutoFocus={event => {
        if (!pending.current || !trigger.current) return;
        const action = pending.current; pending.current = undefined;
        event.preventDefault(); trigger.current.focus(); onAction(action, trigger.current);
      }}>
      {actions.map(({ label, action, danger }) => <Menu.Item key={label} className="chat-menu-item" data-danger={danger || undefined}
        onSelect={() => { pending.current = action; }}>{label}</Menu.Item>)}
    </Menu.Content></Menu.Portal>}
  </Menu.Root>;
}

export function SkillsView({ store, gateway, remote, toolbar, menuContainer }: {
  store: LocalSkills; gateway: Gateway; remote: RemoteSkills;
  toolbar: HTMLDivElement | null; menuContainer: HTMLDivElement | null;
}) {
  const { t } = useAppTranslation();
  const { online, needsLoad, load } = remote;
  const [query, setQuery] = useState('');
  const [sourceTab, setSourceTab] = useState(0);
  const [importing, setImporting] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [action, setAction] = useState<Action>();
  const file = useRef<HTMLInputElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const addButton = useRef<HTMLButtonElement>(null);
  const createOnMenuClose = useRef(false);
  const opener = useRef<HTMLElement | null>(null);
  const active = useRef<AbortController | null>(null);

  useLayoutEffect(() => {
    if (action || !opener.current) return;
    const target = opener.current; opener.current = null;
    if (target.isConnected) target.focus();
    if (document.activeElement !== target) search.current?.focus();
  }, [action]);
  useEffect(() => () => { active.current?.abort(); active.current = null; }, []);
  useEffect(() => {
    if (sourceTab === 1 && needsLoad) load();
  }, [sourceTab, needsLoad, load]);

  function open(next: Action, button: HTMLElement) { opener.current = button; setAction(next); setError(''); }
  const close = () => setAction(undefined);
  function save(bundle: SkillBundle, id?: string, imported = false) {
    store.update(skills => {
      const result = saveSkillVersion(skills, bundle, id);
      return imported ? result.map((skill, index) => index === result.length - 1 ? { ...skill, enabled: false } : skill) : result;
    });
    setError('');
    setMessage(t(imported ? 'Imported {{name}}. Review it before enabling it in chat.' : 'Saved {{name}}.', { name: bundle.metadata.name }));
  }

  async function importZip(zip: File) {
    if (active.current) return;
    const request = new AbortController(); active.current = request;
    setImporting(true); setError(''); setMessage('');
    try { const bundle = await importSkillZip(zip); request.signal.throwIfAborted(); save(bundle, undefined, true); }
    catch (error) { if (!request.signal.aborted) setError(skillError(error)); }
    finally { if (active.current === request) { active.current = null; setImporting(false); } }
  }

  const term = query.trim().toLowerCase();
  const matches = (...values: string[]) => values.some(value => value.toLowerCase().includes(term));
  const localCards = store.skills.flatMap(skill => {
    const version = defaultSkillVersion(skill);
    const { name, description } = version.metadata;
    return matches(name, description) ? [<article className="catalog-card agent-card" aria-label={name} key={skill.id}>
      <header className="agent-card-header"><div className="catalog-card-title"><CatalogMark provider="" name={name} />
        <div><h2>{name}</h2><p>{t('Local skill')} · v{version.version}</p></div></div>
        <div className="agent-card-actions"><Tooltip content={t('Edit')}><button type="button" className="chat-row-button" aria-label={t('Edit')}
          onClick={event => open({ kind: 'edit', id: skill.id }, event.currentTarget)}><ChatIcon name="edit" /></button></Tooltip>
          <SkillCardMenu name={name} container={menuContainer} onAction={open} actions={[
            { label: t('Details'), action: { kind: 'details', id: skill.id } },
            ...(online ? [{ label: t('Upload to…'), action: { kind: 'upload' as const, source: { local: version } } }] : []),
            { label: t('Delete'), action: { kind: 'delete', id: skill.id }, danger: true },
          ]} />
        </div></header>
      <p>{description}</p>
    </article>] : [];
  });
  const remoteCards = remote.skills.filter(skill => matches(skill.name, skill.description, skill.id)).map(skill =>
    <article className="catalog-card agent-card" aria-label={skill.name} key={skill.id}>
      <header className="agent-card-header"><div className="catalog-card-title"><CatalogMark provider={skill.id.split('/')[0]} name={skill.name} />
        <div><h2>{skill.name}</h2><p>{skill.id}</p></div></div>
        <SkillCardMenu name={skill.name} container={menuContainer} onAction={open} actions={[
          { label: t('Details and download'), action: { kind: 'remote-details', skill } },
          { label: t('Upload to…'), action: { kind: 'upload', source: { remote: skill } } },
        ]} />
      </header><p>{skill.description}</p>
    </article>);
  const selected = action && 'id' in action ? store.skills.find(skill => skill.id === action.id) : undefined;
  const addMenu = <Menu.Root modal={false}>
    <Menu.Trigger asChild><Button ref={addButton} className="agent-create" variant="primary" disabled={!store.ready}
      aria-label={t('Add skill')} title={t('Add skill')}><ChatIcon name="add" /></Button></Menu.Trigger>
    {menuContainer && <Menu.Portal container={menuContainer}><Menu.Content className="chat-menu" align="end" sideOffset={4} collisionPadding={8}
      onCloseAutoFocus={event => {
        if (!createOnMenuClose.current) return;
        createOnMenuClose.current = false;
        if (!addButton.current) return;
        event.preventDefault(); addButton.current.focus(); open({ kind: 'create' }, addButton.current);
      }}>
      <Menu.Item className="chat-menu-item" onSelect={() => { createOnMenuClose.current = true; }}>
        <ChatIcon name="add" />{t('New')}
      </Menu.Item>
      <Menu.Item className="chat-menu-item" disabled={importing} onSelect={() => file.current?.click()}>
        <ChatIcon name="attachment" />{t('Import')}
      </Menu.Item>
    </Menu.Content></Menu.Portal>}
  </Menu.Root>;
  return <section className="catalog-content" aria-labelledby="skills-title">
    {toolbar && createPortal(addMenu, toolbar)}
    <header className="agent-overview-header"><h1 id="skills-title">{t('Skills')}</h1>
      <p>{t('Create Agent Skills in your browser, or download and transfer skills from providers.')}</p></header>
    <div className="skill-toolbar">
      {!toolbar && addMenu}
      <input ref={search} className="ui-input agent-input skill-search" type="search" aria-label={t('Search skills')} placeholder={t('Search skills…')}
        value={query} onChange={event => setQuery(event.currentTarget.value)} />
      <input ref={file} type="file" hidden accept=".zip,application/zip" aria-label={t('Skill ZIP')} onChange={event => {
        const zip = event.currentTarget.files?.[0]; event.currentTarget.value = ''; if (zip) void importZip(zip);
      }} />
    </div>
    {(store.notice || message || importing) && <p role="status" className="chat-notice">
      {importing ? t('Importing…') : [store.notice && t(store.notice), message].filter(Boolean).join(' ')}</p>}
    {error && <p role="alert" className="chat-error">{t(error)}</p>}
    <SkillTabs label={t('Skill sources')} onChange={setSourceTab} tabs={[
      { title: t('Local'), panel: !store.ready ? <p role="status">{t('Loading local skills…')}</p> : localCards.length
        ? <div className="catalog-grid agent-grid">{localCards}</div> : <p role="status">{t(term ? 'No matching skills.' : 'No local skills yet.')}</p> },
      { title: t('Providers'), panel: !online ? <p>{t('Connect to a gateway to browse provider skills.')}</p> : <>
        {(needsLoad || remote.busy) && <p role="status">{t('Loading provider skills…')}</p>}
        {remote.error !== undefined && <p role="alert" className="chat-error">{t(remote.error || 'Could not load provider skills.')}</p>}
        {remoteCards.length ? <div className="catalog-grid agent-grid">{remoteCards}</div> : !needsLoad && !remote.busy && remote.error === undefined
          && <p role="status">{t(term ? 'No matching skills.' : 'No provider skills found.')}</p>}
        {remote.error !== undefined ? <Button onClick={() => load(remote.cursor)}>{t('Retry')}</Button>
          : remote.cursor && <Button disabled={remote.busy} onClick={() => load(remote.cursor)}>{t('Load more')}</Button>}
      </> },
    ]} />
    {(action?.kind === 'create' || (action?.kind === 'edit' && selected)) && <SkillEditor key={selected?.id ?? 'new'} skill={selected}
      onSave={bundle => save(bundle, selected?.id)} onClose={close} />}
    {action?.kind === 'details' && selected && <LocalSkillDetails key={selected.id} skill={selected} onClose={close}
      onUpload={online ? local => setAction({ kind: 'upload', source: { local } }) : undefined} onDefault={version => {
        store.update(items => {
          if (items.some(item => item.id !== selected.id && defaultSkillVersion(item).metadata.name === version.metadata.name)) {
            throw new Error('Another skill already uses this version’s name.');
          }
          return items.map(item => item.id === selected.id ? { ...item, defaultVersion: version.version } : item);
        });
      }} />}
    {action?.kind === 'delete' && selected && <SkillDialog title={t('Delete skill')} onClose={close}>
      <p className="skill-panel">{t('Delete the local skill {{name}} and all its versions?', { name: defaultSkillVersion(selected).metadata.name })}</p>
      <div className="agent-actions"><Button onClick={close}>{t('Cancel')}</Button><Button variant="primary" onClick={() => {
        store.update(items => items.filter(skill => skill.id !== selected.id)); close();
      }}>{t('Delete')}</Button></div>
    </SkillDialog>}
    {action?.kind === 'remote-details' && online && <RemoteSkillDetails key={action.skill.id} skill={action.skill} gateway={gateway}
      onClose={close} onImport={bundle => { save(bundle, undefined, true); close(); }}
      onUpload={version => setAction({ kind: 'upload', source: { remote: action.skill, version } })} />}
    {action?.kind === 'upload' && online && <SkillUploadDialog source={action.source} gateway={gateway} onClose={close} onUploaded={skill => {
      setMessage(t('Uploaded {{name}} as {{id}}.', { name: skill.name, id: skill.id }));
      remote.upsert(skill); close();
    }} />}
  </section>;
}
