import { isRealtimeOnlySpeechModel, speechFormats } from '@streaik/gateway';
import type { CatalogModel } from '@streaik/gateway';
import { Button, Switch } from '@streaik/themes';
import { useId, useLayoutEffect, useRef, useState } from 'react';
import { providerName } from './aiCatalog';
import { ChatIcon } from './ChatIcon';
import { DialogTabs } from './DialogTabs';
import { useAppTranslation } from './i18n';
import { defaultSpeechPreferences, normalizeSpeechPreferences, speechProviderFields } from './speechPreferences';
import type { NativeSpeechOptions, SpeechPreferences, SpeechRoute } from './speechPreferences';

const voices = ['alloy', 'ash', 'ballad', 'coral', 'echo', 'fable', 'onyx', 'nova', 'sage', 'shimmer', 'verse', 'marin', 'cedar'];

function SpeechFields({ options, onChange, compatible, native, realtimeOnly }: {
  options: NativeSpeechOptions & { language?: string }; onChange: (value: typeof options) => void; compatible?: boolean; native?: boolean;
  realtimeOnly?: boolean;
}) {
  const { t } = useAppTranslation();
  const [custom, setCustom] = useState(() => !!options.voice && !voices.includes(options.voice));
  return <div className="image-settings-fields">
    <label><span>{t('Speed')}</span><input type="number" placeholder="1" min={compatible ? 0.25 : 0.5} max={realtimeOnly ? 1.5 : compatible ? 4 : 2} step="0.01"
      value={options.speed ?? ''} onChange={event => {
        const speed = event.currentTarget.valueAsNumber;
        onChange({ ...options, speed: Number.isFinite(speed) ? speed : undefined });
      }} /></label>
    {compatible ? <>
      <label><span>{t('Voice')}</span><select value={custom ? 'custom' : options.voice ?? ''} onChange={event => {
        const value = event.currentTarget.value;
        setCustom(value === 'custom');
        onChange({ ...options, voice: value && value !== 'custom' ? value : undefined });
      }}><option value="">{t('Default')}</option>{voices.map(voice => <option key={voice} value={voice}>{voice}</option>)}
        <option value="custom">{t('Custom')}</option></select></label>
      {custom && <label><span>{t('Custom voice')}</span><input required maxLength={200} value={options.voice ?? ''}
        onChange={event => onChange({ ...options, voice: event.currentTarget.value })} /></label>}
    </> : <label><span>{t('Voice')}</span><input maxLength={200} value={options.voice ?? ''}
      onChange={event => onChange({ ...options, voice: event.currentTarget.value })} /></label>}
    {!realtimeOnly && <label><span>{t(native ? 'Response format' : 'Output format')}</span><select value={options.outputFormat ?? ''}
      onChange={event => onChange({ ...options, outputFormat: event.currentTarget.value || undefined })}>
      <option value="">{t('Default')}</option>{speechFormats.map(format => <option key={format} value={format}>{format.toUpperCase()}</option>)}
    </select></label>}
    {native && <label><span>{t('Stream format')}</span><select value={options.streamFormat ?? ''}
      onChange={event => onChange({ ...options, streamFormat: event.currentTarget.value === 'sse' ? 'sse' : event.currentTarget.value === 'audio' ? 'audio' : undefined })}>
      <option value="">{t('Default')}</option><option value="audio">{t('Audio')}</option><option value="sse">SSE</option>
    </select></label>}
    {!compatible && !realtimeOnly && <label><span>{t('Language')}</span><input maxLength={35} value={options.language ?? ''}
      onChange={event => onChange({ ...options, language: event.currentTarget.value })} /></label>}
    <label className="speech-instructions"><span>{t('Instructions')}</span><textarea rows={3} maxLength={4096} value={options.instructions ?? ''}
      onChange={event => onChange({ ...options, instructions: event.currentTarget.value })} /></label>
  </div>;
}

export function SpeechSettingsDialog({ route, models, initial, onSave, onClose }: {
  route: SpeechRoute; models: readonly CatalogModel[]; initial: SpeechPreferences;
  onSave: (value: SpeechPreferences) => void; onClose: () => void;
}) {
  const { t } = useAppTranslation();
  const id = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  useLayoutEffect(() => { if (dialog.current && !dialog.current.open) dialog.current.showModal(); }, []);
  const [value, setValue] = useState(initial);
  const [tab, setTab] = useState('general');
  const [reset, setReset] = useState(0);
  const native = route === '/v1/audio/speech';
  const realtimeOnly = route === 'websocket' && models.length > 0 && models.every(model => isRealtimeOnlySpeechModel(model.id));
  const providers = [...new Set(models.map(({ id }) => id.split('/', 1)[0]))].filter(provider =>
    Object.hasOwn(speechProviderFields, provider) || provider === 'openai' && !native && !realtimeOnly);
  const tabs = [['general', t('General')] as const, ...providers.map(provider => [provider, providerName(provider)] as const)];
  const active = tabs.some(([key]) => key === tab) ? tab : 'general';
  return <dialog ref={dialog} className="chat-settings chat-tools-dialog image-settings-dialog" aria-labelledby={`${id}-title`} onClose={onClose}>
    <form onSubmit={event => { event.preventDefault(); onSave(normalizeSpeechPreferences(value)); dialog.current?.close(); }}>
      <header className="chat-settings-header">
        <h2 id={`${id}-title`}>{t('Speech settings')}</h2>
        <Button type="button" className="chat-close" variant="subtle" aria-label={t('Close')} onClick={() => dialog.current?.close()}><ChatIcon name="close" /></Button>
      </header>
      <DialogTabs id={id} label={t('Speech settings sections')} tabs={tabs} value={active} onChange={setTab} />
      {tabs.map(([key]) => <div key={key} role="tabpanel" id={`${id}-${key}-panel`} aria-labelledby={`${id}-${key}-tab`}
        hidden={key !== active} onInvalid={() => setTab(key)}>
        <section className="chat-tool-card">
          {key === 'general' ? <SpeechFields key={`${route}:${reset}`} options={native ? value.native : value.general} native={native} compatible={native} realtimeOnly={realtimeOnly}
            onChange={options => setValue(current => ({ ...current, [native ? 'native' : 'general']: options }))} />
          : key === 'openai' ? <SpeechFields key={reset} options={value.native} compatible
              onChange={native => setValue(current => ({ ...current, native }))} />
          : <div className="image-settings-fields">{speechProviderFields[key].map(field => {
            const option = value.providers[key]?.[field.key];
            const change = (option: number | boolean | undefined) => setValue(current => ({ ...current, providers: { ...current.providers,
              [key]: { ...current.providers[key], [field.key]: option } } }));
            return field.kind === 'checkbox' ? <Switch key={field.key} label={t(field.label)} checked={option === true} onCheckedChange={change} />
              : <label key={field.key}><span>{t(field.label)}</span><input type="number" min={field.min} max={field.max} step={field.step}
                value={typeof option === 'number' ? option : ''} onChange={event => change(Number.isFinite(event.currentTarget.valueAsNumber) ? event.currentTarget.valueAsNumber : undefined)} /></label>;
          })}</div>}
        </section>
      </div>)}
      <footer className="chat-tool-footer">
        <Button type="button" variant="subtle" onClick={() => { setValue(defaultSpeechPreferences); setTab('general'); setReset(value => value + 1); }}>{t('Restore defaults')}</Button>
        <Button type="button" variant="subtle" onClick={() => dialog.current?.close()}>{t('Cancel')}</Button>
        <Button type="submit" variant="primary">{t('Save')}</Button>
      </footer>
    </form>
  </dialog>;
}
