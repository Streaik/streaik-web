import { GatewayError, imageBatchSizes, imageSource, maxImageCount } from '@streaik/gateway';
import type { CatalogModel, Gateway, GatewayImageEndpoint } from '@streaik/gateway';
import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChatComposer } from './ChatComposer';
import type { DraftAttachment } from './chatAttachments';
import { listImages, saveImage } from './imageLibrary';
import type { ImageItem } from './imageLibrary';
import { canEditImage } from './imageRoute';
import { ImageSettingsDialog, imageSettingSupport, readImagePreferences, writeImagePreferences } from './ImageSettingsDialog';
import { ModelPicker, resolveModelSelection } from './ModelPicker';
import type { ModelRouter } from './modelDecisions';
import { useAppTranslation } from './i18n';
import './images.css';

export default function ImagesView({ gateway, scope, route, toolbar, catalog, loading: loadingModels, router, status }: {
  gateway: Gateway; scope?: string; route: GatewayImageEndpoint; toolbar: HTMLDivElement | null;
  catalog?: readonly CatalogModel[]; loading: boolean; router?: ModelRouter; status?: string;
}) {
  const { t } = useAppTranslation();
  const heading = useId();
  const [selectedIds, setSelectedIds] = useState<string[]>();
  const [draft, setDraft] = useState<{ prompt: string; attachments: DraftAttachment[] }>({ prompt: '', attachments: [] });
  const [items, setItems] = useState<ImageItem[]>([]);
  const [phase, setPhase] = useState<'choosing' | 'generating'>();
  const [pendingImages, setPendingImages] = useState(0);
  const [settings, setSettings] = useState(() => readImagePreferences(scope));
  const [showSettings, setShowSettings] = useState(false);
  const [loading, setLoading] = useState(!!scope);
  const [historyError, setHistoryError] = useState(false);
  const [error, setError] = useState('');
  const running = useRef<AbortController>(null);
  const models = catalog?.filter(({ type }) => type === 'image') ?? [];
  const { selected } = resolveModelSelection(models, selectedIds, !!router);
  const references = draft.attachments.length;
  const edit = route === '/v1/images/edits' || references > 0;
  const eligible = edit ? selected.filter(({ id }) => canEditImage(route, id)) : selected;
  const maskCandidates = settings.mask ? eligible.filter(({ id, provider }) => canEditImage(route, id) && imageSettingSupport(provider, id).mask) : [];
  // If a mask applies to this selection, don't route the request to a model that would drop it.
  const candidates = maskCandidates.length ? maskCandidates : eligible;
  const routeIssue = route === '/v1/images/generations' && references ? 'Remove attachments or choose an image edit route.'
    : edit && selected.length && !eligible.length ? 'This model does not support image editing.'
    : route === '/v1/images/edits' && !references ? 'Add a reference image to edit.'
    : maskCandidates.length && !references ? 'A mask requires a reference image.' : '';
  const busy = !!phase;
  const canSend = candidates.length > 0 && !routeIssue && !status;

  useEffect(() => {
    let live = true;
    if (scope) void listImages(scope).then(records => {
      if (!live) return;
      setItems(current => [...current, ...records.filter(item => !current.some(existing => existing.id === item.id))]);
      setLoading(false);
    }, () => {
      if (!live) return;
      setHistoryError(true);
      setLoading(false);
    });
    return () => { live = false; running.current?.abort(); };
  }, [scope]);

  async function generate() {
    const prompt = draft.prompt.trim();
    if (!canSend || !prompt || running.current) return;
    const decision = router && candidates.length > 1 ? router : undefined;
    const controller = new AbortController();
    running.current = controller;
    setPhase(decision ? 'choosing' : 'generating');
    setError('');
    try {
      let model = candidates[0];
      if (decision) {
        const { endpoint, ...agent } = decision;
        // Route on the prompt and request shape, not reference URLs or file contents.
        const input = JSON.stringify({ prompt, operation: edit ? 'edit' : 'generate', route, references, mask: maskCandidates.length > 0,
          size: settings.size, aspectRatio: settings.aspectRatio, count: settings.n ?? 1 });
        const choices = candidates.map(({ id, name, provider, description, tags }) => ({ value: id,
          description: JSON.stringify({ name, provider, description, tags, supportsEditing: canEditImage(route, id) }) }));
        const winner = await gateway.decideChoice(endpoint, { ...agent, input, choices }, controller.signal);
        controller.signal.throwIfAborted();
        const chosen = candidates.find(({ id }) => id === winner);
        if (!chosen) throw new GatewayError('Decisions did not return one of the selected models.');
        model = chosen;
        setPhase('generating');
      }
      const provider = model.provider;
      const support = imageSettingSupport(provider, model.id);
      const canEdit = canEditImage(route, model.id);
      const mask = canEdit && support.mask ? settings.mask : undefined;
      const count = settings.n ?? 1;
      const batches = imageBatchSizes(model.id, count, settings.maxImagesPerCall ?? maxImageCount);
      const saved = settings.byProvider[provider] ?? {};
      const providerOptions = support.legacy ? {
        quality: model.id === 'openai/dall-e-3' && ['standard', 'hd'].includes(saved.quality ?? '') ? saved.quality : undefined,
        style: model.id === 'openai/dall-e-3' ? saved.style : undefined,
      } : { ...saved, quality: ['standard', 'hd'].includes(saved.quality ?? '') ? undefined : saved.quality, style: undefined,
        output_compression: ['jpeg', 'webp'].includes(saved.output_format ?? '') ? saved.output_compression : undefined };
      const request = { model: model.id, prompt, inputs: draft.attachments, mask,
        markup: canEdit && provider === 'openai' && !support.legacy ? settings.markup : undefined,
        size: settings.size, aspectRatio: support.aspectRatio ? settings.aspectRatio : undefined,
        seed: support.seed ? settings.seed : undefined, providerOptions };
      setPendingImages(count);
      // Process sequentially so providers with a one-image limit don't receive a burst of requests.
      // Save each completed batch, even if a later batch is stopped or fails.
      for (const n of batches) {
        controller.signal.throwIfAborted();
        const imageResponse = await gateway.generateImages(route, { ...request, n }, controller.signal);
        controller.signal.throwIfAborted();
        const item = { id: crypto.randomUUID(), imageResponse };
        setItems(current => [item, ...current]);
        setPendingImages(pending => pending - n);
        if (scope) try { await saveImage(scope, item); } catch {
          if (!controller.signal.aborted) setError('Could not save the generated images.');
        }
      }
      controller.signal.throwIfAborted();
      setDraft({ prompt: '', attachments: [] });
    } catch (cause) {
      if (!controller.signal.aborted) setError(cause instanceof GatewayError ? cause.message : 'Could not generate images.');
    } finally {
      if (running.current === controller) {
        running.current = null;
        setPendingImages(0);
        setPhase(undefined);
      }
    }
  }

  const entries = [...items].sort((a, b) => Date.parse(b.imageResponse.response.timestamp) - Date.parse(a.imageResponse.response.timestamp));
  return <main className="catalog-main images-main" aria-labelledby={heading}>
    {toolbar && createPortal(<ModelPicker models={models} selected={selected} multiple={!!router} loading={loadingModels}
      disabled={busy} onChange={setSelectedIds} />, toolbar)}
    <div className="images-content">
      <h1 id={heading}>{t('Images')}</h1>
      <ChatComposer busy={busy} canSend={canSend} onStop={() => running.current?.abort()}
        image={{ draft, onChange: setDraft, onSettings: () => setShowSettings(true), onSend: () => { void generate(); } }} />
      {status && <p className="chat-attachment-notice" role="status">{status}</p>}
      {!status && routeIssue && !busy && <p className="chat-attachment-notice" role="status">{t(routeIssue)}</p>}
      {phase && <span className="images-progress" role="status">{t(phase === 'choosing' ? 'Choosing a model…' : 'Generating images…')}</span>}
      {error && <p className="chat-attachment-notice" role="alert">{t(error)}</p>}
      <section className="images-library" aria-labelledby={`${heading}-library`}>
        <h2 id={`${heading}-library`}>{t('My images')}</h2>
        {loading && <p className="chat-attachment-notice" role="status">{t('Loading images…')}</p>}
        {historyError && <p className="chat-attachment-notice" role="alert">{t('Could not load saved images.')}</p>}
        {(entries.length > 0 || pendingImages > 0) && <ul className="images-grid">
          {Array.from({ length: pendingImages }, (_, index) => <li className="image-tile image-shimmer" aria-hidden="true" key={`pending:${index}`} />)}
          {entries.flatMap(({ id, imageResponse }) => imageResponse.images.map((image, index) => <li className="image-tile" key={`${id}:${index}`}>
            <img src={imageSource(image)} alt={t('Generated image')} loading="lazy" decoding="async" />
          </li>))}
        </ul>}
      </section>
    </div>
    {showSettings && <ImageSettingsDialog initial={settings} models={selected} route={route}
      onSave={next => { setSettings(next); writeImagePreferences(scope, next); }} onClose={() => setShowSettings(false)} />}
  </main>;
}
