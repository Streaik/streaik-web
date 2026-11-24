import { Button } from '@streaik/themes';
import type { Gateway, RemoteSkill, RemoteSkillVersion, SkillUploadTargets } from '@streaik/gateway';
import { useEffect, useId, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { ChatIcon } from './ChatIcon';
import { useAppTranslation } from './i18n';
import { buildSkillMarkdown, defaultSkillVersion, exportSkillZip, importSkillZip, skillRelativePath, validateSkillBundle } from './skillBundles';
import type { LocalSkill, SkillBundle, SkillFile, SkillVersion } from './skillBundles';

export const skillError = (error: unknown) => error instanceof Error ? error.message : 'Could not complete the skill action.';

export function downloadSkillZip(zip: Blob, name: string) {
  const url = URL.createObjectURL(zip);
  const anchor = document.createElement('a');
  anchor.href = url; anchor.download = `${name.replace(/[^a-z0-9._-]+/gi, '-') || 'skill'}.zip`;
  document.body.append(anchor); anchor.click(); anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

export function SkillTabs({ label, tabs, onChange }: {
  label: string; tabs: readonly { title: string; panel: ReactNode }[]; onChange?: (index: number) => void;
}) {
  const id = useId();
  const [active, setActive] = useState(0);
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);
  function select(index: number) { setActive(index); onChange?.(index); }
  return <>
    <div className="catalog-tabs" role="tablist" aria-label={label}>
      {tabs.map(({ title }, index) => <button type="button" key={title} ref={el => { buttons.current[index] = el; }}
        id={`${id}-tab-${index}`} role="tab" tabIndex={index === active ? 0 : -1} aria-selected={index === active}
        aria-controls={`${id}-panel-${index}`} onClick={() => select(index)} onKeyDown={event => {
          const next = event.key === 'ArrowRight' ? (index + 1) % tabs.length
            : event.key === 'ArrowLeft' ? (index + tabs.length - 1) % tabs.length
            : event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : undefined;
          if (next !== undefined) { event.preventDefault(); select(next); buttons.current[next]?.focus(); }
        }}>{title}</button>)}
    </div>
    {tabs.map(({ panel }, index) => <section key={index} className="skill-panel" role="tabpanel" id={`${id}-panel-${index}`}
      aria-labelledby={`${id}-tab-${index}`} hidden={index !== active}>{panel}</section>)}
  </>;
}

export function SkillDialog({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const { t } = useAppTranslation();
  const id = useId();
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { if (ref.current && !ref.current.open) ref.current.showModal(); }, []);
  return <dialog ref={ref} aria-labelledby={id} onClose={onClose} className="chat-settings agent-dialog skill-dialog">
    <header className="chat-settings-header"><h2 id={id}>{title}</h2>
      <Button variant="subtle" className="chat-close" aria-label={t('Close')} onClick={() => ref.current?.close()}><ChatIcon name="close" /></Button>
    </header>
    {children}
  </dialog>;
}

export function SkillEditor({ skill, onSave, onClose }: { skill?: LocalSkill; onSave: (skill: SkillBundle) => void; onClose: () => void }) {
  const { t } = useAppTranslation();
  const existing = skill && defaultSkillVersion(skill);
  const [fields, setFields] = useState(() => ({ name: existing?.metadata.name ?? '', description: existing?.metadata.description ?? '',
    license: existing?.metadata.license ?? '', compatibility: existing?.metadata.compatibility ?? '',
    allowedTools: existing?.metadata['allowed-tools'] ?? '' }));
  const [instructions, setInstructions] = useState(existing?.instructions ?? '');
  const [files, setFiles] = useState<SkillFile[]>(existing?.files ?? []);
  const [file, setFile] = useState<File>();
  const [path, setPath] = useState('');
  const [error, setError] = useState('');
  const fileInput = useRef<HTMLInputElement>(null);
  const field = (key: keyof typeof fields, value: string) => setFields(previous => ({ ...previous, [key]: value }));

  function bundle(nextFiles = files) {
    return validateSkillBundle({ metadata: { name: fields.name.trim(), description: fields.description.trim(),
      ...(fields.license.trim() && { license: fields.license.trim() }), ...(fields.compatibility.trim() && { compatibility: fields.compatibility.trim() }),
      ...(fields.allowedTools.trim() && { 'allowed-tools': fields.allowedTools.trim() }),
      metadata: existing?.metadata.metadata }, instructions: instructions.trim(), files: nextFiles });
  }

  function addFile() {
    if (!file) return;
    try {
      const relative = skillRelativePath(path.trim());
      if (file.size > 16 * 1024 * 1024) throw new Error('A skill file cannot exceed 16 MiB.');
      if (relative.toLowerCase() === 'skill.md' || relative.toLowerCase().endsWith('/skill.md')) throw new Error('Edit the manifest in the SKILL.md tab.');
      setFiles([...files.filter(item => item.path.toLowerCase() !== relative.toLowerCase()), { path: relative, data: file }]);
      setFile(undefined); setPath(''); if (fileInput.current) fileInput.current.value = ''; setError('');
    } catch (error) { setError(skillError(error)); }
  }

  return <SkillDialog title={t(skill ? 'Edit skill' : 'Create skill')} onClose={onClose}>
    <form className="agent-form" noValidate onSubmit={event => {
      event.preventDefault();
      try { onSave(bundle()); onClose(); } catch (error) { setError(skillError(error)); }
    }}>
      <SkillTabs label={t('Skill editor')} tabs={[
        { title: t('General'), panel: <div className="skill-fields">
          <label>{t('Name')}<input value={fields.name} maxLength={64} placeholder={t('e.g. weekly-digest')}
            onChange={event => field('name', event.currentTarget.value)} /></label>
          <label>{t('Description')}<textarea rows={3} maxLength={1024} value={fields.description} placeholder={t('Describe what the skill does and when to use it')}
            onChange={event => field('description', event.currentTarget.value)} /></label>
          <label>{t('License')}<input value={fields.license} placeholder={t('e.g. MIT (optional)')}
            onChange={event => field('license', event.currentTarget.value)} /></label>
          <label>{t('Compatibility')}<input value={fields.compatibility} maxLength={500} placeholder={t('e.g. Requires internet access (optional)')}
            onChange={event => field('compatibility', event.currentTarget.value)} /></label>
          <label>{t('Allowed tools')}<input value={fields.allowedTools} placeholder={t('e.g. Read Search (optional)')}
            onChange={event => field('allowedTools', event.currentTarget.value)} /></label>
        </div> },
        { title: 'SKILL.md', panel: <div className="skill-fields"><label>{t('Instructions')}
          <textarea className="skill-markdown-input" rows={13} value={instructions} onChange={event => setInstructions(event.currentTarget.value)} />
        </label></div> },
        { title: t('Files'), panel: <div className="skill-fields">
          {files.length > 0 && <ul className="skill-file-list">{files.map(item => <li key={item.path}><code>{item.path}</code>
            <Button type="button" variant="subtle" aria-label={t('Remove {{name}}', { name: item.path })}
              onClick={() => setFiles(files.filter(file => file.path !== item.path))}><ChatIcon name="trash" /></Button></li>)}</ul>}
          <label>{t('Choose resource file')}<input ref={fileInput} type="file" onChange={event => {
            const next = event.currentTarget.files?.[0]; setFile(next); setPath(next?.name ?? '');
          }} /></label>
          <label>{t('Resource path')}<input value={path} placeholder={t('e.g. references/guide.md')} onChange={event => setPath(event.currentTarget.value)} /></label>
          <Button type="button" disabled={!file} onClick={addFile}>{t('Add or replace file')}</Button>
        </div> },
      ]} />
      {error && <p className="chat-error agent-save-error" role="alert">{t(error)}</p>}
      <div className="agent-actions"><Button type="button" onClick={onClose}>{t('Cancel')}</Button>
        <Button type="submit" variant="primary">{t(skill ? 'Save' : 'Create')}</Button></div>
    </form>
  </SkillDialog>;
}

function useSkillAction() {
  const active = useRef<AbortController | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => () => { active.current?.abort(); active.current = null; }, []);
  async function run(action: (signal: AbortSignal) => Promise<void>) {
    if (active.current) return;
    const controller = new AbortController(); active.current = controller; setBusy(true); setError('');
    try { await action(controller.signal); }
    catch (error) { if (!controller.signal.aborted) setError(skillError(error)); }
    finally { if (active.current === controller) { active.current = null; setBusy(false); } }
  }
  return { run, busy, error };
}

type TransferSource = { local: SkillVersion } | { remote: RemoteSkill; version?: string };
export function SkillUploadDialog({ source, gateway, onClose, onUploaded }: {
  source: TransferSource; gateway: Gateway; onClose: () => void; onUploaded: (skill: RemoteSkill) => void;
}) {
  const { t } = useAppTranslation();
  const [targets, setTargets] = useState<SkillUploadTargets>();
  const [provider, setProvider] = useState('');
  const [failure, setFailure] = useState('');
  const { busy, error, run } = useSkillAction();
  const name = 'local' in source ? source.local.metadata.name : source.remote.name;
  useEffect(() => {
    const controller = new AbortController();
    void gateway.skillUploadTargets(controller.signal).then(result => { if (!controller.signal.aborted) setTargets(result); },
      error => { if (!controller.signal.aborted) setFailure(skillError(error)); });
    return () => controller.abort();
  }, [gateway]);
  return <SkillDialog title={t('Upload skill')} onClose={onClose}>
    <div className="skill-panel skill-fields">
      <p>{t('Upload a copy of {{name}}, including its bundled files, to the selected provider.', { name })}</p>
      {'remote' in source && <p className="agent-hint">{source.remote.id} · {source.version ?? t('Default version')}</p>}
      {!targets && !failure && <p role="status">{t('Loading destinations…')}</p>}
      {targets?.providers.length === 0 && <p role="status">{t('No configured providers accept skill uploads.')}</p>}
      {!!targets?.providers.length && <label>{t('Destination provider')}<select value={provider} disabled={busy}
        onChange={event => setProvider(event.currentTarget.value)}>
        <option value="">{t('Select provider')}</option>
        {targets.providers.map(id => <option key={id} value={id}>{id}</option>)}
      </select></label>}
      {(failure || error) && <p className="chat-error" role="alert">{t(failure || error)}</p>}
    </div>
    <div className="agent-actions"><Button onClick={onClose}>{t('Cancel')}</Button>
      <Button variant="primary" disabled={!provider || !targets || busy} onClick={() => {
        if (!targets) return;
        void run(async signal => {
          const snapshot = 'local' in source ? source.local : await importSkillZip(await gateway.downloadSkill(source.remote.id, source.version, signal));
          signal.throwIfAborted();
          const zip = await exportSkillZip(snapshot);
          signal.throwIfAborted();
          const item = await gateway.uploadSkill(provider, zip, targets, signal);
          signal.throwIfAborted(); onUploaded(item);
        });
      }}>{t(busy ? 'Uploading…' : 'Upload')}</Button></div>
  </SkillDialog>;
}

export function LocalSkillDetails({ skill, onDefault, onUpload, onClose }: {
  skill: LocalSkill; onDefault: (version: SkillVersion) => void; onUpload?: (version: SkillVersion) => void; onClose: () => void;
}) {
  const { t } = useAppTranslation();
  const [version, setVersion] = useState(skill.defaultVersion);
  const selected = skill.versions.find(item => item.version === version) ?? defaultSkillVersion(skill);
  const { busy, error, run } = useSkillAction();
  return <SkillDialog title={selected.metadata.name} onClose={onClose}>
    <SkillTabs label={t('Skill details')} tabs={[
      { title: t('General'), panel: <><p>{selected.metadata.description}</p><p className="agent-hint">{t('Local skill')} · {skill.id}</p>
        {selected.metadata.license && <p>{t('License')}: {selected.metadata.license}</p>}
        {selected.metadata.compatibility && <p>{t('Compatibility')}: {selected.metadata.compatibility}</p>}</> },
      { title: t('Versions'), panel: <div className="skill-fields"><label>{t('Version')}<select value={selected.version}
        onChange={event => setVersion(Number(event.currentTarget.value))}>
        {[...skill.versions].reverse().map(item => <option key={item.version} value={item.version}>{item.version}{item.version === skill.defaultVersion ? ` (${t('Default')})` : ''}</option>)}
      </select></label><Button disabled={selected.version === skill.defaultVersion || busy}
        onClick={() => { void run(async () => onDefault(selected)); }}>{t('Set as default')}</Button></div> },
      { title: 'SKILL.md', panel: <><pre className="skill-manifest">{buildSkillMarkdown(selected)}</pre>
        {!!selected.files.length && <ul className="skill-file-list">{selected.files.map(file => <li key={file.path}><code>{file.path}</code></li>)}</ul>}</> },
    ]} />
    {error && <p role="alert" className="chat-error skill-panel">{t(error)}</p>}
    <div className="agent-actions">
      {onUpload && <Button disabled={busy} onClick={() => onUpload(selected)}>{t('Upload to…')}</Button>}
      <Button disabled={busy} onClick={() => { void run(async signal => {
        const zip = await exportSkillZip(selected); signal.throwIfAborted(); downloadSkillZip(zip, `${selected.metadata.name}-v${selected.version}`);
      }); }}>{t('Download ZIP')}</Button>
    </div>
  </SkillDialog>;
}

export function RemoteSkillDetails({ skill, gateway, onImport, onUpload, onClose }: {
  skill: RemoteSkill; gateway: Gateway; onImport: (bundle: SkillBundle) => void; onUpload: (version?: string) => void; onClose: () => void;
}) {
  const { t } = useAppTranslation();
  const [versions, setVersions] = useState<RemoteSkillVersion[]>([]);
  const [next, setNext] = useState('');
  const [version, setVersion] = useState('');
  const [preview, setPreview] = useState<SkillBundle>();
  const [versionsError, setVersionsError] = useState('');
  const { busy, error, run } = useSkillAction();
  useEffect(() => {
    const controller = new AbortController();
    void gateway.listSkillVersions(skill.id, { limit: 50 }, controller.signal).then(page => {
      if (!controller.signal.aborted) { setVersions(page.data); setNext(page.has_more ? page.last_id : ''); }
    }, error => { if (!controller.signal.aborted) setVersionsError(skillError(error)); });
    return () => controller.abort();
  }, [gateway, skill.id]);
  const getZip = (signal: AbortSignal) => gateway.downloadSkill(skill.id, version || undefined, signal);

  return <SkillDialog title={skill.name} onClose={onClose}>
    <SkillTabs label={t('Skill details')} tabs={[
      { title: t('General'), panel: <><p>{skill.description}</p><p className="agent-hint">{skill.id}</p></> },
      { title: t('Versions'), panel: <div className="skill-fields"><label>{t('Version')}<select value={version} disabled={busy}
        onChange={event => { setVersion(event.currentTarget.value); setPreview(undefined); }}>
        <option value="">{t('Default version')}{skill.default_version ? ` (${skill.default_version})` : ''}</option>
        {versions.map(item => <option key={item.id} value={item.version}>{item.version}</option>)}
      </select></label>{versionsError && <p role="status">{t(versionsError)}</p>}
      {next && <Button disabled={busy} onClick={() => { void run(async signal => {
        const page = await gateway.listSkillVersions(skill.id, { limit: 50, after: next }, signal); signal.throwIfAborted();
        setVersions(items => [...new Map([...items, ...page.data].map(item => [item.id, item])).values()]);
        setNext(page.has_more && page.last_id !== next ? page.last_id : '');
      }); }}>{t('Load more')}</Button>}</div> },
      { title: 'SKILL.md', panel: preview ? <><pre className="skill-manifest">{buildSkillMarkdown(preview)}</pre>
        {!!preview.files.length && <ul className="skill-file-list">{preview.files.map(file => <li key={file.path}><code>{file.path}</code></li>)}</ul>}</>
        : <Button disabled={busy} onClick={() => { void run(async signal => {
          const skill = await importSkillZip(await getZip(signal)); signal.throwIfAborted(); setPreview(skill);
        }); }}>{t('Load SKILL.md')}</Button> },
    ]} />
    {error && <p role="alert" className="chat-error skill-panel">{t(error)}</p>}
    <div className="agent-actions">
      <Button disabled={busy} onClick={() => onUpload(version || undefined)}>{t('Upload to…')}</Button>
      <Button disabled={busy} onClick={() => { void run(async signal => {
        const zip = await getZip(signal); signal.throwIfAborted(); downloadSkillZip(zip, `${skill.name}${version ? `-${version}` : ''}`);
      }); }}>{t('Download ZIP')}</Button>
      <Button disabled={busy} variant="primary" onClick={() => { void run(async signal => {
        const bundle = preview ?? await importSkillZip(await getZip(signal)); signal.throwIfAborted(); onImport(bundle);
      }); }}>{t('Save locally')}</Button>
    </div>
  </SkillDialog>;
}
