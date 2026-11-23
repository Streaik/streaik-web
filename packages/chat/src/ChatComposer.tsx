import { Button, Textarea, Tooltip } from '@streaik/themes';
import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import type { FormEvent, KeyboardEvent, ReactNode } from 'react';
import { ChatIcon } from './ChatIcon';
import { attachmentByteLimit, attachmentCountLimit, composeAttachmentParts, fileMediaType, httpLink, isTextAttachment, linkMediaType } from './chatAttachments';
import type { AttachmentPart, DraftAttachment } from './chatAttachments';
import { useAppTranslation } from './i18n';

export function AttachmentChip({ name, url, note, children }: { name: string; url?: URL; note?: string; children?: ReactNode }) {
  return <Tooltip content={url?.href ?? name} visualOnly><span className="chat-attachment">
    <ChatIcon name={url ? 'link' : 'attachment'} />
    {url ? <a href={url.href} target="_blank" rel="noopener noreferrer">{name}</a> : <span className="chat-attachment-name">{name}</span>}
    {note && <small>{note}</small>}{children}
  </span></Tooltip>;
}

type ImageDraft = { prompt: string; attachments: DraftAttachment[] };
type ComposerProps = { busy: boolean; canSend: boolean } & (
  { image?: undefined; video?: undefined; convert: boolean; onSend: (parts: AttachmentPart[]) => void; onChatSettings: () => void; onViewContext: () => void; onStop: () => void } |
  { image: { draft: ImageDraft; onChange: (value: ImageDraft) => void; onSend: () => void; onSettings: () => void }; video?: undefined; onStop: () => void } |
  { image?: undefined; video: { prompt: string; onChange: (prompt: string) => void; onSend: () => void }; onStop?: undefined }
);

export function ChatComposer(props: ComposerProps) {
  const { busy, canSend, onStop, image, video } = props;
  const media = !!(image || video);
  const convert = !image && !video && props.convert;
  const { t } = useAppTranslation();
  const id = useId();
  const [localDraft, setLocalDraft] = useState('');
  const [localAttachments, setLocalAttachments] = useState<DraftAttachment[]>([]);
  const draft = image?.draft.prompt ?? video?.prompt ?? localDraft;
  const attachments = image?.draft.attachments ?? localAttachments;
  const setDraft = (prompt: string) => image ? image.onChange({ prompt, attachments }) : video ? video.onChange(prompt) : setLocalDraft(prompt);
  const setAttachments = (items: DraftAttachment[]) => image ? image.onChange({ prompt: draft, attachments: items }) : setLocalAttachments(items);
  const [notice, setNotice] = useState('');
  const [preparing, setPreparing] = useState(false);
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
    const items = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('[role="menuitem"]'));
    const current = items.indexOf(document.activeElement as HTMLElement);
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1
      : event.key === 'ArrowDown' ? (current + 1) % items.length
        : event.key === 'ArrowUp' ? (current + items.length - 1) % items.length : -1;
    if (next >= 0) { event.preventDefault(); items[next]?.focus(); }
    if (event.key === 'Escape') { event.preventDefault(); closeMenu(true); }
    if (event.key === 'Tab') closeMenu(true);
  }

  function addFiles(files: FileList) {
    if (pending.current || (image && busy) || !files.length) return;
    const nextId = Math.max(0, ...attachments.map(item => item.id)) + 1;
    const added = [...files].map((file, index) => ({ id: nextId + index, name: file.name, file, mediaType: fileMediaType(file) }));
    if (image && added.some(item => !item.mediaType.startsWith('image/') || !item.file.size)) { setNotice('Choose an image file.'); return; }
    if (attachments.length + added.length > attachmentCountLimit) { setNotice('Add up to 10 attachments per message.'); return; }
    const size = attachments.reduce((sum, item) => sum + ('file' in item ? item.file.size : 0), 0);
    if (size + added.reduce((sum, item) => sum + item.file.size, 0) > attachmentByteLimit) {
      setNotice('Add up to 10 MB of files per message.'); return;
    }
    setAttachments([...attachments, ...added]);
    setNotice('');
  }

  function addLink(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (image && busy) return;
    if (!link) { setLinkError(true); return; }
    if (attachments.length >= attachmentCountLimit) { setNotice('Add up to 10 attachments per message.'); dialog.current?.close(); return; }
    const item = { id: Math.max(0, ...attachments.map(item => item.id)) + 1, name: `${link.host}${link.pathname === '/' ? '' : link.pathname}`,
      url: link.href, mediaType: linkType || linkMediaType(link) };
    setAttachments([...attachments, item]);
    setNotice('');
    dialog.current?.close();
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if ((!draft.trim() && (media || !attachments.length)) || !canSend || busy || pending.current) return;
    if (image || video) { setNotice(''); (image ?? video)?.onSend(); return; }
    pending.current = true;
    setPreparing(true);
    setNotice('');
    try {
      const parts = await composeAttachmentParts(draft, attachments, convert);
      if (!mounted.current || !latest.current.canSend || latest.current.image || latest.current.video) return;
      latest.current.onSend(parts);
      setDraft('');
      setAttachments([]);
    } catch { if (mounted.current) setNotice('Could not prepare the attachments.'); }
    finally { pending.current = false; if (mounted.current) setPreparing(false); }
  }

  return <>
    <form className="chat-composer" onSubmit={submit} aria-label={t(image ? 'Image composer' : video ? 'Video composer' : 'Message composer')} data-file-drag={dragging || undefined}
      onDragEnter={event => {
        if (!event.dataTransfer.types.includes('Files')) return;
        event.preventDefault();
        if (video) return;
        dragDepth.current++;
        if (!pending.current) setDragging(true);
      }} onDragOver={event => {
        if (!event.dataTransfer.types.includes('Files')) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = video || pending.current ? 'none' : 'copy';
      }} onDragLeave={() => {
        dragDepth.current = Math.max(0, dragDepth.current - 1);
        if (!dragDepth.current) setDragging(false);
      }} onDrop={event => {
        if (!event.dataTransfer.types.includes('Files')) return;
        event.preventDefault();
        if (video) return;
        dragDepth.current = 0;
        setDragging(false);
        addFiles(event.dataTransfer.files);
      }}>
      {attachments.length > 0 && <ul className="chat-attachments" aria-label={t('Attachments')}>
        {attachments.map(item => <li key={item.id}>
          <AttachmentChip name={item.name} url={'url' in item ? httpLink(item.url) : undefined}
            note={'file' in item && convert ? t(isTextAttachment(item.mediaType) ? 'As text' : 'Original file') : undefined}>
            <Button type="button" variant="subtle" aria-label={t('Remove {{name}}', { name: item.name })} disabled={preparing || !!image && busy}
              onClick={() => { setAttachments(attachments.filter(other => other.id !== item.id)); setNotice(''); }}><ChatIcon name="close" /></Button>
          </AttachmentChip>
        </li>)}
      </ul>}
      <Textarea aria-label={t(image ? 'Image prompt' : video ? 'Video prompt' : 'Message')}
        placeholder={t(image ? 'Describe a new image' : video ? 'Describe a new video' : 'Ask anything')} rows={media ? 3 : 2} value={draft} readOnly={preparing || media && busy}
        onChange={event => setDraft(event.currentTarget.value)} onKeyDown={event => {
          if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
            event.preventDefault();
            event.currentTarget.form?.requestSubmit();
          }
        }} />
      {dragging && <span className="chat-drop-label" aria-hidden="true">{t('Drop files to attach')}</span>}
      {notice && <p className="chat-attachment-notice" role="alert">{t(notice)}</p>}
      {preparing && <p className="chat-attachment-notice" role="status">{t('Preparing attachments…')}</p>}
      <div className="chat-composer-actions">
        {!video && <div className="chat-attachment-actions">
          <span ref={trigger}><Button className="chat-composer-icon" type="button" variant="subtle" aria-label={t('Add attachments')}
            title={t('Add attachments')} aria-haspopup="menu" aria-expanded={menuOpen} aria-controls={menuOpen ? `${id}-menu` : undefined}
            disabled={preparing || !!image && busy} onClick={() => setMenuOpen(!menuOpen)} onKeyDown={event => {
              if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); setMenuOpen(true); }
            }}><ChatIcon name="add" /></Button></span>
          {menuOpen && <div ref={menu} id={`${id}-menu`} className="chat-attachment-menu" role="menu" aria-label={t('Add attachments')} onKeyDown={menuKeys}>
            <button type="button" role="menuitem" tabIndex={-1} onClick={() => { closeMenu(true); picker.current?.click(); }}><ChatIcon name="attachment" />{t('Files')}</button>
            <button type="button" role="menuitem" tabIndex={-1} onClick={() => {
              closeMenu(true);
              setLinkInput(''); setLinkType(''); setLinkError(false);
              dialog.current?.showModal();
            }}><ChatIcon name="link" />{t('Link')}</button>
          </div>}
          <input ref={picker} type="file" multiple hidden accept={image ? 'image/*' : undefined} onChange={event => {
            if (event.currentTarget.files) addFiles(event.currentTarget.files);
            event.currentTarget.value = '';
          }} />
        </div>}
        {image ? <Button className="chat-composer-icon" type="button" variant="subtle" aria-label={t('Image settings')}
          title={t('Image settings')} aria-haspopup="dialog" disabled={busy} onClick={image.onSettings}><ChatIcon name="settings" /></Button> : !video && <>
          <span className="chat-composer-settings"><Button className="chat-composer-icon" type="button" variant="subtle" aria-label={t('Chat settings')}
            title={t('Chat settings')} aria-haspopup="dialog" onClick={props.onChatSettings}><ChatIcon name="settings" /></Button></span>
          <Button className="chat-composer-icon" type="button" variant="subtle" aria-label={t('View context')}
            title={t('View context')} aria-haspopup="dialog" onClick={props.onViewContext}><ChatIcon name="info" /></Button>
        </>}
        {busy && onStop ? <Button key="stop" type="button" onClick={onStop}>{t('Stop')}</Button>
          : <Button key="send" className="chat-send" type="submit" variant="primary" aria-label={t('Send')} title={t('Send')}
            disabled={busy || !canSend || preparing || (!draft.trim() && (media || !attachments.length))}><ChatIcon name="send" /></Button>}
      </div>
    </form>
    {!video && <dialog ref={dialog} className="chat-settings chat-link-dialog" aria-labelledby={`${id}-link-title`}>
      <form onSubmit={addLink}>
        <header className="chat-settings-header"><h2 id={`${id}-link-title`}>{t('Add link')}</h2></header>
        <div className="chat-link-fields">
          <label htmlFor={`${id}-url`}>{t('URL')}</label>
          <input id={`${id}-url`} type="url" autoFocus required maxLength={4096} placeholder="https://" value={linkInput}
            aria-invalid={linkError || undefined} onChange={event => { setLinkInput(event.currentTarget.value); setLinkError(false); }} />
          {!image && <><label htmlFor={`${id}-type`}>{t('Link type')}</label>
          <select id={`${id}-type`} value={linkType} onChange={event => setLinkType(event.currentTarget.value)}>
            <option value="">{t('Automatic')}</option>
            <option value="text/html">{t('Web page')}</option>
            {['application/pdf', 'image/png', 'image/jpeg', 'image/webp', 'image/gif'].map(type => <option value={type} key={type}>{type}</option>)}
          </select></>}
          {linkError && <p role="alert">{t('Enter an HTTP or HTTPS URL without credentials.')}</p>}
        </div>
        <footer className="chat-tool-footer">
          <Button type="button" variant="subtle" onClick={() => dialog.current?.close()}>{t('Cancel')}</Button>
          <Button type="submit" variant="primary">{t('Add link')}</Button>
        </footer>
      </form>
    </dialog>}
  </>;
}
