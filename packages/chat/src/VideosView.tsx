import { GatewayError } from '@streaik/gateway';
import type { CatalogModel, Gateway, VideoAsset, VideoStatus } from '@streaik/gateway';
import { useEffect, useId, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChatComposer } from './ChatComposer';
import { useAppTranslation } from './i18n';
import { ModelPicker, resolveModelSelection } from './ModelPicker';
import type { useVideoJobs } from './useVideoJobs';
import type { FinishedVideoJob, PendingVideoJob } from './videoLibrary';
import './images.css';
import './videos.css';

const pollIntervalMs = 10_000;

function PendingVideo({ gateway, job, ready, finish }: {
  gateway: Gateway; job: PendingVideoJob; ready: boolean; finish: (job: FinishedVideoJob) => Promise<void>;
}) {
  const { t } = useAppTranslation();
  const [notice, setNotice] = useState('');

  useEffect(() => {
    if (!ready) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    async function poll() {
      let result: VideoStatus | undefined;
      try {
        result = await gateway.getVideoStatus(job.operation, AbortSignal.any([controller.signal, AbortSignal.timeout(60_000)]));
        if (controller.signal.aborted) return;
        setNotice('');
      } catch (error) {
        if (controller.signal.aborted) return;
        if (error instanceof GatewayError && error.httpStatus === 404) {
          result = { status: 'error', error: 'This video job is no longer available.' };
        } else setNotice('Could not check video status. Retrying…');
      }
      if (result && result.status !== 'pending') {
        const { id, model, prompt, startedAt } = job;
        await finish({ id, model, prompt, startedAt, ...result });
        return;
      }
      // Wait until the previous request has settled before scheduling another.
      timer = setTimeout(() => { void poll(); }, pollIntervalMs);
    }
    void poll();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [gateway, job, ready, finish]);

  return <>
    <div className="video-preview image-shimmer" aria-hidden="true" />
    <p role="status">{t(!ready ? 'Waiting for the gateway…' : notice || 'Generating video…')}</p>
  </>;
}

function VideoPlayer({ video }: { video: VideoAsset }) {
  const { t } = useAppTranslation();
  const [objectUrl, setObjectUrl] = useState<string>();
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (video.type !== 'file') return;
    const url = URL.createObjectURL(video.blob);
    setObjectUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [video]);
  const src = video.type === 'url' ? video.url : objectUrl;
  return <>
    {src && <video className="video-preview" controls playsInline preload="metadata" src={src} aria-label={t('Generated video')}
      onError={() => setFailed(true)} />}
    {failed && <p role="alert">{t('Could not play this video.')}</p>}
  </>;
}

export default function VideosView({ gateway, library, toolbar, catalog, loading: loadingModels, ready, status }: {
  gateway: Gateway; library: ReturnType<typeof useVideoJobs>; toolbar: HTMLDivElement | null;
  catalog?: readonly CatalogModel[]; loading: boolean; ready: boolean; status?: string;
}) {
  const { t } = useAppTranslation();
  const heading = useId();
  const [prompt, setPrompt] = useState('');
  const [selectedIds, setSelectedIds] = useState<string[]>();
  const models = catalog?.filter(({ type }) => type === 'video') ?? [];
  const { selected } = resolveModelSelection(models, selectedIds, false);
  const model = selected[0];
  const canSend = ready && !status && !!model && !library.loading;

  async function generate() {
    const text = prompt.trim();
    if (!canSend || !text || !model) return;
    if (await library.start({ model: model.id, prompt: text })) setPrompt('');
  }

  return <main className="catalog-main videos-main" aria-labelledby={heading}>
    {toolbar && createPortal(<ModelPicker models={models} selected={selected} multiple={false} loading={loadingModels}
      disabled={library.busy} onChange={setSelectedIds} />, toolbar)}
    <div className="images-content">
      <h1 id={heading}>{t('Videos')}</h1>
      <ChatComposer busy={library.busy} canSend={canSend} video={{ prompt, onChange: setPrompt, onSend: () => { void generate(); } }} />
      {status && <p className="chat-attachment-notice" role="status">{status}</p>}
      {!status && !models.length && <p className="chat-attachment-notice" role="status">{t('No video models are available.')}</p>}
      {library.startError && <p className="chat-attachment-notice" role="alert">{t(library.startError)}</p>}
      <section className="images-library" aria-labelledby={`${heading}-library`}>
        <h2 id={`${heading}-library`}>{t('My videos')}</h2>
        {library.loading && <p role="status">{t('Loading videos…')}</p>}
        {library.storageError && <p className="chat-attachment-notice" role="alert">{t(library.storageError)}</p>}
        {!library.loading && !library.busy && !library.jobs.length && <p>{t('No videos yet.')}</p>}
        {(library.busy || library.jobs.length > 0) && <ul className="videos-grid">
          {library.busy && <li className="video-tile"><div className="video-preview image-shimmer" aria-hidden="true" />
            <p role="status">{t('Starting video generation…')}</p></li>}
          {library.jobs.map(job => <li className="video-tile" key={job.id}>
            {job.status === 'pending' ? <PendingVideo gateway={gateway} job={job} ready={ready} finish={library.finish} />
              : job.status === 'completed' ? job.videos.map((video, index) => <VideoPlayer video={video} key={index} />)
                : <p role="alert">{t(job.error)}</p>}
            <p className="video-tile-prompt">{job.prompt}</p>
          </li>)}
        </ul>}
      </section>
    </div>
  </main>;
}
