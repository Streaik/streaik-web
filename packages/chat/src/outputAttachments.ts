import type { ChatMessage } from '@streaik/gateway';
import { httpLink } from './chatAttachments.ts';

type Preview = 'image' | 'video';
type FileCandidate = {
  id: string;
  url: string;
  origin?: string;
  name?: string;
  mediaType: string;
  preview?: Preview;
  reference?: boolean;
};
export type OutputAttachment = FileCandidate & { name: string };

const rasterImages = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/avif', 'image/bmp', 'image/x-icon']);
const extensions: Readonly<Record<string, string>> = {
  'image/jpeg': 'jpg', 'image/svg+xml': 'svg', 'image/x-icon': 'ico', 'audio/mpeg': 'mp3', 'video/quicktime': 'mov',
  'application/msword': 'doc', 'application/vnd.ms-excel': 'xls', 'application/vnd.ms-powerpoint': 'ppt',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
  'text/plain': 'txt', 'text/markdown': 'md', 'application/octet-stream': 'bin',
};

function record(value: unknown) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function mime(value: unknown) {
  if (typeof value !== 'string') return;
  const type = value.split(';', 1)[0].trim().toLowerCase();
  if (/^[\w.+-]+\/[\w.+-]+$/.test(type)) return type;
}

function filename(value: unknown) {
  if (typeof value !== 'string') return;
  const name = value.split(/[/\\]/).at(-1)?.replace(/[\p{Cc}\p{Cf}<>:"|?*]/gu, '').trim().replace(/\.+$/, '').slice(0, 180);
  return name || undefined;
}

function urlFilename(value: string) {
  try { return filename(decodeURIComponent(new URL(value).pathname.split('/').at(-1) ?? '')); }
  catch { return undefined; }
}

function base64(value: string) {
  return value.length % 4 !== 1 && /^[A-Za-z0-9+/]+={0,2}$/.test(value) && (!value.endsWith('=') || value.length % 4 === 0);
}

function previewKind(type: string): Preview | undefined {
  return rasterImages.has(type) ? 'image' : type.startsWith('video/') ? 'video' : undefined;
}

function urlFile(id: string, value: unknown, type: unknown, name?: unknown, reference = false): FileCandidate | undefined {
  if (typeof value !== 'string') return;
  let mediaType = mime(type) ?? 'application/octet-stream';
  if (!reference && /^data:/i.test(value)) {
    const comma = value.indexOf(',');
    if (comma < 5 || comma > 256 || comma === value.length - 1) return;
    const header = value.slice(5, comma);
    const dataType = mime(header) ?? 'text/plain';
    const encoded = /;base64$/i.test(header);
    if (encoded && !base64(value.slice(comma + 1))) return;
    if (mediaType === 'application/octet-stream') mediaType = dataType;
    return { id, url: value, name: filename(name), mediaType, preview: mediaType === dataType ? previewKind(mediaType) : undefined };
  }
  const url = httpLink(value);
  if (url) return { id, url: url.href, origin: url.origin, name: filename(name) ?? urlFilename(url.href), mediaType,
    reference, preview: reference ? undefined : previewKind(mediaType) };
}

function embeddedFile(id: string, data: unknown, type: unknown, name?: unknown): FileCandidate | undefined {
  if (typeof data !== 'string' || !base64(data)) return;
  const mediaType = mime(type) ?? 'application/octet-stream';
  return { id, url: `data:${mediaType};base64,${data}`, name: filename(name), mediaType, preview: previewKind(mediaType) };
}

function resourceFile(id: string, value: unknown) {
  const resource = record(value);
  if (!resource || typeof resource.uri !== 'string' || typeof resource.text === 'string') return;
  const name = resource.name ?? resource.filename ?? urlFilename(resource.uri);
  return typeof resource.blob === 'string' ? embeddedFile(id, resource.blob, resource.mimeType, name)
    : urlFile(id, resource.uri, resource.mimeType, name, true);
}

function toolFiles(id: string, value: unknown): FileCandidate[] {
  const result = record(value);
  if (!result || result.isError === true) return [];
  if (Array.isArray(result.content)) return result.content.flatMap((value, index) => {
    const block = record(value);
    if (!block) return [];
    const key = `${id}:${index}`;
    const file = block.type === 'image' || block.type === 'audio' ? embeddedFile(key, block.data, block.mimeType, block.name ?? block.filename)
      : block.type === 'resource' ? resourceFile(key, block.resource)
      : block.type === 'resource_link' ? urlFile(key, block.uri, block.mimeType, block.name, true) : undefined;
    return file ? [file] : [];
  });
  // MCP resources/read uses `contents` instead of `content`.
  if (Array.isArray(result.contents)) return result.contents.flatMap((value, index) => {
    const file = resourceFile(`${id}:${index}`, value);
    return file ? [file] : [];
  });
  return [];
}

// Messages are immutable SDK snapshots. Don't revalidate large files in older replies on every streamed text delta.
const filesByMessage = new WeakMap<ChatMessage, FileCandidate[]>();
function messageFiles(message: ChatMessage) {
  const cached = filesByMessage.get(message);
  if (cached) return cached;
  const files = message.parts.flatMap((part, index) => {
    const id = `${message.id}:${index}`;
    if (part.type === 'file') {
      const file = urlFile(id, part.url, part.mediaType, part.filename ?? part.providerMetadata?.streaik?.attachmentName);
      return file ? [file] : [];
    }
    if ('toolCallId' in part && part.state === 'output-available' && !part.preliminary) {
      return toolFiles(id, part.output);
    }
    return [];
  });
  filesByMessage.set(message, files);
  return files;
}

/** A turn can span several assistant messages if a tool continuation starts a new response ID. */
export function outputAttachmentsByReply(messages: readonly ChatMessage[]) {
  const replies = new Map<string, OutputAttachment[]>();
  let files: FileCandidate[] = [];
  messages.forEach((message, index) => {
    if (message.role !== 'assistant') return;
    for (const file of messageFiles(message)) files.push(file);
    if (messages[index + 1]?.role === 'assistant' || !files.length) return;
    replies.set(message.id, files.map((file, index) => {
      const subtype = file.mediaType.split('/')[1];
      const ext = extensions[file.mediaType] ?? (/^[a-z0-9]{1,8}$/.test(subtype) ? subtype : 'bin');
      return { ...file, name: file.name ?? `${file.preview ?? 'attachment'}-${index + 1}.${ext}` };
    }));
    files = [];
  });
  return replies;
}
