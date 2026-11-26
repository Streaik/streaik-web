import { Button } from '@streaik/themes';
import type { Gateway, RemoteSkill } from '@streaik/gateway';
import { useEffect, useRef, useState } from 'react';
import type { JsonValue } from './agentDefinition';
import { agentSkillEntries, downloadAgentSkill, embedAgentSkill, embeddedSkillOrigin, isAgentSkillReference, isCentralSkillId,
  isInlineAgentSkill, latestSkillVersion, linkAgentSkill } from './agentSkills';
import type { AgentSkillReference, InlineAgentSkill, SkillOrigin } from './agentSkills';
import { useAppTranslation } from './i18n';
import { defaultSkillVersion, importSkillZip } from './skillBundles';
import type { LocalSkills } from './useLocalSkills';
import type { RemoteSkills } from './useRemoteSkills';

type Props = { active: boolean; skills?: JsonValue; onChange: (skills?: JsonValue) => void; onBusyChange: (busy: boolean) => void;
  local: LocalSkills; remote: RemoteSkills; gateway: Gateway };
type Selection = { origin?: SkillOrigin; entry: AgentSkillReference | InlineAgentSkill; index: number };

export function AgentSkillFields({ active, skills, onChange, onBusyChange, local, remote, gateway }: Props) {
  const { t } = useAppTranslation();
  const [query, setQuery] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [origins, setOrigins] = useState<ReadonlyMap<InlineAgentSkill, SkillOrigin | undefined>>(() => new Map());
  const operation = useRef<AbortController>(null);
  const { cursor, needsLoad, load, online } = remote;
  const entries = agentSkillEntries(skills);
  const inspecting = entries.some(entry => isInlineAgentSkill(entry) && !origins.has(entry));

  useEffect(() => { if (active && needsLoad) load(); }, [active, needsLoad, load]);
  useEffect(() => {
    if (!active || !inspecting) return;
    let cancelled = false;
    const pending = agentSkillEntries(skills).filter(isInlineAgentSkill).filter(entry => !origins.has(entry));
    void Promise.all(pending.map(async entry => [entry, await embeddedSkillOrigin(entry)] as const)).then(results => {
      if (!cancelled) setOrigins(current => new Map([...current, ...results]));
    });
    return () => { cancelled = true; };
  }, [active, inspecting, origins, skills]);
  useEffect(() => () => operation.current?.abort(), []);

  function setEntry(index: number, next?: JsonValue) {
    setError('');
    const updated = [...entries];
    if (index < 0) { if (next !== undefined) updated.push(next); }
    else if (next !== undefined) updated[index] = next;
    else updated.splice(index, 1);
    onChange(updated.length ? updated : undefined);
  }

  async function prepare(index: number, origin: SkillOrigin, make: (signal: AbortSignal) => Promise<InlineAgentSkill>) {
    if (operation.current) return;
    const controller = new AbortController();
    operation.current = controller;
    onBusyChange(true);
    setBusy(true);
    setError('');
    try {
      const attachment = await make(controller.signal);
      if (controller.signal.aborted) return;
      setOrigins(current => new Map(current).set(attachment, origin));
      setEntry(index, attachment);
    } catch {
      if (!controller.signal.aborted) setError('Could not embed this skill. No selection was changed.');
    } finally {
      if (!controller.signal.aborted) { operation.current = null; onBusyChange(false); setBusy(false); }
    }
  }

  function centralEmbed(index: number, item: RemoteSkill, version: string) {
    const origin = { id: item.id, version: version || undefined };
    void prepare(index, origin, async signal => {
      const bundle = await importSkillZip(await downloadAgentSkill(gateway, item.id, origin.version, item, signal));
      signal.throwIfAborted();
      return embedAgentSkill(bundle, origin);
    });
  }

  if (!active) return null;
  const selected = entries.flatMap<Selection>((entry, index) => isAgentSkillReference(entry)
    ? [{ origin: { id: entry.skill_id, version: entry.version }, entry, index }]
    : isInlineAgentSkill(entry) ? [{ origin: origins.get(entry), entry, index }] : []);
  const central = new Map<string, RemoteSkill | undefined>(remote.skills.map(item => [item.id, item]));
  for (const { origin, entry } of selected) {
    if (origin && (isAgentSkillReference(entry) || isCentralSkillId(origin.id)) && !central.has(origin.id)) central.set(origin.id, undefined);
  }
  const disabled = busy || inspecting;
  const match = query.trim().toLowerCase();
  const centralRows = [...central].filter(([id, item]) => !match || selected.some(selection => selection.origin?.id === id) ||
    `${item?.name ?? ''} ${item?.description ?? ''} ${id}`.toLowerCase().includes(match));

  if (skills != null && !Array.isArray(skills)) return <p>{t('This agent has an unsupported skills format. Its saved skills will not be changed.')}</p>;

  return <>
    {inspecting && <p role="status">{t('Checking saved skill attachments…')}</p>}
    {busy && <p role="status">{t('Preparing skill archive…')}</p>}
    {error && <p className="chat-error" role="alert">{t(error)}</p>}
    <section className="agent-field-group" aria-label={t('Local')}>
      <h3>{t('Local')}</h3>
      <p>{t('Attach a copy of a skill from this browser.')}</p>
      {!local.ready ? <p role="status">{t('Loading local skills…')}</p> : !local.skills.length && <p>{t('No local skills yet.')}</p>}
      {!inspecting && local.skills.map(item => {
        const bundle = defaultSkillVersion(item);
        const { name, description } = bundle.metadata;
        const current = selected.find(({ origin, entry }) => origin?.id === item.id && isInlineAgentSkill(entry));
        return <div className="agent-skill-row" key={item.id}>
          <label><input type="checkbox" role="switch" checked={!!current} disabled={disabled} onChange={event => {
            if (!event.currentTarget.checked && current) setEntry(current.index);
            else {
              const origin = { id: item.id, version: String(bundle.version) };
              void prepare(-1, origin, () => embedAgentSkill(bundle, origin));
            }
          }} /> {current && isInlineAgentSkill(current.entry) ? current.entry.name : name}</label>
          <p>{current && isInlineAgentSkill(current.entry) ? current.entry.description : description}</p>
          {current && <small>{t('Embedded')}</small>}
        </div>;
      })}
      {!inspecting && selected.filter(({ origin, entry }) => isInlineAgentSkill(entry) && (!origin ||
        (!isCentralSkillId(origin.id) && !local.skills.some(item => item.id === origin.id)))).map(({ entry, index }) =>
        isInlineAgentSkill(entry) && <div className="agent-skill-row" key={index}>
          <label><input type="checkbox" role="switch" checked disabled={disabled} onChange={() => setEntry(index)} /> {entry.name}</label>
          <p>{entry.description}</p><small>{t('Embedded')}</small>
        </div>)}
    </section>
    <section className="agent-field-group" aria-label={t('Central')}>
      <h3>{t('Central')}</h3>
      <p>{t('Link to a catalog skill or embed a copy in this agent.')}</p>
      {!online && <p>{t('Connect to a Gateway to browse Central skills.')}</p>}
      {online && !!remote.skills.length && <input type="search" className="ui-input agent-input" aria-label={t('Search Central skills')}
        placeholder={t('Search Central skills…')} value={query} onChange={event => setQuery(event.currentTarget.value)} />}
      {remote.busy && <p role="status">{t('Loading provider skills…')}</p>}
      {remote.error && <p className="chat-error" role="alert">{t(remote.error)}</p>}
      {online && !inspecting && !remote.busy && !remote.error && !centralRows.length && <p>{t(match ? 'No matching skills.' : 'No provider skills found.')}</p>}
      {!inspecting && centralRows.map(([id, item]) => {
        const current = selected.find(({ origin }) => origin?.id === id);
        const attached = current?.entry;
        const inline = isInlineAgentSkill(attached) ? attached : undefined;
        const name = inline?.name ?? item?.name ?? id;
        const description = inline?.description ?? item?.description;
        const version = current?.origin?.version ?? '';
        const versions = [...new Set([version, item?.default_version, item?.latest_version])]
          .filter((value): value is string => !!value && value !== latestSkillVersion);
        return <div className="agent-skill-row" key={id}>
          <label><input type="checkbox" role="switch" checked={!!current} disabled={disabled || (!current && !item)} onChange={event =>
            event.currentTarget.checked ? setEntry(-1, linkAgentSkill(id)) : current && setEntry(current.index)} /> {name}</label>
          {description && <p>{description}</p>}
          {current && <div className="agent-skill-options">
            <label className="agent-field">{t('Attachment')}
              <select className="ui-select" aria-label={t('Attachment for {{name}}', { name })} value={inline ? 'inline' : 'reference'}
                disabled={disabled} onChange={event => {
                  if (event.currentTarget.value === 'reference') setEntry(current.index, linkAgentSkill(id, version));
                  else if (item) centralEmbed(current.index, item, version);
                }}>
                <option value="reference">{t('Link')}</option>
                <option value="inline" disabled={!inline && !item}>{t('Embed')}</option>
              </select>
            </label>
            <label className="agent-field">{t('Version')}
              <select className="ui-select" aria-label={t('Version for {{name}}', { name })} value={version} disabled={disabled || (!!inline && !item)}
                onChange={event => {
                  const next = event.currentTarget.value;
                  if (inline && item) centralEmbed(current.index, item, next);
                  else if (isAgentSkillReference(attached)) {
                    const { version: _, ...reference } = attached;
                    setEntry(current.index, { ...reference, ...(next && { version: next }) });
                  }
                }}>
                <option value="">{t('Default')}</option><option value={latestSkillVersion}>{t('Latest')}</option>
                {versions.map(value => <option key={value} value={value}>{value}</option>)}
              </select>
            </label>
          </div>}
        </div>;
      })}
      {online && (cursor || remote.error) && <div><Button type="button" disabled={remote.busy} onClick={() => load(cursor)}>
        {t(remote.error ? 'Retry' : 'Load more')}
      </Button></div>}
    </section>
  </>;
}
