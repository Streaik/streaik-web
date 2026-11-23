import { maxImageCount } from '@streaik/gateway';
import type { ChatModel, GatewayImageEndpoint, ImageFileInput, ImageOptions, ImageProviderOptions } from '@streaik/gateway';
import { Button } from '@streaik/themes';
import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { attachmentByteLimit, fileMediaType } from './chatAttachments';
import { ChatIcon } from './ChatIcon';
import { DialogTabs } from './ChatToolsDialogs';
import { providerName } from './CatalogViews';
import { canEditImage } from './imageRoute';
import { useAppTranslation } from './i18n';

export type ImagePreferences = Omit<ImageOptions, 'providerOptions'> & {
  maxImagesPerCall?: number;
  byProvider: Record<string, ImageProviderOptions>;
  mask?: ImageFileInput;
  markup?: ImageFileInput;
};
export const defaultImagePreferences: ImagePreferences = { n: 1, byProvider: {} };

export function readImagePreferences(scope?: string): ImagePreferences {
  if (scope) try {
    const saved = JSON.parse(localStorage.getItem(`streaik.images.settings.v1:${scope}`) ?? 'null');
    if (saved && Number.isInteger(saved.n) && saved.n >= 1 && saved.n <= maxImageCount && saved.byProvider && typeof saved.byProvider === 'object') {
      const { n, maxImagesPerCall, size, aspectRatio, seed, byProvider } = saved;
      return { n, maxImagesPerCall, size, aspectRatio, seed, byProvider };
    }
  } catch { /* Fall back to defaults. */ }
  return defaultImagePreferences;
}

export function writeImagePreferences(scope: string | undefined, { mask, markup, ...options }: ImagePreferences) {
  if (scope) try { localStorage.setItem(`streaik.images.settings.v1:${scope}`, JSON.stringify(options)); } catch { /* Keep session settings. */ }
}

export function imageSettingSupport(provider: string, model?: string) {
  return {
    aspectRatio: provider !== 'openai',
    seed: provider !== 'openai' && provider !== 'google',
    mask: provider !== 'google',
    legacy: provider === 'openai' && /^openai\/dall-e-[23]$/.test(model ?? ''),
  };
}

function ImageFileField({ label, value, onChange }: { label: string; value?: ImageFileInput; onChange: (value?: ImageFileInput) => void }) {
  const { t } = useAppTranslation();
  const id = useId();
  const [preview, setPreview] = useState('');
  const [invalid, setInvalid] = useState(false);
  useEffect(() => {
    if (!value) { setPreview(''); return; }
    const url = URL.createObjectURL(value.file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [value]);
  return <div className="image-file-setting">
    <label htmlFor={id}>{label}</label>
    <input id={id} type="file" accept="image/*" onChange={event => {
      const file = event.currentTarget.files?.[0];
      event.currentTarget.value = '';
      if (!file) return;
      const mediaType = fileMediaType(file);
      const valid = mediaType.startsWith('image/') && file.size > 0 && file.size <= attachmentByteLimit;
      setInvalid(!valid);
      if (valid) onChange({ file, mediaType });
    }} />
    {invalid && <span role="alert">{t('Choose an image file up to 10 MB.')}</span>}
    {value && <div className="image-file-preview">
      {preview && <img src={preview} alt="" />}
      <span>{value.file.name}</span>
      <Button type="button" variant="subtle" aria-label={t('Remove {{name}}', { name: value.file.name })} onClick={() => { setInvalid(false); onChange(); }}><ChatIcon name="close" /></Button>
    </div>}
  </div>;
}

export function ImageSettingsDialog({ initial, onSave, onClose, models, route }: {
  initial: ImagePreferences; onSave: (value: ImagePreferences) => void; onClose: () => void;
  models: readonly ChatModel[]; route: GatewayImageEndpoint;
}) {
  const { t } = useAppTranslation();
  const id = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  useLayoutEffect(() => { if (dialog.current && !dialog.current.open) dialog.current.showModal(); }, []);
  const [tab, setTab] = useState<'general' | 'provider'>('general');
  const [value, setValue] = useState(initial);
  const [settingsModel, setSettingsModel] = useState<string>();
  const current = models.find(({ id }) => id === settingsModel) ?? models[0];
  const model = current?.id;
  const provider = current?.provider ?? '';
  const canEdit = canEditImage(route, model);
  const support = imageSettingSupport(provider, model);
  const openai = provider === 'openai';
  const google = provider === 'google';
  const hasProvider = openai || google || provider === 'imagerouter' || provider === 'openrouter';
  const options = value.byProvider[provider] ?? {};
  const setGeneral = <K extends keyof ImagePreferences>(key: K, next: ImagePreferences[K]) => setValue(current => ({ ...current, [key]: next }));
  const setOption = <K extends keyof ImageProviderOptions>(key: K, next: ImageProviderOptions[K]) => setGeneral('byProvider', { ...value.byProvider, [provider]: { ...options, [key]: next } });
  const number = (label: string, field: number | undefined, change: (next?: number) => void, min: number, max: number, required = false) => <label>
    <span>{t(label)}</span><input type="number" step={1} min={min} max={max} value={field ?? ''} required={required}
      onChange={event => change(event.currentTarget.value ? event.currentTarget.valueAsNumber : undefined)} />
  </label>;
  const flag = (label: string, selected: string | undefined, choices: string[], change: (next?: string) => void) => <label>
    <span>{t(label)}</span><select value={selected ?? ''} onChange={event => change(event.currentTarget.value || undefined)}>
      <option value="">{t('Default')}</option>
      {choices.map(choice => <option key={choice} value={choice}>{t(choice)}</option>)}
    </select>
  </label>;
  return <dialog ref={dialog} className="chat-settings chat-tools-dialog image-settings-dialog" aria-labelledby={`${id}-title`} onClose={onClose}>
    <form onSubmit={event => { event.preventDefault(); onSave(value); dialog.current?.close(); }}>
      <header className="chat-settings-header">
        <h2 id={`${id}-title`}>{t('Image settings')}</h2>
        <Button type="button" className="chat-close" variant="subtle" aria-label={t('Close')} onClick={() => dialog.current?.close()}><ChatIcon name="close" /></Button>
      </header>
      {models.length > 1 && <div className="image-settings-fields"><label><span>{t('Image model')}</span>
        <select value={model} onChange={event => { setSettingsModel(event.currentTarget.value); setTab('general'); }}>
          {models.map(({ id, name, provider }) => <option key={id} value={id}>{name} ({providerName(provider)})</option>)}
        </select>
      </label></div>}
      <DialogTabs id={id} label={t('Image settings sections')} tabs={hasProvider ? [['general', t('General')], ['provider', providerName(provider)]] : [['general', t('General')]]} value={hasProvider ? tab : 'general'} onChange={setTab} />
      <div id={`${id}-general-panel`} role="tabpanel" aria-labelledby={`${id}-general-tab`} hidden={tab !== 'general' && hasProvider} onInvalid={() => setTab('general')}>
        <section className="chat-tool-card">
          <h3>{t('Size and aspect ratio')}</h3>
          <div className="image-settings-fields">
            <label><span>{t('Image size')}</span><input placeholder={t('Default')} list={`${id}-sizes`} value={value.size ?? ''}
              pattern="auto|[1-9][0-9]{0,4}x[1-9][0-9]{0,4}" onChange={event => setGeneral('size', event.currentTarget.value || undefined)} /></label>
            <datalist id={`${id}-sizes`}>{['auto', '512x512', '1024x1024', '1536x1024', '1024x1536', '2048x2048'].map(size => <option key={size} value={size} />)}</datalist>
            <label><span>{t('Aspect ratio')}</span><input placeholder={t('Default')} list={`${id}-ratios`} value={value.aspectRatio ?? ''}
              disabled={!support.aspectRatio} pattern="[1-9][0-9]{0,3}:[1-9][0-9]{0,3}" onChange={event => setGeneral('aspectRatio', event.currentTarget.value || undefined)} /></label>
            <datalist id={`${id}-ratios`}>{['1:1', '16:9', '9:16', '4:3', '3:4', '3:2', '2:3', '21:9'].map(ratio => <option key={ratio} value={ratio} />)}</datalist>
          </div>
        </section>
        <section className="chat-tool-card">
          <h3>{t('Output')}</h3>
          <div className="image-settings-fields">
            {number('Number of images', value.n, n => setGeneral('n', n), 1, maxImageCount, true)}
            {number('Max images per call', value.maxImagesPerCall, count => setGeneral('maxImagesPerCall', count), 1, maxImageCount)}
            <fieldset disabled={!support.seed} className="image-setting-fieldset">{number('Seed', value.seed, seed => setGeneral('seed', seed), -2147483648, 2147483647)}</fieldset>
          </div>
        </section>
        {canEdit && support.mask && <section className="chat-tool-card"><ImageFileField label={t('Edit mask')} value={value.mask} onChange={mask => setGeneral('mask', mask)} /></section>}
      </div>
      {hasProvider && <div id={`${id}-provider-panel`} role="tabpanel" aria-labelledby={`${id}-provider-tab`} hidden={tab !== 'provider'} onInvalid={() => setTab('provider')}>
        <section className="chat-tool-card">
          <h3>{t('Output')}</h3>
          <div className="image-settings-fields">
            {!support.legacy && flag('Output format', options.output_format, google ? ['png', 'jpeg'] : ['png', 'jpeg', 'webp', 'gif', 'svg'], next => setOption('output_format', next))}
            {!google && flag('Quality', options.quality, support.legacy ? ['standard', 'hd'] : ['auto', 'low', 'medium', 'high', 'xhigh', 'max'], next => setOption('quality', next))}
            {!google && !support.legacy && flag('Background', options.background, ['auto', 'transparent', 'opaque'], next => setOption('background', next))}
            {openai && !support.legacy && flag('Moderation', options.moderation, ['auto', 'low'], next => setOption('moderation', next))}
            {openai && !support.legacy && flag('Complexity', options.complexity, ['low', 'medium', 'high'], next => setOption('complexity', next))}
            {model === 'openai/dall-e-3' && flag('Style', options.style, ['vivid', 'natural'], next => setOption('style', next))}
            {!google && (options.output_format === 'jpeg' || options.output_format === 'webp') && number('Output compression', options.output_compression, next => setOption('output_compression', next), 0, 100)}
            {canEdit && openai && !support.legacy && flag('Input fidelity', options.input_fidelity, ['low', 'high'], next => setOption('input_fidelity', next))}
          </div>
          {canEdit && openai && !support.legacy && <ImageFileField label={t('Markup image')} value={value.markup} onChange={markup => setGeneral('markup', markup)} />}
        </section>
        {openai && !support.legacy && <>
          <section className="chat-tool-card"><h3>GIF</h3><div className="image-settings-fields">
            {number('Frame count', options.frame_count, next => setOption('frame_count', next), 1, 2147483647)}
            {number('Frame duration (ms)', options.frame_duration_ms, next => setOption('frame_duration_ms', next), 1, 2147483647)}
          </div></section>
          <section className="chat-tool-card"><h3>SVG</h3>
            <label className="image-svg-switch"><input type="checkbox" role="switch" checked={!!options.svg}
              onChange={event => setOption('svg', event.currentTarget.checked ? {} : undefined)} />{t('SVG options')}</label>
            {options.svg && <div className="image-settings-fields">
              <label><span>{t('SVG model')}</span><input value={options.svg.model ?? ''}
                onChange={event => setOption('svg', { ...options.svg, model: event.currentTarget.value || undefined })} /></label>
              {flag('Reasoning effort', options.svg.reasoning?.effort, ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'],
                effort => setOption('svg', { ...options.svg, reasoning: effort ? { effort } : undefined }))}
            </div>}
          </section>
        </>}
      </div>}
      <footer className="chat-tool-footer">
        <Button type="button" variant="subtle" onClick={() => { setValue(defaultImagePreferences); setTab('general'); }}>{t('Restore defaults')}</Button>
        <Button type="button" variant="subtle" onClick={() => dialog.current?.close()}>{t('Cancel')}</Button>
        <Button type="submit" variant="primary" aria-label={t('Save image settings')}>{t('Save')}</Button>
      </footer>
    </form>
  </dialog>;
}
