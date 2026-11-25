import type { ChatMessage } from '@streaik/gateway';
import type { ToolOutputPreferences } from './chatPreferences.ts';

type Category = keyof ToolOutputPreferences;
const omitted: Record<Category, string> = {
  text: 'Text content omitted by user settings.',
  links: 'Link content omitted by user settings.',
  images: 'Image content omitted by user settings.',
  audio: 'Audio content omitted by user settings.',
  video: 'Video content omitted by user settings.',
  documents: 'Document content omitted by user settings.',
};

function record(value: unknown): Record<string, unknown> | undefined {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>;
}

const imageTypes = ['image/png', 'image/jpeg', 'image/webp'];
export const maxMcpImagePreviews = 4;

export function mcpImagePreview(mimeType: unknown, data: unknown): string | undefined {
  if (typeof mimeType === 'string' && imageTypes.includes(mimeType) && typeof data === 'string' &&
      data.length <= 7_000_000 && /^[A-Za-z0-9+/]+={0,2}$/.test(data)) {
    return `data:${mimeType};base64,${data}`;
  }
}

function resourceContent(value: unknown) {
  const item = record(value);
  return item && typeof item.uri === 'string' && (typeof item.text === 'string' || typeof item.blob === 'string') ? item : undefined;
}

type ToolResultDisplay = {
  structured?: Record<string, unknown>;
  text?: string[];
  images?: string[];
  output?: unknown;
  isError?: boolean;
};

/** Project an MCP result for display only. Unsupported content and metadata remain inspectable in Output. */
export function describeToolOutput(value: unknown): ToolResultDisplay {
  const result = record(value);
  if (!result) return { output: value };
  const key = Array.isArray(result.content) ? 'content' : Array.isArray(result.contents) && result.contents.length &&
    result.contents.every(resourceContent) ? 'contents' : undefined;
  if (!key) return { output: value };

  const isError = result.isError === true;
  const structured = key === 'content' ? record(result.structuredContent) : undefined;
  const text: string[] = [], images: string[] = [], unhandled: unknown[] = [];
  for (const value of result[key] as unknown[]) {
    const block = record(value);
    if (!block) { unhandled.push(value); continue; }
    const resource = key === 'contents' ? block : block.type === 'resource' ? resourceContent(block.resource) : undefined;
    if (resource) {
      const { text: body, blob, ...metadata } = resource;
      const preview = !isError && images.length < maxMcpImagePreviews && mcpImagePreview(resource.mimeType, blob);
      if (typeof body === 'string' && blob === undefined) text.push(body);
      else if (preview && body === undefined) images.push(preview);
      else { unhandled.push(value); continue; }
      unhandled.push(key === 'contents' ? metadata : { ...block, resource: metadata });
    } else if (block.type === 'text' && typeof block.text === 'string') {
      const { type, text: body, ...metadata } = block;
      text.push(body as string);
      if (Object.keys(metadata).length) unhandled.push({ type, ...metadata });
    } else {
      const preview = block.type === 'image' && !isError && images.length < maxMcpImagePreviews && mcpImagePreview(block.mimeType, block.data);
      if (!preview) { unhandled.push(value); continue; }
      images.push(preview);
      const { type, mimeType, data: _data, ...metadata } = block;
      if (Object.keys(metadata).length) unhandled.push({ type, mimeType, ...metadata });
    }
  }

  if (!structured && !text.length && !images.length) return { output: value, isError };
  const remainder = Object.fromEntries(Object.entries(result).filter(([field, value]) => field !== key &&
    !(field === 'structuredContent' && structured) && !(field === 'isError' && typeof value === 'boolean')));
  if (unhandled.length) remainder[key] = unhandled;
  return { structured, text, images, isError, ...(Object.keys(remainder).length && { output: remainder }) };
}

function contentCategory(value: unknown): Category | undefined {
  const block = record(value);
  if (!block) return;
  if (block.type === 'text') return 'text';
  // A link stays a link even when its MIME type describes an image or document.
  if (block.type === 'resource_link') return 'links';
  const mime = block.type === 'resource' ? record(block.resource)?.mimeType : block.mimeType;
  if (typeof mime !== 'string') return;
  const type = mime.split(';', 1)[0].trim().toLowerCase();
  if (type.startsWith('text/') || type.endsWith('+json') || type.endsWith('+xml') ||
      ['application/json', 'application/xml', 'application/javascript', 'application/x-javascript', 'application/graphql'].includes(type)) return 'text';
  if (type.startsWith('image/')) return 'images';
  if (type.startsWith('audio/')) return 'audio';
  if (type.startsWith('video/')) return 'video';
  if (type.startsWith('application/')) return 'documents';
}

/** Filter MCP content on the outbound copy, not the approved or saved transcript. */
export function filterToolOutputContent(messages: ChatMessage[], settings: ToolOutputPreferences): ChatMessage[] {
  return messages.map(message => {
    if (message.role !== 'assistant') return message;
    let changed = false;
    const parts = message.parts.map(part => {
      // Some native routes omit providerExecuted for client calls instead of setting it to false.
      if (!('toolCallId' in part) || part.providerExecuted || part.state !== 'output-available') return part;
      const output = record(part.output);
      if (!output || !Array.isArray(output.content)) return part;
      let filtered = false;
      const content = output.content.map((block: unknown) => {
        const category = contentCategory(block);
        if (!category || settings[category]) return block;
        filtered = true;
        return { type: 'text', text: omitted[category] };
      });
      if (!filtered) return part;
      changed = true;
      return { ...part, output: { ...output, content } };
    });
    return changed ? { ...message, parts } : message;
  });
}
