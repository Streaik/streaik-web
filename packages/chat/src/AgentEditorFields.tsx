import { Button, Select, Textarea } from '@streaik/themes';
import type { SelectOption } from '@streaik/themes';
import type { CatalogModel } from '@streaik/gateway';
import { useId, useRef, useState } from 'react';
import type { ComponentPropsWithoutRef, ReactNode } from 'react';
import { agentIconUrl } from './agentDraft';
import type { AgentDraft, IconDraft } from './agentDraft';
import type { AgentModel } from './agentDefinition';
import { useAppTranslation, useSelectSearch } from './i18n';

type Patch = (patch: Partial<AgentDraft>) => void;
type ModelFields = { draft: AgentDraft; initial: AgentDraft; patch: Patch; catalog: readonly CatalogModel[]; catalogStatus?: string };
const modelLabel = ({ name, id }: CatalogModel) => name === id ? id : `${name} (${id})`;
const checkTag = (value: string, tags: readonly string[]) => !!value.trim() && !tags.some((tag) => tag.toLowerCase() === value.trim().toLowerCase());

function Field({ label, ...props }: ComponentPropsWithoutRef<'input'> & { label: string }) {
  const id = useId();
  return <div className="agent-field"><label htmlFor={id}>{label}</label><input {...props} id={id} className="ui-input agent-input" /></div>;
}

function LongField({ label, ...props }: ComponentPropsWithoutRef<typeof Textarea> & { label: string }) {
  const id = useId();
  return <div className="agent-field"><label htmlFor={id}>{label}</label><Textarea {...props} id={id} /></div>;
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  const id = useId();
  return <section className="agent-field-group" aria-labelledby={id}><h3 id={id}>{title}</h3>{children}</section>;
}

function CatalogStatus({ status }: { status?: string }) {
  return status ? <p className="agent-hint" role="status">{status}</p> : null;
}

function modelOptions(models: readonly CatalogModel[], groupFor?: (model: CatalogModel) => SelectOption['group']): SelectOption[] {
  return [...new Map(models.map((model) => [model.id, { value: model.id, label: modelLabel(model), group: groupFor?.(model) }])).values()];
}

export function AgentGeneralFields({ draft, initial, patch, catalog, catalogStatus, sample }: ModelFields & { sample: boolean }) {
  const { t } = useAppTranslation();
  const search = useSelectSearch();
  const models = catalog.filter(({ type, tags }) => (type === 'language' || type === 'decision') && !tags.includes('realtime'));
  const available = modelOptions(models.filter(({ id }) => !draft.models.some((model) => model.id === id)), ({ type }) =>
    type === 'decision' ? { id: 'decision', label: t('Decision') } : { id: 'language', label: t('Language') });

  function move(index: number, target: number) {
    const next = [...draft.models];
    [next[index], next[target]] = [next[target], next[index]];
    patch({ models: next });
  }

  return <>
    <Field label={t('Name')} required readOnly={sample} value={draft.name} onChange={(event) => patch({ name: event.currentTarget.value })} />
    {sample && <p className="agent-hint">{t('Changes override this sample agent in this browser. Its name stays the same.')}</p>}
    <LongField label={t('Description')} rows={2} required value={draft.description} onChange={(event) => patch({ description: event.currentTarget.value })} />
    <LongField label={t('Instructions')} rows={5} required value={draft.instructions} onChange={(event) => patch({ instructions: event.currentTarget.value })} />
    <Field label={t('Argument hint')} value={draft.argumentHint} onChange={(event) => patch({ argumentHint: event.currentTarget.value })} />
    <Group title={t('Models')}>
      {draft.models.length > 0 && <ol className="agent-rows">{draft.models.map((model, index) => {
        const entry = models.find(({ id, type }) => id === model.id && (!model.type || type === model.type));
        return <li key={`${model.id}:${index}`} className="agent-item">
          <span>{entry ? modelLabel(entry) : model.id}{!entry && !catalogStatus && <small> · {t('Not in the catalog')}</small>}</span>
          <div className="agent-item-actions">
            <Button aria-label={t('Move {{model}} up', { model: model.id })} disabled={index === 0} onClick={() => move(index, index - 1)}>↑</Button>
            <Button aria-label={t('Move {{model}} down', { model: model.id })} disabled={index === draft.models.length - 1} onClick={() => move(index, index + 1)}>↓</Button>
            <Button aria-label={t('Remove model {{model}}', { model: model.id })} onClick={() => patch({ models: draft.models.filter((_, i) => i !== index) })}>{t('Remove')}</Button>
          </div>
        </li>;
      })}</ol>}
      <Select search={search(t('Add model'))} label={t('Add model')} placeholder={t('Choose a language or decision model')} value="" options={available}
        disabled={!available.length} onValueChange={(id) => {
          const item = models.find((model) => model.id === id);
          if (item) patch({ models: [...draft.models, initial.models.find((model) => model.id === id) ?? { id, type: item.type! }] });
        }} />
      <CatalogStatus status={catalogStatus ?? (!models.length ? t('No language or decision models are available from the gateway.') : undefined)} />
    </Group>
  </>;
}

const iconThemes = [{ value: 'any', label: 'Any theme' }, { value: 'light', label: 'Light' }, { value: 'dark', label: 'Dark' }];

export function AgentDetailsFields({ draft, patch, tags }: { draft: AgentDraft; patch: Patch; tags: readonly string[] }) {
  const { t } = useAppTranslation();
  const search = useSelectSearch();
  const [tag, setTag] = useState('');
  const [url, setUrl] = useState('');
  const [theme, setTheme] = useState('');
  const [iconError, setIconError] = useState('');
  const nextKey = useRef(draft.icons.length);
  const suggestions = tags.filter((value) => checkTag(value, draft.tags));

  function addTag(value: string) {
    if (!checkTag(value, draft.tags)) return;
    patch({ tags: [...draft.tags, value.trim()] });
    setTag('');
  }

  function addIcon() {
    if (!url.trim()) return;
    if (!agentIconUrl(url)) { setIconError('Enter a valid icon URL, such as an HTTPS image URL.'); return; }
    patch({ icons: [...draft.icons, { key: nextKey.current++, src: url.trim(), theme }] });
    setUrl(''); setTheme(''); setIconError('');
  }

  function changeIcon(key: number, change: Partial<IconDraft>) {
    patch({ icons: draft.icons.map((icon) => icon.key === key ? { ...icon, ...change } : icon) });
  }

  function iconTheme(label: string, value: string, change: (value: string) => void) {
    const choice = value || 'any';
    const options = iconThemes.map(option => ({ ...option, label: t(option.label) }));
    if (value && !options.some((entry) => entry.value === choice)) options.push({ value, label: value });
    return <Select label={label} value={choice} options={options} onValueChange={(next) => change(next === 'any' ? '' : next)} />;
  }

  return <>
    <Field label={t('Owner')} value={draft.owner} placeholder={t('None')} onChange={(event) => patch({ owner: event.currentTarget.value })} />
    <Group title={t('Tags')}>
      <div className="agent-field-row">
        <Field label={t('Tag')} value={tag} onChange={(event) => setTag(event.currentTarget.value)} onKeyDown={(event) => {
          if (event.key === 'Enter' && !event.nativeEvent.isComposing) { event.preventDefault(); addTag(tag); }
        }} />
        <Button disabled={!checkTag(tag, draft.tags)} onClick={() => addTag(tag)}>{t('Add tag')}</Button>
      </div>
      {suggestions.length > 0 && <Select search={search(t('Existing tags'))} label={t('Existing tags')} placeholder={t('Choose an existing tag')} value=""
        options={suggestions.map((value) => ({ value, label: value }))} onValueChange={addTag} />}
      {draft.tags.length > 0 && <ul className="agent-tags">{draft.tags.map((value, index) => <li key={`${value}:${index}`}>
        <Button aria-label={t('Remove tag {{tag}}', { tag: value })} onClick={() => patch({ tags: draft.tags.filter((_, i) => i !== index) })}>{value} <span aria-hidden="true">×</span></Button>
      </li>)}</ul>}
    </Group>
    <Group title={t('Icons')}>
      {draft.icons.map((icon, index) => <div className="agent-icon-entry" key={icon.key}>
        <Field label={t('Icon {{index, number}} URL', { index: index + 1 })} value={icon.src} inputMode="url" onChange={(event) => changeIcon(icon.key, { src: event.currentTarget.value })} />
        {iconTheme(t('Icon {{index, number}} theme', { index: index + 1 }), icon.theme, (value) => changeIcon(icon.key, { theme: value }))}
        <Button aria-label={t('Remove icon {{index, number}}', { index: index + 1 })} onClick={() => patch({ icons: draft.icons.filter(({ key }) => key !== icon.key) })}>{t('Remove icon')}</Button>
      </div>)}
      <Field label={t('Icon URL')} value={url} inputMode="url" placeholder="https://…" onChange={(event) => { setUrl(event.currentTarget.value); setIconError(''); }}
        onKeyDown={(event) => { if (event.key === 'Enter' && !event.nativeEvent.isComposing) { event.preventDefault(); addIcon(); } }} />
      {iconTheme(t('Icon theme'), theme, setTheme)}
      {iconError && <p className="chat-error" role="alert">{t(iconError)}</p>}
      <Button disabled={!url.trim()} onClick={addIcon}>{t('Add icon')}</Button>
    </Group>
  </>;
}

function AudioModelField({ label, models, saved, initial, change }: {
  label: string; models: readonly CatalogModel[]; saved?: AgentModel; initial?: AgentModel; change: (model?: AgentModel) => void;
}) {
  const { t } = useAppTranslation();
  const search = useSelectSearch();
  const id = useId();
  const options = [{ value: '', label: t('None') }, ...modelOptions(models)];
  for (const model of [saved, initial]) {
    if (model && !options.some(({ value }) => value === model.id)) options.push({ value: model.id, label: t('{{model}} (saved, unavailable)', { model: model.id }) });
  }
  return <div className="agent-field">
    <label htmlFor={id}>{label}</label>
    <Select id={id} search={search(label)} label={label} value={saved?.id ?? ''} options={options} disabled={options.length === 1} onValueChange={(value) => {
      if (!value) { change(); return; }
      if (value === initial?.id) { change(initial); return; }
      const model = models.find((item) => item.id === value);
      if (model?.type) change({ id: value, type: model.type });
    }} />
  </div>;
}

export function AgentRealtimeFields({ draft, initial, patch, catalog, catalogStatus }: ModelFields) {
  const { t } = useAppTranslation();
  const transcription = catalog.filter(({ type, tags }) => type === 'transcription' && tags.includes('realtime'));
  const speech = catalog.filter(({ type, tags }) => type === 'speech' || (type === 'audio' && tags.includes('realtime-speech')));
  const change = (update: Partial<AgentDraft['speech']>) => patch({ speech: { ...draft.speech, ...update } });
  return <>
    <CatalogStatus status={catalogStatus} />
    <Group title={t('Transcription')}>
      <AudioModelField label={t('Transcription model')} models={transcription} saved={draft.transcription} initial={initial.transcription}
        change={(model) => patch({ transcription: model })} />
      {!catalogStatus && !transcription.length && <CatalogStatus status={t('No realtime transcription models are available from the gateway.')} />}
    </Group>
    <Group title={t('Speech')}>
      <AudioModelField label={t('Speech model')} models={speech} saved={draft.speech.model} initial={initial.speech.model} change={(model) => change({ model })} />
      {!catalogStatus && !speech.length && <CatalogStatus status={t('No speech models are available from the gateway.')} />}
      <Field label={t('Voice')} value={draft.speech.voice} placeholder={t('Provider default')} onChange={(event) => change({ voice: event.currentTarget.value })} />
      <LongField label={t('Speech instructions')} rows={3} value={draft.speech.instructions} onChange={(event) => change({ instructions: event.currentTarget.value })} />
      <Field label={t('Language')} value={draft.speech.language} placeholder={t('Provider default')} onChange={(event) => change({ language: event.currentTarget.value })} />
      <Field label={t('Speed')} type="number" min="0" step="any" value={draft.speech.speed} placeholder={t('Provider default')} onChange={(event) => change({ speed: event.currentTarget.value })} />
      <Field label={t('Audio format')} value={draft.speech.mime} placeholder="audio/mpeg" onChange={(event) => change({ mime: event.currentTarget.value, ...(!event.currentTarget.value.trim() && { rate: '' }) })} />
      <Field label={t('Sample rate (Hz)')} type="number" min="1" step="1" value={draft.speech.rate} placeholder={t('Provider default')}
        disabled={!draft.speech.mime.trim()} onChange={(event) => change({ rate: event.currentTarget.value })} />
    </Group>
  </>;
}
