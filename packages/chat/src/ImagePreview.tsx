import { imageSource } from '@streaik/gateway';
import type { ImageResponse } from '@streaik/gateway';
import { Button } from '@streaik/themes';
import { useEffect, useId, useRef, useState } from 'react';
import { ChatIcon } from './ChatIcon';
import { DialogTabs } from './DialogTabs';
import { browserNumberFormat, useAppTranslation } from './i18n';

const costFormat = browserNumberFormat({ minimumFractionDigits: 2, maximumFractionDigits: 8 });

function imageDetails({ response, providerMetadata, images }: ImageResponse) {
  const gateway = providerMetadata?.gateway;
  const cost = gateway && typeof gateway === 'object' && 'cost' in gateway ? gateway.cost : undefined;
  return {
    model: response.modelId?.trim(),
    amount: typeof cost === 'number' && Number.isFinite(cost) && cost >= 0 ? costFormat.format(cost) : undefined,
    batch: images.length > 1,
  };
}

export function ImageBadges({ response }: { response: ImageResponse }) {
  const { t } = useAppTranslation();
  const { model, amount, batch } = imageDetails(response);
  if (!model && !amount) return null;
  return <span className="image-badges" aria-hidden="true">
    {model && <span className="chat-badge" title={model}><ChatIcon name="models" /><span>{model}</span></span>}
    {amount && <span className="chat-badge" title={t(batch ? 'Batch cost' : 'Gateway cost')}><ChatIcon name="cost" />
      <span>{batch ? t('Batch: {{amount}}', { amount }) : amount}</span></span>}
  </span>;
}

export function ImagePreview({ image, response, onClose }: { image: string; response: ImageResponse; onClose: () => void }) {
  const { t } = useAppTranslation();
  const id = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const [tab, setTab] = useState<'preview' | 'headers'>('preview');
  const { model, amount, batch } = imageDetails(response);
  const timestamp = new Date(response.response.timestamp);
  const rawHeaders = response.response.headers;
  const headers = rawHeaders && typeof rawHeaders === 'object' && !Array.isArray(rawHeaders)
    ? Object.entries(rawHeaders).filter(([, value]) => typeof value === 'string') : [];

  useEffect(() => { if (dialog.current && !dialog.current.open) dialog.current.showModal(); }, []);

  return <dialog ref={dialog} className="chat-settings image-preview-dialog" aria-labelledby={`${id}-title`} onClose={onClose}>
    <header className="chat-settings-header"><h2 id={`${id}-title`}>{t('Image preview')}</h2>
      <Button type="button" variant="subtle" className="chat-close" aria-label={t('Close')} onClick={() => dialog.current?.close()}>
        <ChatIcon name="close" />
      </Button>
    </header>
    <DialogTabs id={id} label={t('Image preview')} tabs={[
      ['preview', t('Preview')], ['headers', t('Response headers')],
    ]} value={tab} onChange={setTab} />
    <div id={`${id}-preview-panel`} aria-labelledby={`${id}-preview-tab`} role="tabpanel" tabIndex={0} hidden={tab !== 'preview'}>
      <img src={imageSource(image)} alt={t('Generated image')} />
      <dl className="image-preview-details">
        {model && <><dt>{t('Model')}</dt><dd>{model}</dd></>}
        {Number.isFinite(timestamp.getTime()) && <><dt>{t('Generated at')}</dt><dd><time dateTime={timestamp.toISOString()}>{timestamp.toLocaleString()}</time></dd></>}
        {amount && <><dt>{t(batch ? 'Batch cost' : 'Gateway cost')}</dt><dd>{amount}</dd></>}
      </dl>
    </div>
    <div id={`${id}-headers-panel`} aria-labelledby={`${id}-headers-tab`} role="tabpanel" tabIndex={0} hidden={tab !== 'headers'}>
      {headers.length ? <dl className="image-preview-details image-response-headers">
        {headers.map(([name, value]) => <div key={name}><dt>{name}</dt><dd>{value}</dd></div>)}
      </dl> : <p>{t('No response headers were recorded.')}</p>}
    </div>
  </dialog>;
}
