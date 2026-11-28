import { GatewayError } from '@streaik/gateway';
import type { CatalogModel, Gateway } from '@streaik/gateway';
import { Button } from '@streaik/themes';
import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChatComposer } from './ChatComposer';
import type { ComposerDictation } from './composerDictation';
import { useAppTranslation } from './i18n';
import type { ModelRouter } from './modelDecisions';
import { ModelPicker } from './ModelPicker';
import { deleteSpeech, listSpeech, saveSpeech, speechFilename } from './speechLibrary';
import type { SavedSpeech } from './speechLibrary';
import { pcmSpeechPlayback, progressiveSpeech } from './speechPlayback';
import { readSpeechPreferences, resolveSpeechRoute, writeSpeechPreferences } from './speechPreferences';
import type { SpeechRoute } from './speechPreferences';
import { SpeechSettingsDialog } from './SpeechSettingsDialog';
import { synthesizeSpeech } from './speechSynthesis';
import './images.css';
import './speech.css';

function SpeechClip({ item, onDelete, onPlay }: { item: SavedSpeech; onDelete: () => Promise<void>; onPlay: () => void }) {
  const { t } = useAppTranslation();
  const [url, setUrl] = useState('');
  const [deleting, setDeleting] = useState(false);
  useEffect(() => {
    const next = URL.createObjectURL(item.audio);
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [item.audio]);
  return <li className="speech-clip">
    <strong title={item.title}>{item.title}</strong>
    <small>{item.model}</small>
    {url && item.audio.type.startsWith('audio/') && <audio controls preload="none" src={url} aria-label={item.title} onPlay={onPlay} />}
    <div className="speech-clip-actions">
      {url && <a href={url} download={speechFilename(item)}>{t('Download')}</a>}
      <Button type="button" variant="subtle" disabled={deleting} aria-label={t('Delete {{name}}', { name: item.title })}
        onClick={async () => { setDeleting(true); try { await onDelete(); } finally { setDeleting(false); } }}>{t('Delete')}</Button>
    </div>
  </li>;
}

export default function SpeechView({ gateway, scope, routeOverride, toolbar, models, selected, onSelect, loading: loadingModels, router, status, dictation }: {
  gateway: Gateway; scope?: string; routeOverride?: SpeechRoute; toolbar: HTMLDivElement | null;
  models: CatalogModel[]; selected: CatalogModel[]; onSelect: (ids: string[]) => void;
  loading: boolean; router?: ModelRouter; status?: string; dictation: ComposerDictation;
}) {
  const { t } = useAppTranslation();
  const id = useId();
  const [draft, setDraft] = useState('');
  const [settings, setSettings] = useState(() => readSpeechPreferences(scope));
  const [showSettings, setShowSettings] = useState(false);
  const [items, setItems] = useState<SavedSpeech[]>([]);
  const [loading, setLoading] = useState(!!scope);
  const [historyError, setHistoryError] = useState(false);
  const [error, setError] = useState('');
  const [warnings, setWarnings] = useState<string[]>([]);
  const [phase, setPhase] = useState<'choosing' | 'generating'>();
  const [preview, setPreview] = useState(false);
  const audio = useRef<HTMLAudioElement>(null);
  const playback = useRef<ReturnType<typeof progressiveSpeech>>(undefined);
  const pcmPlayback = useRef<ReturnType<typeof pcmSpeechPlayback>>(undefined);
  const running = useRef<AbortController>(null);
  const route = resolveSpeechRoute(routeOverride, selected[0]);
  const canSend = selected.length > 0 && !status;

  useEffect(() => {
    let live = true;
    if (scope) void listSpeech(scope).then(records => {
      if (!live) return;
      setItems(current => [...current, ...records.filter(item => !current.some(existing => existing.id === item.id))]);
      setLoading(false);
    }, () => {
      if (!live) return;
      setHistoryError(true);
      setLoading(false);
    });
    return () => { live = false; stop(); };
  }, [scope]);

  function stop() {
    running.current?.abort();
    playback.current?.close();
    pcmPlayback.current?.close();
  }

  async function generate() {
    const text = draft.trim();
    if (!text || !canSend || running.current) return;
    playback.current?.close();
    pcmPlayback.current?.close();
    const controller = new AbortController();
    running.current = controller;
    const { signal } = controller;
    const decision = router && selected.length > 1 ? router : undefined;
    // Prepare audio during Send even if Decisions must pick a winner asynchronously.
    const live = selected.some(model => resolveSpeechRoute(routeOverride, model) === 'websocket') ? pcmSpeechPlayback() : undefined;
    pcmPlayback.current = live;
    setPhase(decision ? 'choosing' : 'generating');
    setError('');
    setWarnings([]);
    try {
      let model = selected[0];
      if (decision) {
        const { endpoint, ...agent } = decision;
        const { voice, instructions, language, outputFormat, speed } = route === '/v1/audio/speech' ? { ...settings.native, language: undefined } : settings.general;
        const decisionRoute = selected.every(model => resolveSpeechRoute(routeOverride, model) === route) ? route : undefined;
        const input = JSON.stringify({ text, route: decisionRoute, voice, instructions, language, outputFormat, speed });
        const choices = selected.map(({ id, name, provider, description, tags }) => ({ value: id,
          description: JSON.stringify({ name, provider, description, tags }) }));
        const winner = await gateway.decideChoice(endpoint, { ...agent, input, choices }, signal);
        signal.throwIfAborted();
        const chosen = selected.find(({ id }) => id === winner);
        if (!chosen) throw new GatewayError('Decisions did not return one of the selected models.');
        model = chosen;
        setPhase('generating');
      }
      const actualRoute = resolveSpeechRoute(routeOverride, model);
      if (actualRoute !== 'websocket') live?.close();
      let attempted = false;
      const result = await synthesizeSpeech(gateway, actualRoute, model, text, settings, signal, { pcm: live?.append, audio: (bytes, type) => {
        if (!attempted && audio.current && !signal.aborted) {
          attempted = true;
          // A preview failure must not affect the generation or saved clip.
          try {
            playback.current = progressiveSpeech(audio.current, type, () => { playback.current = undefined; setPreview(false); });
            if (playback.current) setPreview(true);
          } catch { /* The browser will use the completed clip instead. */ }
        }
        playback.current?.append(bytes);
      } });
      signal.throwIfAborted();
      playback.current?.finish();
      const { warnings, ...audioResult } = result;
      const item = { ...audioResult, id: crypto.randomUUID(), title: Array.from(text.replace(/\s+/g, ' ')).slice(0, 72).join('') };
      setWarnings(warnings);
      setItems(current => [item, ...current]);
      setDraft('');
      if (scope) try { await saveSpeech(scope, item); } catch {
        if (!signal.aborted) setError('Could not save the generated speech.');
      }
      await live?.finish();
    } catch (cause) {
      playback.current?.close();
      live?.close();
      if (!signal.aborted) setError(cause instanceof GatewayError ? cause.message : 'Could not generate speech.');
    } finally {
      if (running.current === controller) {
        running.current = null;
        setPhase(undefined);
      }
    }
  }

  async function remove(item: SavedSpeech) {
    try {
      if (scope) await deleteSpeech(scope, item.id);
      setItems(current => current.filter(entry => entry.id !== item.id));
    } catch { setError('Could not delete the speech clip.'); }
  }

  return <main className="catalog-main" aria-labelledby={id}>
    {toolbar && createPortal(<ModelPicker models={models} selected={selected} multiple={!!router} loading={loadingModels}
      disabled={!!phase} onChange={onSelect} />, toolbar)}
    <div className="images-content speech-content">
      <h1 id={id}>{t('Speech')}</h1>
      <ChatComposer busy={!!phase} canSend={canSend} onStop={stop} dictation={dictation}
        speech={{ text: draft, onChange: setDraft, onSettings: () => setShowSettings(true), onSend: () => { void generate(); } }} />
      {status && <p className="chat-attachment-notice" role="status">{status}</p>}
      {phase && <p className="chat-attachment-notice" role="status">{t(phase === 'choosing' ? 'Choosing a model…' : 'Generating speech…')}</p>}
      {error && <p className="chat-attachment-notice" role="alert">{t(error)}</p>}
      {warnings.map(message => <p key={message} className="chat-attachment-notice" role="status">{t(message)}</p>)}
      <audio className="speech-live" ref={audio} hidden={!preview} controls preload="auto" aria-label={t('Live speech playback')} />
      <section className="images-library" aria-labelledby={`${id}-library`}>
        <h2 id={`${id}-library`}>{t('My speech')}</h2>
        {loading && <p className="chat-attachment-notice" role="status">{t('Loading speech…')}</p>}
        {historyError && <p className="chat-attachment-notice" role="alert">{t('Could not load saved speech.')}</p>}
        {!!items.length && <ul className="speech-clips">{[...items].sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp)).map(item =>
          <SpeechClip key={item.id} item={item} onDelete={() => remove(item)} onPlay={() => { playback.current?.close(); pcmPlayback.current?.close(); }} />)}</ul>}
      </section>
    </div>
    {showSettings && <SpeechSettingsDialog initial={settings} models={selected} route={route}
      onSave={next => { setSettings(next); writeSpeechPreferences(scope, next); }} onClose={() => setShowSettings(false)} />}
  </main>;
}
