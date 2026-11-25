import * as Menu from '@radix-ui/react-dropdown-menu';
import { GatewayError, isLiveTranscriptionModel, supportsFileTranscription, transcriptionFileAccept, transcriptionMediaType, transcriptionUploadLimit, usesTranscriptionWebSocket } from '@streaik/gateway';
import type { CatalogModel, Gateway, GatewayTranscriptionEndpoint, Transcript } from '@streaik/gateway';
import { Button, Tooltip } from '@streaik/themes';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { assignedAgent } from './agentCatalog';
import { useAgents } from './AgentsProvider';
import { ChatIcon } from './ChatIcon';
import { ModelPicker } from './ModelPicker';
import { defaultAgentModelIds, resolveModelSelection } from './modelSelection';
import { browserNumberFormat, useAppTranslation } from './i18n';
import { runMicrophone } from './liveTranscription';
import { dictationFormat, recordDictation } from './microphone';
import { maxSplittableFileBytes, mergeTranscriptionChunks, splitTranscription } from './splitTranscription';
import { deleteTranscript, listTranscripts, saveTranscript } from './transcriptionLibrary';
import type { SavedTranscript } from './transcriptionLibrary';
import { useTranscriptionPreferences } from './transcriptionPreferences';
import { useCatalogSearch } from './useCatalogSearch';
import './images.css';
import './transcriptions.css';

type Target = { route: GatewayTranscriptionEndpoint; model: string };
type Item = { id: string; file: File; issue?: string; dictation?: Target };
type Tab = 'finished' | 'streaming';
type Phase = 'upload' | 'connecting' | 'listening' | 'finishing' | 'dictate-connecting' | 'dictating' | 'dictate-finishing';
type Preview = { name: string; text: string; partial?: string };
const errorMessage = (error: unknown, fallback: string) => error instanceof GatewayError ? error.message : fallback;
const wholeSeconds = browserNumberFormat({ maximumFractionDigits: 0 });
const segmentSeconds = browserNumberFormat({ minimumFractionDigits: 1, maximumFractionDigits: 1 });
const transcriptSearchDocument = ({ name, transcript }: SavedTranscript) => ({ title: name, text: transcript.text });

function TranscriptCard({ item, menuContainer, remove, onError }: {
  item: SavedTranscript; menuContainer: HTMLDivElement | null; remove: () => void; onError: () => void;
}) {
  const { t } = useAppTranslation();
  const [source, setSource] = useState('');
  useEffect(() => {
    if (!item.audio) return;
    const url = URL.createObjectURL(item.audio);
    setSource(url);
    return () => URL.revokeObjectURL(url);
  }, [item.audio]);
  const { transcript, name, model } = item;
  const copyLabel = t('Copy');
  const downloadLabel = t('Download');
  function download() {
    const url = URL.createObjectURL(new Blob([transcript.text], { type: 'text/plain;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `${name.replace(/\.[^.]+$/, '')}.txt`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return <article className="transcription-card">
    <header className="transcription-card-header">
      <h2>{name}</h2>
      <Menu.Root modal={false}>
        <Tooltip content={t('More actions')}><Menu.Trigger type="button" className="chat-row-button"
          aria-label={t('More actions for {{title}}', { title: name })}><ChatIcon name="moreVertical" /></Menu.Trigger></Tooltip>
        {menuContainer && <Menu.Portal container={menuContainer}>
          <Menu.Content className="chat-menu" align="end" sideOffset={4} collisionPadding={8} hideWhenDetached>
            <Menu.Item className="chat-menu-item" data-danger onSelect={remove}>
              <ChatIcon name="trash" /> {t('Delete')}
            </Menu.Item>
          </Menu.Content>
        </Menu.Portal>}
      </Menu.Root>
    </header>
    <p className="transcription-meta">{[model, transcript.language, transcript.durationInSeconds !== undefined ? `${wholeSeconds.format(transcript.durationInSeconds)} s` : undefined].filter(Boolean).join(' · ')}</p>
    {source && <audio controls preload="none" src={source} aria-label={t('Play source audio')} />}
    <div className="transcription-copy" tabIndex={0}>{transcript.text || t('No speech detected.')}</div>
    {transcript.segments.length > 0 && <details><summary>{t('Segments')}</summary><ol className="transcription-segments">
      {transcript.segments.map((segment, index) => <li key={index}>
        <strong>{segmentSeconds.format(segment.startSecond)}–{segmentSeconds.format(segment.endSecond)} s{segment.speaker ? ` · ${t('Speaker')} ${segment.speaker}` : ''}</strong> {segment.text}
      </li>)}
    </ol></details>}
    <div className="transcription-card-actions">
      <button type="button" className="chat-row-button" aria-label={copyLabel} title={copyLabel} onClick={() => {
        if (!navigator.clipboard) { onError(); return; }
        void navigator.clipboard.writeText(transcript.text).catch(onError);
      }}><ChatIcon name="copy" /></button>
      <button type="button" className="chat-row-button" aria-label={downloadLabel} title={downloadLabel} onClick={download}>
        <ChatIcon name="download" />
      </button>
    </div>
  </article>;
}

export default function TranscriptionsView({ gateway, scope, route, toolbar, menuContainer, catalog, loading, status }: {
  gateway: Gateway; scope?: string; route: GatewayTranscriptionEndpoint; toolbar: HTMLDivElement | null;
  menuContainer: HTMLDivElement | null; catalog?: readonly CatalogModel[]; loading: boolean; status?: string;
}) {
  const { t } = useAppTranslation();
  const agent = assignedAgent(useAgents(), 'transcription');
  const id = useId();
  const [settings, change] = useTranscriptionPreferences(scope);
  const [tab, setTab] = useState<Tab>('finished');
  const [queue, setQueue] = useState<Item[]>([]);
  const [items, setItems] = useState<SavedTranscript[]>([]);
  const [query, setQuery] = useState('');
  const sortedItems = useMemo(() => [...items].sort((a, b) => b.timestamp - a.timestamp), [items]);
  const { results, message: searchMessage } = useCatalogSearch(sortedItems, query, transcriptSearchDocument);
  const [preview, setPreview] = useState<Preview>();
  const [phase, setPhase] = useState<Phase>();
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState('');
  const [libraryError, setLibraryError] = useState('');
  const picker = useRef<HTMLInputElement>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const dictateWarning = useRef<HTMLDialogElement>(null);
  const skipWarning = useRef<HTMLInputElement>(null);
  const dragDepth = useRef(0);
  const operation = useRef<{ abort: AbortController; stop?: AbortController; mode: 'upload' | 'live' | 'dictate' }>(null);
  const enabled = !status && !loading;
  const fileLimit = transcriptionUploadLimit(route);
  const transcriptionModels = (catalog ?? []).filter(model => model.type === 'transcription');
  const fileModels = transcriptionModels.filter(({ id }) => supportsFileTranscription(route, id));
  const models = transcriptionModels.filter(model => fileModels.includes(model) || model.tags.includes('realtime'));
  const selectedIds = settings.model === undefined ? undefined : settings.model ? [settings.model] : [];
  const { selected } = resolveModelSelection(models, selectedIds, false, defaultAgentModelIds(agent));
  const selectedModel = selected[0];
  const fileModel = selectedModel && supportsFileTranscription(route, selectedModel.id) ? selectedModel : undefined;
  // Dictation transcribes a finished clip, even when uploaded files are set to stream.
  const dictateRoute = route === '/api/transcriptions/stream' ? '/api/transcriptions' : route;
  const dictateModel = selectedModel && supportsFileTranscription(dictateRoute, selectedModel.id) ? selectedModel : undefined;
  const taggedLive = selectedModel?.tags.includes('realtime');
  const liveModel = selectedModel && taggedLive && isLiveTranscriptionModel(selectedModel.id) ? selectedModel : undefined;
  const busy = phase !== undefined;
  const live = phase === 'connecting' || phase === 'listening' || phase === 'finishing';
  const dictating = phase === 'dictate-connecting' || phase === 'dictating' || phase === 'dictate-finishing';
  const canCapture = !!globalThis.navigator?.mediaDevices?.getUserMedia;
  const canRecord = canCapture && !!dictationFormat();
  const liveSocket = liveModel && usesTranscriptionWebSocket(liveModel.id);
  const canLive = !!liveModel && canCapture && (liveSocket
    ? typeof WebSocket !== 'undefined' && typeof AudioWorkletNode !== 'undefined' : typeof RTCPeerConnection !== 'undefined');
  const canSubmit = enabled && !busy && queue.some(item => item.dictation || fileModel);

  useEffect(() => {
    let current = true;
    if (scope) listTranscripts(scope).then(saved => {
      if (current) setItems(items => [...items, ...saved.filter(row => !items.some(item => item.id === row.id))]);
    }).catch(() => { if (current) setLibraryError('Could not load saved transcriptions.'); });
    return () => { current = false; operation.current?.abort.abort(); };
  }, [scope]);

  useEffect(() => {
    if (status && !loading) operation.current?.abort.abort();
  }, [status, loading]);

  function add(files: FileList) {
    if (operation.current) return;
    setError('');
    let rejected = false;
    const limit = settings.split ? maxSplittableFileBytes : fileLimit;
    const next = Array.from(files).flatMap(file => {
      const type = transcriptionMediaType(file);
      if (!type || !file.size || file.size > limit) { rejected = true; return []; }
      return [{ file, id: crypto.randomUUID() }];
    });
    if (rejected) setError('Some files were empty, unsupported, or too large. Enable file splitting for larger audio files.');
    setQueue(items => [...items, ...next]);
  }

  async function store(name: string, model: string, transcript: Transcript, audio?: Blob) {
    const item: SavedTranscript = { id: crypto.randomUUID(), name, model, timestamp: Date.now(), transcript, audio };
    setItems(items => [item, ...items]);
    if (scope) try { await saveTranscript(scope, item); }
    catch { setLibraryError('This transcript is available now but could not be saved on this device.'); }
  }

  async function remove(id: string) {
    try {
      if (scope) await deleteTranscript(scope, id);
      setItems(items => items.filter(item => item.id !== id));
    } catch { setLibraryError('Could not delete the saved transcript.'); }
  }

  async function transcribeFile(item: Item, target: Target, signal: AbortSignal) {
    const { file, id } = item;
    const streaming = target.route === '/api/transcriptions/stream';
    if (streaming) setPreview({ name: file.name, text: '' });
    try {
      const send = (part: File, before = '') => gateway.transcribe(target.route, target.model, part, settings, signal,
        chunk => setPreview({ name: file.name, text: [before, chunk].filter(Boolean).join(' ') }));
      let transcript: Transcript;
      const limit = transcriptionUploadLimit(target.route);
      if (!item.dictation && file.size > limit && settings.split) {
        const results: { transcript: Transcript; offset: number }[] = [];
        for await (const { file: part, offset } of splitTranscription(file, limit, settings.overlap ?? 5, signal)) {
          results.push({ transcript: await send(part, mergeTranscriptionChunks(results).text), offset });
        }
        transcript = mergeTranscriptionChunks(results);
      } else transcript = await send(file);
      signal.throwIfAborted();
      if (streaming) setPreview({ name: file.name, text: transcript.text });
      await store(file.name, target.model, transcript, file.slice(0, file.size, transcriptionMediaType(file)));
      setQueue(items => items.filter(item => item.id !== id));
    } catch (error) {
      if (signal.aborted) return;
      const issue = errorMessage(error, item.dictation ? 'Could not transcribe the dictation. Use Send to retry.' : 'The file could not be transcribed.');
      setQueue(items => items.map(item => item.id === id ? { ...item, issue } : item));
    }
  }

  async function upload() {
    if (!canSubmit || operation.current) return;
    const abort = new AbortController();
    operation.current = { abort, mode: 'upload' };
    const { signal } = abort;
    const streaming = route === '/api/transcriptions/stream' && !!fileModel && queue.some(item => !item.dictation);
    setError(''); setPhase('upload'); setTab(streaming ? 'streaming' : 'finished');
    setQueue(items => items.map(item => ({ ...item, issue: undefined })));
    try {
      for (const item of queue) {
        if (signal.aborted) break;
        const target = item.dictation ?? (fileModel && { route, model: fileModel.id });
        if (target) await transcribeFile(item, target, signal);
        else setQueue(items => items.map(entry => entry.id === item.id ? { ...entry, issue: 'Choose a file transcription model.' } : entry));
      }
    } finally {
      operation.current = null;
      setPhase(undefined);
    }
  }

  async function startDictation() {
    if (!enabled || !dictateModel || !canRecord || operation.current) return;
    const abort = new AbortController(), stop = new AbortController();
    operation.current = { abort, stop, mode: 'dictate' };
    const target = { model: dictateModel.id, route: dictateRoute };
    const { signal } = abort;
    setError(''); setPhase('dictate-connecting');
    try {
      const file = await recordDictation(signal, stop.signal, transcriptionUploadLimit(dictateRoute), () => setPhase('dictating'));
      signal.throwIfAborted();
      const item = { id: crypto.randomUUID(), file, dictation: target };
      setQueue(items => [...items, item]);
      setTab('finished'); setPhase('upload');
      await transcribeFile(item, target, signal);
    } catch (error) {
      if (!signal.aborted) setError(errorMessage(error, 'Could not record the dictation.'));
    } finally {
      operation.current = null;
      setPhase(undefined);
    }
  }

  function dictate() {
    if (operation.current) {
      if (operation.current.mode !== 'dictate') return;
      if (phase === 'dictate-connecting') operation.current.abort.abort();
      if (phase === 'dictating') { setPhase('dictate-finishing'); operation.current.stop?.abort(); }
      return;
    }
    if (!enabled || !dictateModel || !canRecord) return;
    if (settings.skipDictateWarning) void startDictation();
    else {
      if (skipWarning.current) skipWarning.current.checked = false;
      dictateWarning.current?.showModal();
    }
  }

  async function microphone() {
    if (operation.current) {
      if (operation.current.mode !== 'live' || !operation.current.stop) return;
      if (phase === 'connecting') operation.current.abort.abort();
      if (phase === 'listening') { setPhase('finishing'); operation.current.stop.abort(); }
      return;
    }
    if (!enabled || !liveModel || !canLive) return;
    const abort = new AbortController(), stop = new AbortController();
    operation.current = { abort, stop, mode: 'live' };
    const name = t('Microphone transcription');
    let final: Transcript = { text: '', segments: [] };
    setError(''); setTab('streaming'); setPreview({ name, text: '' }); setPhase('connecting');
    try {
      await runMicrophone(gateway, liveModel.id, settings.language?.trim(), { signal: abort.signal, stop: stop.signal,
        ready: () => { if (!abort.signal.aborted) setPhase('listening'); },
        update(transcript, partial) {
          if (abort.signal.aborted) return;
          final = transcript;
          setPreview({ name, text: final.text, partial });
        } });
    } catch (error) {
      if (!abort.signal.aborted) setError(errorMessage(error, 'Could not complete microphone transcription.'));
    } finally {
      if (!abort.signal.aborted) {
        setPreview({ name, text: final.text });
        if (final.text.trim()) await store(name, liveModel.id, final);
      }
      operation.current = null;
      setPhase(undefined);
    }
  }

  const phaseLabel = phase === 'connecting' ? 'Connecting microphone…' : phase === 'listening' ? 'Listening…'
    : phase === 'finishing' ? 'Finishing microphone transcription…' : phase === 'upload' ? 'Transcribing audio…'
    : phase === 'dictate-connecting' ? 'Connecting microphone…' : phase === 'dictating' ? 'Recording dictation…'
    : phase === 'dictate-finishing' ? 'Finishing dictation…' : '';
  const dictateLabel = t(dictating ? 'Stop Dictate' : 'Dictate');
  const liveLabel = t(live ? 'Stop Real-time' : 'Real-time');
  const liveIssue = !selectedModel ? 'No compatible Real-time transcription model is available.'
    : !taggedLive ? 'The selected model does not support real-time transcription.'
    : !liveModel ? 'This app cannot start a live session for the selected model.'
    : canCapture && !canLive ? 'Real-time transcription is not supported in this browser.' : '';
  const liveReason = !live && enabled && catalog && !busy && liveIssue ? t(liveIssue) : undefined;
  const liveButton = <Button className="chat-composer-icon" type="button" aria-label={liveLabel} aria-description={liveReason}
    title={liveReason ? undefined : liveModel ? `${liveLabel} · ${liveModel.name}` : liveLabel} aria-pressed={live} variant={live ? 'primary' : 'subtle'}
    disabled={live ? phase === 'finishing' : busy || !enabled || !canLive} onClick={() => void microphone()}>
    <ChatIcon name={live ? 'stop' : 'speed'} />
  </Button>;
  const options = ['finished', 'streaming'] as const;
  return <main className="catalog-main images-main" aria-labelledby={`${id}-heading`}>
    {toolbar && createPortal(<ModelPicker models={models} selected={selected} multiple={false} loading={loading}
      disabled={busy} onChange={ids => change({ model: ids[0] ?? null })} />, toolbar)}
    <div className="images-content">
      <h1 id={`${id}-heading`}>{t('Transcriptions')}</h1>
      <form className="chat-composer transcription-composer" aria-label={t('Transcription composer')} data-file-drag={dragging || undefined}
        onSubmit={event => { event.preventDefault(); void upload(); }} onDragEnter={event => {
          if (!event.dataTransfer.types.includes('Files')) return;
          event.preventDefault(); dragDepth.current++; if (!busy) setDragging(true);
        }} onDragOver={event => { if (event.dataTransfer.types.includes('Files')) { event.preventDefault(); event.dataTransfer.dropEffect = busy ? 'none' : 'copy'; } }}
        onDragLeave={() => { if (--dragDepth.current <= 0) { dragDepth.current = 0; setDragging(false); } }}
        onDrop={event => { event.preventDefault(); dragDepth.current = 0; setDragging(false); add(event.dataTransfer.files); }}>
        <p className="transcription-hint">{t('Choose or drop audio files, or start the microphone.')}</p>
        <input ref={picker} type="file" hidden multiple accept={transcriptionFileAccept} onChange={event => {
          if (event.currentTarget.files) add(event.currentTarget.files);
          event.currentTarget.value = '';
        }} />
        {!!queue.length && <ul className="transcription-queue" aria-label={t('Audio attachments')}>
          {queue.map(({ id, file, issue }) => <li key={id}><span>{file.name}{issue && <small role="alert"> {t(issue)}</small>}</span>
            <button type="button" disabled={busy} aria-label={t('Remove {{name}}', { name: file.name })}
              onClick={() => setQueue(items => items.filter(item => item.id !== id))}><ChatIcon name="close" /></button></li>)}
        </ul>}
        <div className="chat-composer-actions">
          <Button className="chat-composer-icon" type="button" variant="subtle" aria-label={t('Add attachments')} title={t('Add attachments')}
            onClick={() => picker.current?.click()} disabled={busy}><ChatIcon name="add" /></Button>
          <Button className="chat-composer-icon" type="button" variant="subtle" aria-label={t('Transcription settings')} title={t('Transcription settings')}
            aria-haspopup="dialog" onClick={() => dialog.current?.showModal()} disabled={busy}><ChatIcon name="settings" /></Button>
          <div className="transcription-submit">
            <Button className="chat-composer-icon" type="button" aria-label={dictateLabel} title={dictateLabel}
              aria-pressed={dictating} variant={dictating ? 'primary' : 'subtle'}
              disabled={dictating ? phase === 'dictate-finishing' : busy || !enabled || !dictateModel || !canRecord} onClick={dictate}>
              <ChatIcon name={dictating ? 'stop' : 'mic'} />
            </Button>
            {liveReason ? <Tooltip content={liveReason} visualOnly>
              <span className="transcription-disabled-action" tabIndex={0} role="group" aria-label={liveLabel} aria-description={liveReason}>
                {liveButton}
              </span>
            </Tooltip> : liveButton}
            {phase === 'upload' ? <Button key="stop" type="button" className="chat-send" aria-label={t('Stop')} title={t('Stop')}
                onClick={() => operation.current?.abort.abort()}><ChatIcon name="stop" /></Button>
              : <Button key="send" type="submit" className="chat-send" variant="primary" aria-label={t('Send')} title={t('Send')}
                disabled={!canSubmit}><ChatIcon name="send" /></Button>}
          </div>
        </div>
      </form>
      {(status || phaseLabel) && <p className="chat-attachment-notice" role="status">{status || t(phaseLabel)}</p>}
      {!status && catalog && !fileModel && <p className="chat-attachment-notice" role="status">
        {t(fileModels.length ? 'The selected model does not support file transcription on this route.' : 'No models support this file transcription route.')}
      </p>}
      {enabled && catalog && !busy && (!canCapture ? <p className="chat-attachment-notice">{t('Microphone access requires a secure browser context.')}</p> : <>
        {(!dictateModel || !canRecord) && <p className="chat-attachment-notice">{t(!dictateModel ? 'Dictate needs a file transcription model.' : 'Dictate recording is not supported in this browser.')}</p>}
      </>)}
      {error && <p className="chat-attachment-notice" role="alert">{t(error)}</p>}
      {libraryError && <p className="chat-attachment-notice" role="alert">{t(libraryError)}</p>}
      <section className="images-library" aria-label={t('Transcription results')}>
        <div className="catalog-tabs" role="tablist" aria-label={t('Transcription results')}>
          {options.map(key => <button key={key} id={`${id}-${key}`} type="button" role="tab" aria-selected={tab === key}
            aria-controls={`${id}-${key}-panel`} tabIndex={tab === key ? 0 : -1} onClick={() => setTab(key)} onKeyDown={event => {
              if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
              event.preventDefault();
              const next = event.key === 'Home' ? 'finished' : event.key === 'End' ? 'streaming' : key === 'finished' ? 'streaming' : 'finished';
              setTab(next); document.getElementById(`${id}-${next}`)?.focus();
            }}>{t(key === 'finished' ? 'Finished' : 'Streaming')}</button>)}
        </div>
        <section role="tabpanel" id={`${id}-finished-panel`} aria-labelledby={`${id}-finished`} hidden={tab !== 'finished'}>
          <input type="search" className="ui-input transcription-search" aria-label={t('Search transcriptions')}
            placeholder={t('Search transcriptions…')} value={query} onChange={event => setQuery(event.currentTarget.value)} />
          {results.length ? <div className="transcription-grid">{results.map(item =>
            <TranscriptCard key={item.id} item={item} menuContainer={menuContainer} remove={() => void remove(item.id)}
              onError={() => setError('Could not copy the transcript.')} />)}</div>
            : <p role="status">{t(searchMessage ?? (items.length ? 'No matching transcriptions.' : 'No finished transcriptions yet.'))}</p>}
        </section>
        <section role="tabpanel" id={`${id}-streaming-panel`} aria-labelledby={`${id}-streaming`} hidden={tab !== 'streaming'}>
          <article className="transcription-card transcription-preview" aria-label={t('Streaming transcript')}>
            <h2>{preview?.name ?? t('Streaming transcript')}</h2>
            <div className="transcription-copy" tabIndex={0}>{preview?.text}<span className="transcription-partial">
              {preview?.text && preview.partial ? ' ' : ''}{preview?.partial}
            </span>{!preview?.text && !preview?.partial && t(busy ? 'Waiting for transcript…' : 'No incoming transcription.')}</div>
          </article>
        </section>
      </section>
    </div>
    <dialog className="chat-settings chat-link-dialog" ref={dialog} aria-labelledby={`${id}-settings`}>
      <form method="dialog">
        <header className="chat-settings-header"><h2 id={`${id}-settings`}>{t('Transcription settings')}</h2></header>
        <div className="chat-link-fields transcription-fields">
          <label htmlFor={`${id}-language`}>{t('Audio language (optional)')}</label>
          <input id={`${id}-language`} maxLength={35} placeholder="en" value={settings.language ?? ''} onChange={event => change({ language: event.target.value })} />
          {fileModel?.provider === 'openai' && !fileModel.id.includes('diarize') && <>
            <label htmlFor={`${id}-prompt`}>{t('Transcription prompt (optional)')}</label>
            <input id={`${id}-prompt`} maxLength={1000} value={settings.prompt ?? ''} onChange={event => change({ prompt: event.target.value })} />
          </>}
          {fileModel?.provider === 'gladia' && route === '/api/transcriptions' && <label>
            <input type="checkbox" checked={!!settings.diarization} onChange={event => change({ diarization: event.target.checked })} /> {t('Identify speakers')}
          </label>}
          <label><input type="checkbox" checked={!!settings.split} onChange={event => change({ split: event.target.checked })} /> {t('Split audio above the upload limit')}</label>
          {!!settings.split && <><label htmlFor={`${id}-overlap`}>{t('Chunk overlap (seconds)')}</label>
            <input id={`${id}-overlap`} type="number" min={0} max={10} step={1} value={settings.overlap ?? 5}
              onChange={event => change({ overlap: Math.max(0, Math.min(10, Number(event.target.value))) })} /></>}
        </div>
        <div className="transcription-card-actions"><Button type="submit" variant="primary">{t('Done')}</Button></div>
      </form>
    </dialog>
    <dialog className="chat-settings chat-link-dialog" ref={dictateWarning} aria-labelledby={`${id}-dictate-warning`}>
      <form method="dialog" onSubmit={event => {
        if ((event.nativeEvent as SubmitEvent).submitter?.getAttribute('value') !== 'continue') return;
        if (skipWarning.current?.checked) change({ skipDictateWarning: true });
        void startDictation();
      }}>
        <header className="chat-settings-header"><h2 id={`${id}-dictate-warning`}>{t('Dictate is for short messages')}</h2></header>
        <div className="chat-link-fields transcription-fields">
          <p>{t('Use Dictate for a few sentences. Use Real-time for longer meetings or conversations. Dictate sends the recording when you stop.')}</p>
          <label><input type="checkbox" ref={skipWarning} /> {t('Do not show again')}</label>
        </div>
        <div className="transcription-card-actions">
          <Button type="submit" value="cancel">{t('Cancel')}</Button>
          <Button type="submit" value="continue" variant="primary">{t('Continue recording')}</Button>
        </div>
      </form>
    </dialog>
  </main>;
}
