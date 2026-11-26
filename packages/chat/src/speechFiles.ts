import { attachmentByteLimit, attachmentCountLimit, fileMediaType, isTextAttachment } from './chatAttachments.ts';

export const speechFileAccept = 'text/*,.txt,.md,.markdown,.csv,.tsv,.json,.jsonl,.xml,.yaml,.yml,.srt,.vtt,.ssml';

export async function importSpeechText(files: readonly File[]) {
  if (files.length > attachmentCountLimit || files.reduce((size, file) => size + file.size, 0) > attachmentByteLimit) {
    return { text: '', issue: 'Choose up to 10 text files totaling no more than 10 MB.' };
  }
  const parts = await Promise.all(files.map(async file => {
    if (!isTextAttachment(fileMediaType(file)) && !/\.(srt|vtt|ssml)$/i.test(file.name)) return '';
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const encoding = bytes[0] === 255 && bytes[1] === 254 ? 'utf-16le' : bytes[0] === 254 && bytes[1] === 255 ? 'utf-16be' : 'utf-8';
      const text = new TextDecoder(encoding, { fatal: true }).decode(bytes).trim();
      return text.includes('\0') ? '' : text;
    } catch { return ''; }
  }));
  return { text: parts.filter(Boolean).join('\n\n'), issue: parts.some(part => !part) ? 'Some files could not be imported as text.' : '' };
}
