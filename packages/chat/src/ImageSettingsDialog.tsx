import { maxImageCount, maxNativeImageCount } from '@streaik/gateway';
import type { ChatModel, GatewayImageEndpoint, ImageFileInput, ImageJsonObject } from '@streaik/gateway';
import { Button } from '@streaik/themes';
import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import type { ComponentType } from 'react';
import { attachmentByteLimit, fileMediaType } from './chatAttachments';
import { ChatIcon } from './ChatIcon';
import { DialogTabs } from './DialogTabs';
import { providerName } from './aiCatalog';
import { defaultImagePreferences, isDallE, openAIInputFidelities } from './imagePreferences';
import type { ImagePreferences } from './imagePreferences';
import { canEditImage, imageMaskIssue } from './imageRoute';
import { useAppTranslation } from './i18n';

function ImageFileField({ label, value, onChange, removeOnly }: {
  label: string; value?: ImageFileInput; onChange: (value?: ImageFileInput) => void; removeOnly?: boolean;
}) {
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
    {removeOnly ? <span>{label}</span> : <label htmlFor={id}>{label}</label>}
    {!removeOnly && <input id={id} type="file" accept="image/*" onChange={event => {
      const file = event.currentTarget.files?.[0];
      event.currentTarget.value = '';
      if (!file) return;
      const mediaType = fileMediaType(file);
      const valid = mediaType.startsWith('image/') && file.size > 0 && file.size <= attachmentByteLimit;
      setInvalid(!valid);
      if (valid) onChange({ file, mediaType });
    }} />}
    {invalid && <span role="alert">{t('Choose an image file up to 10 MB.')}</span>}
    {value && <div className="image-file-preview">
      {preview && <img src={preview} alt="" />}
      <span>{value.file.name}</span>
      <Button type="button" variant="subtle" aria-label={t('Remove {{name}}', { name: value.file.name })} onClick={() => { setInvalid(false); onChange(); }}><ChatIcon name="close" /></Button>
    </div>}
  </div>;
}

function NumberField({ label, value, onChange, min, max, required }: {
  label: string; value?: number; onChange: (value?: number) => void; min: number; max: number; required?: boolean;
}) {
  const { t } = useAppTranslation();
  return <label><span>{t(label)}</span><input type="number" step={1} min={min} max={max} value={value ?? ''} required={required}
    onChange={event => onChange(event.currentTarget.value ? event.currentTarget.valueAsNumber : undefined)} /></label>;
}

function ChoiceField({ label, value, choices, onChange }: {
  label: string; value?: string; choices: string[]; onChange: (value?: string) => void;
}) {
  const { t } = useAppTranslation();
  return <label><span>{t(label)}</span><select value={value && choices.includes(value) ? value : ''} onChange={event => onChange(event.currentTarget.value || undefined)}>
    <option value="">{t('Default')}</option>
    {choices.map(choice => <option key={choice} value={choice}>{t(choice)}</option>)}
  </select></label>;
}

function ImageSizeField({ value, onChange, native }: { value?: string; onChange: (size?: string) => void; native?: boolean }) {
  const { t } = useAppTranslation();
  const id = useId();
  const sizes = native ? ['auto', '1024x1024', '1536x1024', '1024x1536', '256x256', '512x512', '1792x1024', '1024x1792']
    : ['auto', '512x512', '1024x1024', '1536x1024', '1024x1536', '2048x2048'];
  return <>
    <label><span>{t('Image size')}</span><input placeholder={t('Default')} list={id} value={value ?? ''}
      pattern="auto|[1-9][0-9]{0,4}x[1-9][0-9]{0,4}" onChange={event => onChange(event.currentTarget.value || undefined)} /></label>
    <datalist id={id}>{sizes.map(size => <option key={size} value={size} />)}</datalist>
  </>;
}

type ProviderFormProps = {
  models: readonly ChatModel[]; route: GatewayImageEndpoint; options: ImageJsonObject;
  setOption: (key: string, value: ImageJsonObject[string]) => void;
  value: ImagePreferences; setGeneral: <K extends keyof ImagePreferences>(key: K, next: ImagePreferences[K]) => void;
};
const stringOption = (value: ImageJsonObject[string]) => typeof value === 'string' ? value : undefined;
const numberOption = (value: ImageJsonObject[string]) => typeof value === 'number' ? value : undefined;
const objectOption = (value: ImageJsonObject[string]) => value && typeof value === 'object' && !Array.isArray(value) ? value as ImageJsonObject : undefined;

function imageOptionFields({ options, setOption }: ProviderFormProps) {
  return {
    choice: (key: string, label: string, choices: string[]) => <ChoiceField label={label} value={stringOption(options[key])} choices={choices} onChange={next => setOption(key, next)} />,
    number: (key: string, label: string, min: number, max: number) => <NumberField label={label} value={numberOption(options[key])} min={min} max={max} onChange={next => setOption(key, next)} />,
  };
}

function RouterImageFields(props: ProviderFormProps) {
  const { t } = useAppTranslation();
  const { choice, number } = imageOptionFields(props);
  return <section className="chat-tool-card"><h3>{t('Output')}</h3><div className="image-settings-fields">
    {choice('output_format', 'Output format', ['png', 'jpeg', 'webp', 'gif', 'svg'])}
    {choice('quality', 'Quality', ['auto', 'low', 'medium', 'high', 'xhigh', 'max'])}
    {choice('background', 'Background', ['auto', 'transparent', 'opaque'])}
    {(props.options.output_format === 'jpeg' || props.options.output_format === 'webp') && number('output_compression', 'Output compression', 0, 100)}
  </div></section>;
}

function OpenAIImageFields(props: ProviderFormProps) {
  const { t } = useAppTranslation();
  const { models, route, options, setOption, value, setGeneral } = props;
  const { choice, number } = imageOptionFields(props);
  const native = route !== '/api/images';
  const modern = !models.length || models.some(({ id }) => !isDallE(id));
  const editing = native ? route === '/v1/images/edits' : models.some(({ id }) => !isDallE(id) && canEditImage(route, id));
  const fidelities = !models.length ? ['low', 'high'] : [...new Set(models.flatMap(({ id }) => openAIInputFidelities(id)))];
  const dallE3 = route !== '/v1/images/edits' && models.some(({ id }) => id === 'openai/dall-e-3');
  const svg = objectOption(options.svg);
  const reasoning = objectOption(svg?.reasoning);
  function setSvg(next: ImageJsonObject) {
    setOption('svg', Object.values(next).some(field => field !== undefined) ? next : undefined);
  }
  return <>
    {native && <section className="chat-tool-card"><h3>{t('Image size')}</h3><div className="image-settings-fields">
      <ImageSizeField native value={value.native.size} onChange={size => setGeneral('native', { ...value.native, size })} />
      <NumberField label="Number of images" value={value.native.n} onChange={n => setGeneral('native', { ...value.native, n })} min={1} max={maxNativeImageCount} required />
    </div></section>}
    {modern && <>
      <section className="chat-tool-card">
        <h3>{t('Output')}</h3>
        <div className="image-settings-fields">
          {choice('output_format', 'Output format', ['png', 'jpeg', 'webp', 'gif', 'svg'])}
          {choice('quality', 'Quality', ['auto', 'low', 'medium', 'high', 'xhigh', 'max'])}
          {choice('background', 'Background', ['auto', 'transparent', 'opaque'])}
          {choice('moderation', 'Moderation', ['auto', 'low'])}
          {choice('complexity', 'Complexity', ['low', 'medium', 'high'])}
          {(options.output_format === 'jpeg' || options.output_format === 'webp') && number('output_compression', 'Output compression', 0, 100)}
          {editing && fidelities.length > 0 && choice('input_fidelity', 'Input fidelity', fidelities)}
        </div>
      </section>
      {options.output_format === 'gif' && <section className="chat-tool-card"><h3>GIF</h3><div className="image-settings-fields">
        {number('frame_count', 'Frame count', 2, 16)}
        {number('frame_duration_ms', 'Frame duration (ms)', 20, 2147483647)}
      </div></section>}
      {options.output_format === 'svg' && <section className="chat-tool-card"><h3>SVG</h3>
        <div className="image-settings-fields">
          <label><span>{t('SVG model')}</span><input value={stringOption(svg?.model) ?? ''} required={route === '/v1/images/generations' && !!reasoning}
            onChange={event => setSvg({ ...svg, model: event.currentTarget.value || undefined })} /></label>
          <ChoiceField label="Reasoning effort" value={stringOption(reasoning?.effort)} choices={['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']}
            onChange={effort => {
              const next = { ...reasoning, effort };
              setSvg({ ...svg, reasoning: Object.values(next).some(field => field !== undefined) ? next : undefined });
            }} />
        </div>
      </section>}
      {editing && <section className="chat-tool-card" aria-label={t('Markup')}>
        <h3>{t('Markup')}</h3>
        <ImageFileField label={t('Markup image')} value={value.markup} onChange={markup => setGeneral('markup', markup)} />
      </section>}
    </>}
    {dallE3 && <section className="chat-tool-card"><h3>DALL·E 3</h3><div className="image-settings-fields">
      <ChoiceField label="Quality" value={value.dallE3Quality} choices={['standard', 'hd']} onChange={quality => setGeneral('dallE3Quality', quality)} />
      {choice('style', 'Style', ['vivid', 'natural'])}
    </div></section>}
  </>;
}

const providerForms: Record<string, ComponentType<ProviderFormProps>> = {
  openai: OpenAIImageFields,
  imagerouter: RouterImageFields,
  openrouter: RouterImageFields,
};

export function ImageSettingsDialog({ initial, onSave, onClose, models, route, references }: {
  initial: ImagePreferences; onSave: (value: ImagePreferences) => void; onClose: () => void;
  models: readonly ChatModel[]; route: GatewayImageEndpoint; references: number;
}) {
  const { t } = useAppTranslation();
  const id = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  useLayoutEffect(() => { if (dialog.current && !dialog.current.open) dialog.current.showModal(); }, []);
  const [selectedTab, setTab] = useState('general');
  const [value, setValue] = useState(initial);
  const vercel = route === '/api/images';
  const providerTabs = Object.entries(providerForms).flatMap(([provider, Form]) => {
    if (!vercel && provider === 'openai') return [];
    const selected = models.filter(model => model.provider === provider);
    return selected.length ? [{ provider, Form, models: selected }] : [];
  });
  const tab = providerTabs.some(({ provider }) => provider === selectedTab) ? selectedTab : 'general';
  const allowMask = route !== '/v1/images/generations';
  const maskIssue = value.mask && imageMaskIssue(route, models, references);
  const setGeneral = <K extends keyof ImagePreferences>(key: K, next: ImagePreferences[K]) => setValue(current => ({ ...current, [key]: next }));
  const maskField = (allowMask || value.mask) && <ImageFileField label={t('Edit mask')} value={value.mask}
    onChange={mask => setGeneral('mask', mask)} removeOnly={!allowMask} />;
  const maskNotice = maskIssue && <p className="chat-attachment-notice" role="status">{t(maskIssue)}</p>;
  const renderProvider = ({ provider, Form, models }: { provider: string; Form: ComponentType<ProviderFormProps>; models: readonly ChatModel[] }) => <Form key={provider} models={models} route={route}
    value={value} setGeneral={setGeneral} options={value.byProvider[provider] ?? {}}
    setOption={(key, next) => setValue(current => ({ ...current,
      byProvider: { ...current.byProvider, [provider]: { ...current.byProvider[provider], [key]: next } },
    }))} />;
  return <dialog ref={dialog} className="chat-settings chat-tools-dialog image-settings-dialog" aria-labelledby={`${id}-title`} onClose={onClose}>
    <form onSubmit={event => { event.preventDefault(); onSave(value); dialog.current?.close(); }}>
      <header className="chat-settings-header">
        <h2 id={`${id}-title`}>{t('Image settings')}</h2>
        <Button type="button" className="chat-close" variant="subtle" aria-label={t('Close')} onClick={() => dialog.current?.close()}><ChatIcon name="close" /></Button>
      </header>
      <DialogTabs id={id} label={t('Image settings sections')} tabs={[
        ['general', t('General')], ...providerTabs.map(({ provider }) => [provider, providerName(provider)] as const),
      ]} value={tab} onChange={setTab} />
      <div id={`${id}-general-panel`} role="tabpanel" aria-labelledby={`${id}-general-tab`} hidden={tab !== 'general'} onInvalid={() => setTab('general')}>
        {vercel ? <><section className="chat-tool-card">
          <h3>{t('Size and aspect ratio')}</h3>
          <div className="image-settings-fields">
            <ImageSizeField value={value.size} onChange={size => setGeneral('size', size)} />
            <label><span>{t('Aspect ratio')}</span><input placeholder={t('Default')} list={`${id}-ratios`} value={value.aspectRatio ?? ''}
              pattern="[1-9][0-9]{0,3}:[1-9][0-9]{0,3}" onChange={event => setGeneral('aspectRatio', event.currentTarget.value || undefined)} /></label>
            <datalist id={`${id}-ratios`}>{['1:1', '16:9', '9:16', '4:3', '3:4', '3:2', '2:3', '21:9'].map(ratio => <option key={ratio} value={ratio} />)}</datalist>
          </div>
        </section>
        <section className="chat-tool-card">
          <h3>{t('Output')}</h3>
          <div className="image-settings-fields">
            <NumberField label="Number of images" value={value.n} onChange={n => setGeneral('n', n)} min={1} max={maxImageCount} required />
            <NumberField label="Max images per call" value={value.maxImagesPerCall} onChange={count => setGeneral('maxImagesPerCall', count)} min={1} max={maxImageCount} />
          </div>
        </section>
        <section className="chat-tool-card" aria-label={t('Other')}>
          <h3>{t('Other')}</h3>
          <div className="image-settings-fields">
            <NumberField label="Seed" value={value.seed} onChange={seed => setGeneral('seed', seed)} min={-2147483648} max={2147483647} />
            {maskField}
          </div>
          {maskNotice}
        </section></> : <>
          {renderProvider({ provider: 'openai', Form: OpenAIImageFields, models })}
          {maskField && <section className="chat-tool-card">{maskField}{maskNotice}</section>}
        </>}
      </div>
      {providerTabs.map(section => <div key={section.provider} id={`${id}-${section.provider}-panel`} role="tabpanel"
        aria-labelledby={`${id}-${section.provider}-tab`} hidden={tab !== section.provider} onInvalid={() => setTab(section.provider)}>
        {renderProvider(section)}
      </div>)}
      <footer className="chat-tool-footer">
        <Button type="button" variant="subtle" onClick={() => { setValue(defaultImagePreferences); setTab('general'); }}>{t('Restore defaults')}</Button>
        <Button type="button" variant="subtle" onClick={() => dialog.current?.close()}>{t('Cancel')}</Button>
        <Button type="submit" variant="primary" aria-label={t('Save image settings')}>{t('Save')}</Button>
      </footer>
    </form>
  </dialog>;
}
