import { Button, Select, Textarea, Tooltip } from '@streaik/themes';
import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import type { FormEvent, KeyboardEvent, ReactNode } from 'react';
import { ChatIcon } from './ChatIcon';
import { attachmentByteLimit, attachmentCountLimit, composeAttachmentParts, fileMediaType, httpLink, isTextAttachment, linkMediaType } from './chatAttachments';
import type { AttachmentPart, DraftAttachment } from './chatAttachments';
import { reasoningLevels } from './chatPreferences';
import type { ReasoningLevel } from './chatPreferences';
import { appendDictation } from './composerDictation';
import type { ComposerDictation } from './composerDictation';
import { useAppTranslation } from './i18n';
import { hasMcpPickerResources, McpComposerPicker } from './McpComposerPicker';
import type { ConnectedMcpServer } from './mcpChatContext';
import type { McpOutput, McpServer } from './mcp';
import type { McpServerRecord } from './mcpConfiguration';
import { useComposerDictation } from './useComposerDictation';
import { importSpeechText, speechFileAccept } from './speechFiles';

export function AttachmentChip({ name, url, note, icon, children }: { name: string; url?: URL; note?: string; icon?: Parameters<typeof ChatIcon>[0]['name']; children?: ReactNode }) {
  return <Tooltip content={url?.href ?? name} visualOnly><span className="chat-attachment">
    <ChatIcon name={icon ?? (url ? 'link' : 'attachment')} />
    {url ? <a href={url.href} target="_blank" rel="noopener noreferrer">{name}</a> : <span className="chat-attachment-name">{name}</span>}
    {note && <small>{note}</small>}{children}
  </span></Tooltip>;
}

type ImageDraft = { prompt: string; attachments: DraftAttachment[] };
export type ComposerBadge = { key: string; label: string; icon: 'providers' | 'tool' | 'docs'; remove: () => void };
type DraftMcpResource = { record: McpServerRecord; uri: string; label: string; parts: AttachmentPart[]; size: number };
type ComposerMcp = { count: number; disabled: boolean; open: () => void; servers: readonly ConnectedMcpServer[];
  connect: (record: McpServerRecord) => McpServer | undefined };
type ComposerProps = { busy: boolean; canSend: boolean; dictation?: ComposerDictation } & (
  { image?: undefined; video?: undefined; speech?: undefined; convert: boolean; onSend: (parts: AttachmentPart[]) => void; onChatSettings: () => void; onViewContext: () => void;
    mcp?: ComposerMcp; badges?: readonly ComposerBadge[]; onStop: () => void;
    voice?: { phase?: 'connecting' | 'active' | 'closing'; start: () => void; stop: () => void; manualTurn?: () => void;
      emptyOnly?: boolean; preview?: string };
    reasoning?: { value: ReasoningLevel; onChange: (value: ReasoningLevel) => void } } |
  { image: { draft: ImageDraft; onChange: (value: ImageDraft) => void; onSend: () => void; onSettings: () => void }; video?: undefined; speech?: undefined; onStop: () => void } |
  { image?: undefined; video: { prompt: string; onChange: (prompt: string) => void; onSend: () => void }; speech?: undefined; onStop?: undefined } |
  { image?: undefined; video?: undefined; speech: { text: string; onChange: (text: string) => void; onSend: () => void; onSettings: () => void }; onStop: () => void }
);

export function ChatComposer(props: ComposerProps) {
  const { busy, canSend, onStop, image, video, speech } = props;
  const media = !!(image || video || speech);
  const convert = !image && !video && !speech && props.convert;
  const { t } = useAppTranslation();
  const reasoning = !image && !video && !speech ? props.reasoning : undefined;
  const mcp = !image && !video && !speech ? props.mcp : undefined;
  const badges = !image && !video && !speech ? props.badges : undefined;
  const voice = !image && !video && !speech ? props.voice : undefined;
  const voiceLabel = t(voice?.phase === 'connecting' ? 'Cancel voice session' : voice?.phase ? 'Stop voice session' : 'Start voice session');
  const plusLabel = t(mcp ? 'Add to message' : 'Add attachments');
  const id = useId();
  const [localDraft, setLocalDraft] = useState('');
  const [localAttachments, setLocalAttachments] = useState<DraftAttachment[]>([]);
  const [mcpResources, setMcpResources] = useState<DraftMcpResource[]>([]);
  const [mcpPicker, setMcpPicker] = useState<'prompts' | 'resources'>();
  const resourceAttached = (item: DraftMcpResource, context?: ComposerMcp) => context?.servers.some(({ record }) => record === item.record) === true;
  const resources = mcpResources.filter(item => resourceAttached(item, mcp));
  if (mcp && resources.length !== mcpResources.length) setMcpResources(resources);
  if (!mcp && mcpPicker) setMcpPicker(undefined);
  const draft = image?.draft.prompt ?? video?.prompt ?? speech?.text ?? localDraft;
  const attachments = image?.draft.attachments ?? localAttachments;
  const fileCount = attachments.length + resources.length;
  const voiceAction = voice && (!voice.emptyOnly || voice.phase || (!draft.trim() && !fileCount && !busy));
  const capture = !!voice?.emptyOnly && !!voice.phase;
  const byteCount = attachments.reduce((sum, item) => sum + ('file' in item ? item.file.size : 0), 0) + resources.reduce((sum, item) => sum + item.size, 0);
  const setDraft = (prompt: string) => image ? image.onChange({ prompt, attachments }) : video ? video.onChange(prompt) : speech ? speech.onChange(prompt) : setLocalDraft(prompt);
  const setAttachments = (items: DraftAttachment[]) => image ? image.onChange({ prompt: draft, attachments: items }) : setLocalAttachments(items);
  const [notice, setNotice] = useState('');
  const [preparing, setPreparing] = useState(false);
  const dictation = useComposerDictation(props.dictation, busy || preparing, text => setDraft(appendDictation(draft, text)));
  const dictating = dictation.phase !== undefined;
  const dictateLabel = t(dictation.phase === 'finishing' ? 'Finishing dictation…' : dictating ? 'Stop Dictate' : 'Dictate');
  const [dragging, setDragging] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [linkInput, setLinkInput] = useState('');
  const [linkType, setLinkType] = useState('');
  const [linkError, setLinkError] = useState(false);
  const link = httpLink(linkInput);
  const menu = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLSpanElement>(null);
  const picker = useRef<HTMLInputElement>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const dragDepth = useRef(0);
  const pending = useRef(false);
  const mounted = useRef(false);
  const latest = useRef(props);
  useLayoutEffect(() => { latest.current = props; }, [props]);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  function closeMenu(restoreFocus = false) {
    setMenuOpen(false);
    if (restoreFocus) trigger.current?.querySelector('button')?.focus();
  }

  useLayoutEffect(() => {
    if (!menuOpen) return;
    menu.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !trigger.current?.contains(event.target) && !menu.current?.contains(event.target)) setMenuOpen(false);
    };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [menuOpen]);

  function menuKeys(event: KeyboardEvent<HTMLDivElement>) {
    const items = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('[role="menuitem"]:not(:disabled)'));
    const current = items.indexOf(document.activeElement as HTMLElement);
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1
      : event.key === 'ArrowDown' ? (current + 1) % items.length
        : event.key === 'ArrowUp' ? (current + items.length - 1) % items.length : -1;
    if (next >= 0) { event.preventDefault(); items[next]?.focus(); }
    if (event.key === 'Escape') { event.preventDefault(); closeMenu(true); }
    if (event.key === 'Tab') closeMenu(true);
  }

  async function addFiles(files: FileList) {
    if (capture || pending.current || (media && busy) || !files.length) return;
    if (speech) {
      if (dictation.active()) return;
      pending.current = true;
      setPreparing(true);
      try {
        const { text, issue } = await importSpeechText([...files]);
        const current = latest.current.speech;
        if (!mounted.current || !current) return;
        if (text) current.onChange([current.text.trimEnd(), text].filter(Boolean).join('\n\n'));
        setNotice(issue);
      } finally { pending.current = false; if (mounted.current) setPreparing(false); }
      return;
    }
    const nextId = Math.max(0, ...attachments.map(item => item.id)) + 1;
    const added = [...files].map((file, index) => ({ id: nextId + index, name: file.name, file, mediaType: fileMediaType(file) }));
    if (image && added.some(item => !item.mediaType.startsWith('image/') || !item.file.size)) { setNotice('Choose an image file.'); return; }
    if (fileCount + added.length > attachmentCountLimit) { setNotice('Add up to 10 attachments per message.'); return; }
    if (byteCount + added.reduce((sum, item) => sum + item.file.size, 0) > attachmentByteLimit) {
      setNotice('Add up to 10 MB of files per message.'); return;
    }
    setAttachments([...attachments, ...added]);
    setNotice('');
  }

  function addLink(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (capture || image && busy) return;
    if (!link) { setLinkError(true); return; }
    if (fileCount >= attachmentCountLimit) { setNotice('Add up to 10 attachments per message.'); dialog.current?.close(); return; }
    const item = { id: Math.max(0, ...attachments.map(item => item.id)) + 1, name: `${link.host}${link.pathname === '/' ? '' : link.pathname}`,
      url: link.href, mediaType: linkType || linkMediaType(link) };
    setAttachments([...attachments, item]);
    setNotice('');
    dialog.current?.close();
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (voiceAction) {
      if (voice.phase === 'active' && !draft.trim() && !fileCount) voice.manualTurn?.();
      return;
    }
    if ((!draft.trim() && (media || !fileCount)) || !canSend || busy || pending.current || dictation.active()) return;
    const mediaComposer = image ?? video ?? speech;
    if (mediaComposer) { setNotice(''); mediaComposer.onSend(); return; }
    try { await sendText(draft); }
    catch { if (mounted.current) setNotice('Could not prepare the attachments.'); }
  }

  async function sendText(text: string, signal?: AbortSignal) {
    if (pending.current || !canSend || busy || dictation.active()) throw new Error('The composer is unavailable.');
    pending.current = true;
    setPreparing(true);
    setNotice('');
    try {
      const parts = await composeAttachmentParts(text, attachments, convert);
      signal?.throwIfAborted();
      const current = latest.current;
      if (!mounted.current || !current.canSend || current.image || current.video || current.speech || resources.some(item => !resourceAttached(item, current.mcp))) {
        throw new Error('The composer is unavailable.');
      }
      current.onSend([...parts, ...resources.flatMap(item => item.parts)]);
      // A prompt runs as its own turn; leave any unsent text draft intact.
      if (!signal) setDraft('');
      setAttachments([]);
      setMcpResources([]);
    } finally { pending.current = false; if (mounted.current) setPreparing(false); }
  }

  function attachResource(record: McpServerRecord, uri: string, label: string, output: McpOutput) {
    if (!mcp?.servers.some(entry => entry.record === record)) return 'This MCP server is no longer connected.';
    const parts: AttachmentPart[] = output.text.trim() ? [{ type: 'text', text: `\n\nMCP resource: ${JSON.stringify(label)}\n${output.text}`,
      providerMetadata: { streaik: { attachmentName: label } } }] : [];
    for (const url of output.images) parts.push({ type: 'file', mediaType: url.slice(5, url.indexOf(';')), url, filename: label });
    if (!parts.length) return 'The resource has no supported content.';
    const same = resources.find(item => item.record === record && item.uri === uri);
    const size = new TextEncoder().encode(output.text).length + output.images.reduce((sum, image) => sum + Math.ceil(image.length * 0.75), 0);
    if (!same && fileCount >= attachmentCountLimit) return 'Add up to 10 attachments per message.';
    if (byteCount - (same?.size ?? 0) + size > attachmentByteLimit) return 'Add up to 10 MB of files per message.';
    setMcpResources([...resources.filter(item => item !== same), { record, uri, label, parts, size }]);
    setNotice('');
  }

  return <>
    {!!badges?.length && <ul className="chat-attachments chat-context-badges" aria-label={t('Active chat context')}>
      {badges.map(badge => <li key={badge.key}><AttachmentChip icon={badge.icon} name={badge.label}>
        <Button type="button" variant="subtle" aria-label={t('Remove {{name}}', { name: badge.label })} disabled={busy || preparing} onClick={badge.remove}>
          <ChatIcon name="close" />
        </Button>
      </AttachmentChip></li>)}
    </ul>}
    <form className="chat-composer" onSubmit={submit} aria-label={t(image ? 'Image composer' : video ? 'Video composer' : speech ? 'Speech composer' : 'Message composer')} data-file-drag={dragging || undefined}
      onDragEnter={event => {
        if (!event.dataTransfer.types.includes('Files')) return;
        event.preventDefault();
        if (video) return;
        dragDepth.current++;
        if (!capture && !pending.current && !(speech && (busy || dictating))) setDragging(true);
      }} onDragOver={event => {
        if (!event.dataTransfer.types.includes('Files')) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = video || capture || pending.current || (speech && (busy || dictating)) ? 'none' : 'copy';
      }} onDragLeave={() => {
        dragDepth.current = Math.max(0, dragDepth.current - 1);
        if (!dragDepth.current) setDragging(false);
      }} onDrop={event => {
        if (!event.dataTransfer.types.includes('Files')) return;
        event.preventDefault();
        if (video) return;
        dragDepth.current = 0;
        setDragging(false);
        void addFiles(event.dataTransfer.files);
      }}>
      {fileCount > 0 && <ul className="chat-attachments" aria-label={t('Attachments')}>
        {attachments.map(item => <li key={item.id}>
          <AttachmentChip name={item.name} url={'url' in item ? httpLink(item.url) : undefined}
            note={'file' in item && convert ? t(isTextAttachment(item.mediaType) ? 'As text' : 'Original file') : undefined}>
            <Button type="button" variant="subtle" aria-label={t('Remove {{name}}', { name: item.name })} disabled={preparing || !!image && busy}
              onClick={() => { setAttachments(attachments.filter(other => other.id !== item.id)); setNotice(''); }}><ChatIcon name="close" /></Button>
          </AttachmentChip>
        </li>)}
        {resources.map(item => <li key={JSON.stringify([item.record.id, item.uri])}>
          <AttachmentChip name={item.label} icon="docs" note={t('MCP resource')}>
            <Button type="button" variant="subtle" aria-label={t('Remove {{name}}', { name: item.label })} disabled={preparing}
              onClick={() => setMcpResources(resources.filter(other => other !== item))}><ChatIcon name="close" /></Button>
          </AttachmentChip>
        </li>)}
      </ul>}
      <Textarea aria-label={t(image ? 'Image prompt' : video ? 'Video prompt' : speech ? 'Speech text' : 'Message')}
        placeholder={t(image ? 'Describe a new image' : video ? 'Describe a new video' : speech ? 'Enter text to generate speech' : 'Ask anything')} rows={media ? 3 : 2}
        value={capture ? voice?.preview ?? '' : appendDictation(draft, dictation.preview ?? '')} readOnly={capture || dictating || preparing || media && busy}
        onChange={event => { if (!dictation.active()) setDraft(event.currentTarget.value); }} onKeyDown={event => {
          if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
            event.preventDefault();
            if (!dictation.active()) event.currentTarget.form?.requestSubmit();
          }
        }} />
      {dragging && <span className="chat-drop-label" aria-hidden="true">{t(speech ? 'Drop files to import text' : 'Drop files to attach')}</span>}
      {notice && <p className="chat-attachment-notice" role="alert">{t(notice)}</p>}
      {dictation.error && <p className="chat-attachment-notice" role="alert">{t(dictation.error)}</p>}
      {preparing && <p className="chat-attachment-notice" role="status">{t('Preparing attachments…')}</p>}
      <div className="chat-composer-actions">
        {!video && <div className="chat-attachment-actions">
          {speech ? <Button className="chat-composer-icon" type="button" variant="subtle" aria-label={t('Import text files')} title={t('Import text files')}
            disabled={busy || dictating || preparing} onClick={() => picker.current?.click()}><ChatIcon name="attachment" /></Button> : <span ref={trigger}><Button className="chat-composer-icon" type="button" variant="subtle" aria-label={plusLabel}
            title={plusLabel} aria-haspopup="menu" aria-expanded={menuOpen} aria-controls={menuOpen ? `${id}-menu` : undefined}
            disabled={capture || preparing || !!image && busy} onClick={() => setMenuOpen(!menuOpen)} onKeyDown={event => {
              if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); setMenuOpen(true); }
            }}><ChatIcon name="add" /></Button></span>}
          {menuOpen && <div ref={menu} id={`${id}-menu`} className="chat-attachment-menu" role="menu" aria-label={plusLabel} onKeyDown={menuKeys}>
            <button type="button" role="menuitem" tabIndex={-1} onClick={() => { closeMenu(true); picker.current?.click(); }}><ChatIcon name="attachment" />{t('Files')}</button>
            <button type="button" role="menuitem" tabIndex={-1} onClick={() => {
              closeMenu(true);
              setLinkInput(''); setLinkType(''); setLinkError(false);
              dialog.current?.showModal();
            }}><ChatIcon name="link" />{t('Link')}</button>
            {mcp?.servers.some(({ discovery }) => discovery.hasPrompts) && <button type="button" role="menuitem" tabIndex={-1} aria-haspopup="dialog"
              disabled={mcp.disabled || preparing || dictating} onClick={() => { closeMenu(true); setMcpPicker('prompts'); }}><ChatIcon name="compose" />{t('Prompts')}</button>}
            {mcp && hasMcpPickerResources(mcp.servers) && <button type="button" role="menuitem" tabIndex={-1} aria-haspopup="dialog"
              disabled={mcp.disabled || preparing} onClick={() => { closeMenu(true); setMcpPicker('resources'); }}><ChatIcon name="docs" />{t('Resources')}</button>}
            {mcp && <button type="button" role="menuitem" tabIndex={-1} aria-haspopup="dialog" disabled={mcp.disabled || preparing}
              onClick={() => { closeMenu(true); mcp.open(); }}><ChatIcon name="tool" />{t('Model Context')}
              {mcp.count > 0 && <span className="mcp-selected-count" aria-hidden="true">{mcp.count}</span>}
            </button>}
          </div>}
          <input ref={picker} type="file" multiple hidden accept={image ? 'image/*' : speech ? speechFileAccept : undefined} onChange={event => {
            if (event.currentTarget.files) void addFiles(event.currentTarget.files);
            event.currentTarget.value = '';
          }} />
        </div>}
        {image || speech ? <Button className="chat-composer-icon" type="button" variant="subtle" aria-label={t(image ? 'Image settings' : 'Speech settings')}
          title={t(image ? 'Image settings' : 'Speech settings')} aria-haspopup="dialog" disabled={busy} onClick={(image ?? speech)?.onSettings}><ChatIcon name="settings" /></Button> : !video && <>
          <span className="chat-composer-settings"><Button className="chat-composer-icon" type="button" variant="subtle" aria-label={t('Chat settings')}
            title={t('Chat settings')} aria-haspopup="dialog" onClick={props.onChatSettings}><ChatIcon name="settings" /></Button></span>
          {reasoning && <Tooltip content={t('Reasoning level')} visualOnly><span className="chat-composer-reasoning">
            <Select label={t('Reasoning level')} value={reasoning.value} disabled={busy || preparing}
              options={[{ value: 'none', label: t('None') }, { value: 'low', label: t('Low') },
                { value: 'medium', label: t('Medium') }, { value: 'high', label: t('High') }]}
              onValueChange={value => {
                const level = reasoningLevels.find(level => level === value);
                if (level) reasoning.onChange(level);
              }} />
          </span></Tooltip>}
          <Button className="chat-composer-icon" type="button" variant="subtle" aria-label={t('View context')}
            title={t('View context')} aria-haspopup="dialog" onClick={props.onViewContext}><ChatIcon name="info" /></Button>
        </>}
        <div className="chat-composer-submit">
          {props.dictation !== undefined && <Button className="chat-composer-icon" type="button" aria-label={dictateLabel} title={dictateLabel}
            aria-pressed={dictating} aria-busy={dictation.phase === 'finishing' || undefined} variant={dictating ? 'primary' : 'subtle'}
            disabled={dictation.phase === 'finishing' || !props.dictation || busy || preparing || !!voice?.phase} onClick={() => { if (!pending.current) void dictation.toggle(); }}>
            <ChatIcon name={dictating ? 'stop' : 'mic'} />
          </Button>}
          {voiceAction ? <Button key="voice" className="chat-send" type="button" variant="primary" aria-label={voiceLabel} title={voiceLabel}
            aria-pressed={!!voice.phase} aria-busy={voice.phase === 'connecting' || voice.phase === 'closing' || undefined}
            disabled={voice.phase === 'closing' || !voice.phase && (busy || !canSend || preparing || dictating)}
            onClick={() => { if (voice.phase) voice.stop(); else if (!pending.current && !dictation.active()) voice.start(); }}>{voice.phase ? <ChatIcon name="stop" /> :
              <svg className="chat-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
                strokeLinecap="round" aria-hidden="true" focusable="false"><path d="M4 10v4m4-7v10m4-14v18m4-14v10m4-7v4" /></svg>}</Button>
          : busy && onStop ? <Button key="stop" className="chat-send" type="button" aria-label={t('Stop')} title={t('Stop')}
            onClick={onStop}><ChatIcon name="stop" /></Button>
          : <Button key="send" className="chat-send" type="submit" variant="primary" aria-label={t('Send')} title={t('Send')}
            disabled={busy || !canSend || preparing || dictating || (!draft.trim() && (media || !fileCount))}><ChatIcon name="send" /></Button>}
        </div>
      </div>
    </form>
    {mcp && mcpPicker && <McpComposerPicker mode={mcpPicker} servers={mcp.servers} canSend={canSend && !dictating} connect={mcp.connect}
      onPrompt={sendText} onResource={attachResource} close={() => setMcpPicker(undefined)} />}
    {!video && !speech && <dialog ref={dialog} className="chat-settings chat-link-dialog" aria-labelledby={`${id}-link-title`}>
      <form onSubmit={addLink}>
        <header className="chat-settings-header"><h2 id={`${id}-link-title`}>{t('Link')}</h2></header>
        <div className="chat-link-fields">
          <label htmlFor={`${id}-url`}>{t('URL')}</label>
          <input id={`${id}-url`} type="url" autoFocus required maxLength={4096} placeholder="https://" value={linkInput}
            aria-invalid={linkError || undefined} onChange={event => { setLinkInput(event.currentTarget.value); setLinkError(false); }} />
          {!image && <><label htmlFor={`${id}-type`}>{t('Link type')}</label>
          <select id={`${id}-type`} value={linkType} onChange={event => setLinkType(event.currentTarget.value)}>
            <option value="">{t('Automatic')}</option>
            {['text/html', 'application/pdf', 'image/png', 'image/jpeg', 'image/webp', 'image/gif'].map(type => <option value={type} key={type}>{type}</option>)}
          </select></>}
          {linkError && <p role="alert">{t('Enter an HTTP or HTTPS URL without credentials.')}</p>}
        </div>
        <footer className="chat-tool-footer">
          <Button type="button" variant="subtle" onClick={() => dialog.current?.close()}>{t('Cancel')}</Button>
          <Button type="submit" variant="primary">{t('Add')}</Button>
        </footer>
      </form>
    </dialog>}
  </>;
}
