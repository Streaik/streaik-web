import { deepgramTranscriptionSwitches, openAITranscriptionFormats } from '@streaik/gateway';
import type { GatewayTranscriptionEndpoint, TranscriptionConfig } from '@streaik/gateway';
import { Button, Switch } from '@streaik/themes';
import { useId, useLayoutEffect, useRef, useState } from 'react';
import { providerName } from './aiCatalog';
import { ChatIcon } from './ChatIcon';
import { DialogTabs } from './DialogTabs';
import { useAppTranslation } from './i18n';
import { defaultTranscriptionProviders } from './transcriptionPreferences';
import type { TranscriptionProviderPreferences } from './transcriptionPreferences';

function configObject(value: TranscriptionConfig[string]): TranscriptionConfig {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as TranscriptionConfig : {};
}

const listValue = (value: TranscriptionConfig[string]) => Array.isArray(value) ? value.filter(item => typeof item === 'string') : [];

function ListField({ label, value, onChange }: { label: string; value?: readonly string[]; onChange: (value?: string[]) => void }) {
  const { t } = useAppTranslation();
  const [draft, setDraft] = useState(() => value?.join('\n') ?? '');
  return <label><span>{t(label)}</span><textarea rows={3} maxLength={4000} value={draft} onChange={event => {
    const next = event.currentTarget.value;
    setDraft(next);
    const values = [...new Set(next.split(/[\n,]/).map(item => item.trim()).filter(Boolean))];
    onChange(values.length ? values : undefined);
  }} /></label>;
}

function useFields() {
  const { t } = useAppTranslation();
  return {
    text: (label: string, value: TranscriptionConfig[string], set: (value?: string) => void, maxLength = 35) =>
      <label><span>{t(label)}</span><input maxLength={maxLength} value={typeof value === 'string' ? value : ''}
        onChange={event => set(event.currentTarget.value || undefined)} /></label>,
    number: (label: string, value: TranscriptionConfig[string], set: (value?: number) => void, min: number, max: number, step: number) =>
      <label><span>{t(label)}</span><input type="number" min={min} max={max} step={step} value={typeof value === 'number' ? value : ''}
        onChange={event => set(Number.isFinite(event.currentTarget.valueAsNumber) ? event.currentTarget.valueAsNumber : undefined)} /></label>,
    choice: (label: string, value: TranscriptionConfig[string], choices: readonly string[], set: (value?: string) => void, defaultValue?: string) =>
      <label><span>{t(label)}</span><select value={typeof value === 'string' && choices.includes(value) ? value : ''} onChange={event => set(event.currentTarget.value || undefined)}>
        <option value="">{defaultValue ? `${t('Default')} (${defaultValue})` : t('Default')}</option>
        {choices.map(choice => <option key={choice} value={choice}>{choice}</option>)}
      </select></label>,
    toggle: (label: string, value: TranscriptionConfig[string], set: (value: boolean) => void) =>
      <Switch key={label} label={t(label)} checked={value === true} onCheckedChange={set} />,
  };
}

type FileFieldsProps = { model: string; route: GatewayTranscriptionEndpoint; options: TranscriptionConfig; set: (key: string, value: TranscriptionConfig[string]) => void };

function OpenAIFields({ model, route, options, set }: FileFieldsProps) {
  const f = useFields();
  const native = route === '/v1/audio/transcriptions';
  const formats = openAITranscriptionFormats(model);
  const diarized = model.includes('transcribe-diarize');
  const timestamps = listValue(options['timestamp_granularities[]']);
  const showTimestamps = model === 'openai/whisper-1' && (!native || !options.response_format || options.response_format === 'verbose_json');
  return <>
    {f.text('Language', options.language, value => set('language', value))}
    {!diarized && f.text('Transcription prompt', options.prompt, value => set('prompt', value), 1000)}
    {!diarized && f.number('Temperature', options.temperature, value => set('temperature', value), 0, 1, 0.01)}
    {native && f.choice('Response format', options.response_format, formats, value => set('response_format', value), formats[0])}
    {showTimestamps && (native ? <div className="chat-tool-switches">
      {(['segment', 'word'] as const).map(kind => f.toggle(kind === 'word' ? 'Word timestamps' : 'Segment timestamps', timestamps.includes(kind), checked => {
        const next = checked ? [...timestamps, kind] : timestamps.filter(value => value !== kind);
        set('timestamp_granularities[]', next.length ? next : undefined);
      }))}
    </div> : f.choice('Timestamp granularity', timestamps[0], ['segment', 'word'], value => set('timestamp_granularities[]', value ? [value] : undefined), 'segment'))}
  </>;
}

const deepgramLabels = ['Detect language', 'Smart formatting', 'Punctuation', 'Identify speakers', 'Utterances', 'Numerals', 'Profanity filter', 'Opt out of model improvement'];

function DeepgramFields({ model, options, set }: FileFieldsProps) {
  const f = useFields();
  const term = model.startsWith('deepgram/nova-3') ? 'keyterm' : 'keywords';
  return <>
    {!options.detect_language && f.text('Language', options.language, value => set('language', value))}
    {f.text(term === 'keyterm' ? 'Keyterm' : 'Keywords', options[term], value => set(term, value), 1000)}
    <div className="chat-tool-switches">{deepgramTranscriptionSwitches.map((key, i) => f.toggle(deepgramLabels[i], options[key], value => set(key, value)))}</div>
  </>;
}

function GladiaFields({ options, set }: FileFieldsProps) {
  const f = useFields();
  const language = configObject(options.language_config);
  const vocabulary = configObject(options.custom_vocabulary_config);
  return <>
    <ListField label="Languages" value={listValue(language.languages)} onChange={languages => set('language_config', { ...language, languages })} />
    <div className="chat-tool-switches">
      {f.toggle('Code switching', language.code_switching, code_switching => set('language_config', { ...language, code_switching }))}
      {f.toggle('Identify speakers', options.diarization, value => set('diarization', value))}
      {f.toggle('Custom vocabulary', options.custom_vocabulary, value => set('custom_vocabulary', value))}
      {f.toggle('Detect entities', options.detect_entities, value => set('detect_entities', value))}
      {f.toggle('Sentiment analysis', options.sentiment_analysis, value => set('sentiment_analysis', value))}
      {f.toggle('Summarization', options.summarization, value => set('summarization', value))}
    </div>
    {options.custom_vocabulary === true && <ListField label="Vocabulary" value={listValue(vocabulary.vocabulary)}
      onChange={terms => set('custom_vocabulary_config', terms?.length ? { ...vocabulary, vocabulary: terms } : undefined)} />}
  </>;
}

function GoogleFields({ options, set }: FileFieldsProps) {
  const f = useFields();
  const generation = configObject(options.generation_config);
  return <>
    {f.number('Temperature', generation.temperature, temperature => set('generation_config', { ...generation, temperature }), 0, 2, 0.01)}
    {f.number('Max output tokens', generation.max_output_tokens, max_output_tokens => set('generation_config', { ...generation, max_output_tokens }), 1, 65536, 1)}
  </>;
}

const fileForms = { openai: OpenAIFields, deepgram: DeepgramFields, gladia: GladiaFields, google: GoogleFields };
type FileProvider = keyof typeof fileForms;

function fileSettingsForm(route: GatewayTranscriptionEndpoint, provider?: string) {
  if (provider && Object.hasOwn(fileForms, provider) && (provider === 'openai' || provider === 'deepgram' || route === '/api/transcriptions')) {
    return fileForms[provider as FileProvider];
  }
}

export function hasTranscriptionSettings(route: GatewayTranscriptionEndpoint, fileModel?: string, liveModel?: string) {
  // A supported real-time model always has settings, even when there is no file form.
  return !!(liveModel || fileSettingsForm(route, fileModel?.split('/')[0]));
}

export function TranscriptionSettingsDialog({ initial, onSave, onClose, route, fileModel, liveModel }: {
  initial: TranscriptionProviderPreferences; onSave: (value: TranscriptionProviderPreferences) => void; onClose: () => void;
  route: GatewayTranscriptionEndpoint; fileModel?: string; liveModel?: string;
}) {
  const { t } = useAppTranslation();
  const f = useFields();
  const id = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  useLayoutEffect(() => { if (dialog.current && !dialog.current.open) dialog.current.showModal(); }, []);
  const [value, setValue] = useState(initial);
  const [tab, setTab] = useState('general');
  const [reset, setReset] = useState(0);
  const fileProvider = fileModel?.split('/')[0];
  const liveProvider = liveModel?.split('/')[0];
  const native = route === '/v1/audio/transcriptions';
  const Form = fileSettingsForm(route, fileProvider);
  const panels = [...new Set([Form && fileProvider, liveProvider].filter((provider): provider is string => !!provider))];
  const general = native && panels.includes('openai');
  const tabs = [...(general ? [['general', t('General')] as const] : []), ...panels.filter(provider => !(general && provider === 'openai'))
    .map(provider => [provider, providerName(provider)] as const)];
  const active = tabs.some(([key]) => key === tab) ? tab : tabs[0]?.[0];
  const updateGoogle = (patch: typeof value.googleLive) => setValue(current => ({ ...current, googleLive: { ...current.googleLive, ...patch } }));
  return <dialog ref={dialog} className="chat-settings chat-tools-dialog image-settings-dialog" aria-labelledby={`${id}-title`} onClose={onClose}>
    <form onSubmit={event => { event.preventDefault(); onSave(value); dialog.current?.close(); }}>
      <header className="chat-settings-header">
        <h2 id={`${id}-title`}>{t('Settings')}</h2>
        <Button type="button" className="chat-close" variant="subtle" aria-label={t('Close')} onClick={() => dialog.current?.close()}><ChatIcon name="close" /></Button>
      </header>
      {!!tabs.length && <DialogTabs id={id} label={t('Transcription settings sections')} tabs={tabs} value={active ?? ''} onChange={setTab} />}
      {!tabs.length && <p role="status">{t('No settings for this model and route.')}</p>}
      {tabs.map(([key]) => {
        const provider = key === 'general' ? 'openai' : key;
        return <div key={key} role="tabpanel" id={`${id}-${key}-panel`} aria-labelledby={`${id}-${key}-tab`} hidden={active !== key} onInvalid={() => setTab(key)}>
          {fileModel && Form && provider === fileProvider && <section className="chat-tool-card">
            <h3>{key === 'general' ? providerName(provider) : t(provider === 'openai' || provider === 'google' ? 'General' : 'File transcription')}</h3>
            <div className="image-settings-fields"><Form key={reset} model={fileModel} route={route} options={value.providerOptions[provider] ?? {}}
              set={(name, option) => setValue(current => ({ ...current,
                providerOptions: { ...current.providerOptions, [provider]: { ...current.providerOptions[provider], [name]: option } },
              }))} /></div>
          </section>}
          {liveModel && provider === liveProvider && <section className="chat-tool-card"><h3>{t('Real-time')}</h3><div className="image-settings-fields" key={reset}>
            {provider === 'google' ? <>
              <ListField label="Language codes" value={value.googleLive.languageCodes} onChange={languageCodes => updateGoogle({ languageCodes })} />
              <ListField label="Custom vocabulary" value={value.googleLive.customVocabulary} onChange={customVocabulary => updateGoogle({ customVocabulary })} />
              {f.choice('Transcription mode', value.googleLive.mode, ['VERBATIM', 'SMART'], mode => updateGoogle({ mode: mode === 'SMART' || mode === 'VERBATIM' ? mode : undefined }), 'VERBATIM')}
            </> : f.text(fileProvider === provider ? 'Real-time transcription language' : 'Language', value.liveLanguages[provider], language =>
              setValue(current => ({ ...current, liveLanguages: { ...current.liveLanguages, [provider]: language } })))}
          </div></section>}
        </div>;
      })}
      <footer className="chat-tool-footer">
        {!!tabs.length && <Button type="button" variant="subtle" onClick={() => { setValue(defaultTranscriptionProviders); setTab('general'); setReset(value => value + 1); }}>{t('Restore defaults')}</Button>}
        <Button type="button" variant="subtle" onClick={() => dialog.current?.close()}>{t('Cancel')}</Button>
        {!!tabs.length && <Button type="submit" variant="primary">{t('Save')}</Button>}
      </footer>
    </form>
  </dialog>;
}
