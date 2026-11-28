import * as Menu from '@radix-ui/react-dropdown-menu';
import { Button, Tooltip } from '@streaik/themes';
import { useState } from 'react';
import { ChatIcon } from './ChatIcon';
import { useAppTranslation } from './i18n';
import type { OutputAttachment } from './outputAttachments';

export function AssistantImages({ files }: { files: readonly OutputAttachment[] }) {
  const images = files.filter(file => file.preview === 'image');
  if (!images.length) return null;
  return <div className="chat-output-images" data-single={images.length === 1}>
    {images.map(file => <img key={file.id} src={file.url} alt={file.name} decoding="async" referrerPolicy="no-referrer" />)}
  </div>;
}

export function AssistantVideo({ file }: { file: OutputAttachment }) {
  const { t } = useAppTranslation();
  const [failedUrl, setFailedUrl] = useState<string>();
  return <>
    <video className="chat-output-video" src={file.url} controls playsInline preload="metadata" aria-label={file.name}
      onError={() => setFailedUrl(file.url)} />
    {failedUrl === file.url && <p role="status">{t('Could not play this video.')}</p>}
  </>;
}

export function OutputAttachmentMenu({ files, container }: { files: readonly OutputAttachment[]; container: HTMLDivElement }) {
  const { t } = useAppTranslation();
  const label = t('Attachments');
  return <Menu.Root modal={false}>
    <Tooltip content={label} visualOnly><Menu.Trigger asChild>
      <Button className="chat-output-attachments" type="button" variant="subtle" aria-label={label}><ChatIcon name="attachment" /></Button>
    </Menu.Trigger></Tooltip>
    <Menu.Portal container={container}>
      <Menu.Content className="chat-menu chat-output-menu" align="start" sideOffset={4} collisionPadding={8} hideWhenDetached>
        {files.map(file => {
          // Browsers can honor `download` for embedded data or same-origin files, but not arbitrary external URLs.
          const download = !file.reference && (!file.origin || file.origin === window.location.origin);
          const action = t(download ? 'Download {{filename}}' : 'Open file: {{filename}}', { filename: file.name });
          return <Menu.Item key={file.id} className="chat-menu-item" asChild textValue={file.name}>
            <a href={file.url} aria-label={action} title={action} download={download ? file.name : undefined}
              target={download ? undefined : '_blank'} rel={download ? undefined : 'noopener noreferrer'}>
              <ChatIcon name={download ? 'download' : 'link'} /><span>{file.name}</span>
            </a>
          </Menu.Item>;
        })}
      </Menu.Content>
    </Menu.Portal>
  </Menu.Root>;
}
