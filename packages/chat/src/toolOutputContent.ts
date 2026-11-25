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
