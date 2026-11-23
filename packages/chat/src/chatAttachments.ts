import type { ChatMessage } from '@streaik/gateway';

export type AttachmentPart = Extract<ChatMessage['parts'][number], { type: 'file' | 'text' }>;
export type DraftAttachment = { id: number; name: string } & (
  { file: File; mediaType: string } | { url: string; mediaType: string }
);

// Leave room for base64, conversation history and tool payloads in the chat request.
export const attachmentByteLimit = 10 * 1024 * 1024;
export const attachmentCountLimit = 10;

const mediaTypes: Readonly<Record<string, string>> = {
  txt: 'text/plain', md: 'text/markdown', markdown: 'text/markdown', log: 'text/plain', csv: 'text/csv',
  tsv: 'text/tab-separated-values', json: 'application/json', jsonl: 'application/jsonl', xml: 'application/xml',
  html: 'text/html', htm: 'text/html', css: 'text/css', js: 'text/javascript', ts: 'text/plain',
  yml: 'application/yaml', yaml: 'application/yaml', pdf: 'application/pdf',
  doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp',
};

function inferMediaType(name: string) {
  const extension = name.match(/\.([a-z0-9]+)$/i)?.[1].toLowerCase();
  return extension && Object.hasOwn(mediaTypes, extension) ? mediaTypes[extension] : undefined;
}

export function fileMediaType(file: File) {
  const type = file.type.toLowerCase();
  if (type !== 'application/octet-stream' && /^[\w.+-]+\/[\w.+-]+$/.test(type)) return type;
  return inferMediaType(file.name) ?? 'application/octet-stream';
}

export function httpLink(value: string) {
  if (value.length > 4096 || !/^https?:\/\//i.test(value.trim())) return;
  try {
    const url = new URL(value.trim());
    if ((url.protocol === 'https:' || url.protocol === 'http:') && !url.username && !url.password) return url;
  } catch { /* Show inline validation instead. */ }
}

export function linkMediaType(url: URL) {
  return inferMediaType(url.pathname) ?? 'text/html';
}

export function isTextAttachment(mediaType: string) {
  return mediaType.startsWith('text/') || /^application\/(?:jsonl?|x-ndjson|xml|y(?:a)?ml|[\w.-]+\+(?:json|xml))$/.test(mediaType);
}

function asDataUrl(file: File, mediaType: string) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.onabort = () => reject(new Error('File reading was cancelled.'));
    reader.readAsDataURL(file.slice(0, file.size, mediaType));
  });
}

export function convertedAttachmentName(part: ChatMessage['parts'][number]) {
  if (part.type !== 'text') return;
  const name = part.providerMetadata?.streaik?.attachmentName;
  if (typeof name === 'string') return name;
}

export async function composeAttachmentParts(text: string, attachments: readonly DraftAttachment[], convert: boolean) {
  const parts: AttachmentPart[] = [];
  if (text.trim()) parts.push({ type: 'text', text: text.trim() });
  for (const attachment of attachments) {
    const { name, mediaType } = attachment;
    if ('file' in attachment && convert && isTextAttachment(mediaType)) {
      const content = await attachment.file.text();
      parts.push({ type: 'text', text: `\n\nFile: ${JSON.stringify(name)}\n${content}`,
        providerMetadata: { streaik: { attachmentName: name } } });
    } else {
      const url = 'file' in attachment ? await asDataUrl(attachment.file, mediaType) : attachment.url;
      parts.push({ type: 'file', mediaType, url, filename: name });
    }
  }
  return parts;
}
