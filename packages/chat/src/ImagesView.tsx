import { GatewayError, imageBatchSizes, imageSource, maxImageCount } from '@streaik/gateway';
import type { CatalogModel, Gateway, GatewayImageEndpoint } from '@streaik/gateway';
import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { assignedAgent } from './agentCatalog';
import { useAgents } from './AgentsProvider';
import { ChatComposer } from './ChatComposer';
import type { DraftAttachment } from './chatAttachments';
import type { ComposerDictation } from './composerDictation';
import { listImages, saveImage } from './imageLibrary';
import type { ImageItem } from './imageLibrary';
import { imageOptionsForModel, readImagePreferences, writeImagePreferences } from './imagePreferences';
import { canEditImage, canMaskImage, imageMaskIssue } from './imageRoute';
import { ImageBadges, ImagePreview } from './ImagePreview';
import { ImageSettingsDialog } from './ImageSettingsDialog';
import { ModelPicker } from './ModelPicker';
import { defaultAgentModelIds, resolveModelSelection } from './modelSelection';
import type { ModelRouter } from './modelDecisions';
import { useAppTranslation } from './i18n';
import './images.css';

function imageWarningMessage(warning: unknown) {
  if (typeof warning === 'string') return warning.trim();
  if (!warning || typeof warning !== 'object') return '';
  const { message, details, type, feature } = warning as Record<string, unknown>;
  if (typeof message === 'string' && message.trim()) return message.trim();
  const detail = typeof details === 'string' ? details.trim() : '';
  return typeof type === 'string' && typeof feature === 'string' ? `${type}: ${feature}. ${detail}`.trim() : detail;
}

export default function ImagesView({ gateway, scope, route, toolbar, catalog, loading: loadingModels, router, status, dictation }: {
  gateway: Gateway; scope?: string; route: GatewayImageEndpoint; toolbar: HTMLDivElement | null;
  catalog?: readonly CatalogModel[]; loading: boolean; router?: ModelRouter; status?: string; dictation: ComposerDictation;
}) {
  const { t } = useAppTranslation();
  const agent = assignedAgent(useAgents(), 'image');
  const heading = useId();
  const [selectedIds, setSelectedIds] = useState<string[]>();
  const [draft, setDraft] = useState<{ prompt: string; attachments: DraftAttachment[] }>({ prompt: '', attachments: [] });
  const [items, setItems] = useState<ImageItem[]>([]);
  const [preview, setPreview] = useState<{ image: string; response: ImageItem['imageResponse'] }>();
  const [phase, setPhase] = useState<'choosing' | 'generating'>();
  const [pendingImages, setPendingImages] = useState(0);
  const [settings, setSettings] = useState(() => readImagePreferences(scope));
  const [showSettings, setShowSettings] = useState(false);
  const [loading, setLoading] = useState(!!scope);
  const [historyError, setHistoryError] = useState(false);
  const [error, setError] = useState('');
  const [warnings, setWarnings] = useState<string[]>([]);
  const running = useRef<AbortController>(null);
  const models = catalog?.filter(({ type }) => type === 'image') ?? [];
  const { selected } = resolveModelSelection(models, selectedIds, !!router, defaultAgentModelIds(agent));
  const references = draft.attachments.length;
  const vercel = route === '/api/images';
  const general = vercel ? settings : settings.native;
  const count = general.n ?? 1;
  const edit = route === '/v1/images/edits' || references > 0 || !!settings.mask;
  const eligible = edit ? selected.filter(({ id }) => canEditImage(route, id)) : selected;
  const candidates = settings.mask ? eligible.filter(model => canMaskImage(route, model)) : eligible;
  const maskIssue = settings.mask ? imageMaskIssue(route, selected, references) : '';
  const routeIssue = maskIssue || (route === '/v1/images/generations' && references ? 'Remove attachments or choose an image edit route.'
    : edit && selected.length && !eligible.length ? 'This model does not support image editing.'
    : route === '/v1/images/edits' && !references ? 'Add a reference image to edit.' : '');
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
    setWarnings([]);
    try {
      let model = candidates[0];
      if (decision) {
        const { endpoint, ...agent } = decision;
        // Route on the prompt and request shape, not reference URLs or file contents.
        const input = JSON.stringify({ prompt, operation: edit ? 'edit' : 'generate', route, references, mask: !!settings.mask,
          size: general.size, aspectRatio: vercel ? settings.aspectRatio : undefined, count });
        const choices = candidates.map(({ id, name, provider, description, tags }) => ({ value: id,
          description: JSON.stringify({ name, provider, description, tags, supportsEditing: canEditImage(route, id) }) }));
        const winner = await gateway.decideChoice(endpoint, { ...agent, input, choices }, controller.signal);
        controller.signal.throwIfAborted();
        const chosen = candidates.find(({ id }) => id === winner);
        if (!chosen) throw new GatewayError('Decisions did not return one of the selected models.');
        model = chosen;
        setPhase('generating');
      }
      const batches = vercel ? imageBatchSizes(model.id, count, settings.maxImagesPerCall ?? maxImageCount) : [count];
      const request = { ...imageOptionsForModel(route, model, settings, edit), model: model.id, prompt, inputs: draft.attachments, mask: settings.mask };
      setPendingImages(count);
      // Process sequentially so providers with a one-image limit don't receive a burst of requests.
      // Save each completed batch, even if a later batch is stopped or fails.
      for (const n of batches) {
        controller.signal.throwIfAborted();
        const imageResponse = await gateway.generateImages(route, { ...request, n }, controller.signal);
        controller.signal.throwIfAborted();
        const messages = imageResponse.warnings.map(imageWarningMessage).filter(Boolean);
        if (messages.length) setWarnings(current => [...new Set([...current, ...messages])]);
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
      <ChatComposer busy={busy} canSend={canSend} onStop={() => running.current?.abort()} dictation={dictation}
        image={{ draft, onChange: setDraft, onSettings: () => setShowSettings(true), onSend: () => { void generate(); } }} />
      {status && <p className="chat-attachment-notice" role="status">{status}</p>}
      {!status && routeIssue && !busy && <p className="chat-attachment-notice" role="status">{t(routeIssue)}</p>}
      {phase && <span className="images-progress" role="status">{t(phase === 'choosing' ? 'Choosing a model…' : 'Generating images…')}</span>}
      {error && <p className="chat-attachment-notice" role="alert">{t(error)}</p>}
      {warnings.map(message => <p key={message} className="chat-attachment-notice" role="status">{message}</p>)}
      <section className="images-library" aria-labelledby={`${heading}-library`}>
        <h2 id={`${heading}-library`}>{t('My images')}</h2>
        {loading && <p className="chat-attachment-notice" role="status">{t('Loading images…')}</p>}
        {historyError && <p className="chat-attachment-notice" role="alert">{t('Could not load saved images.')}</p>}
        {(entries.length > 0 || pendingImages > 0) && <ul className="images-grid">
          {Array.from({ length: pendingImages }, (_, index) => <li className="image-tile image-shimmer" aria-hidden="true" key={`pending:${index}`} />)}
          {entries.flatMap(({ id, imageResponse }) => imageResponse.images.map((image, index) => <li className="image-tile" key={`${id}:${index}`}>
            <button type="button" className="image-tile-button" aria-haspopup="dialog" aria-label={t('Open image preview')}
              onClick={event => { event.currentTarget.focus(); setPreview({ image, response: imageResponse }); }}>
              <img src={imageSource(image)} alt={t('Generated image')} loading="lazy" decoding="async" />
              <ImageBadges response={imageResponse} />
            </button>
          </li>))}
        </ul>}
      </section>
    </div>
    {showSettings && <ImageSettingsDialog initial={settings} models={selected} route={route} references={references}
      onSave={next => { setSettings(next); writeImagePreferences(scope, next); }} onClose={() => setShowSettings(false)} />}
    {preview && <ImagePreview image={preview.image} response={preview.response} onClose={() => setPreview(undefined)} />}
  </main>;
}
