import type { ChatMessage } from '@streaik/gateway';
import { Button } from '@streaik/themes';
import { useState } from 'react';
import type { ReactNode } from 'react';
import { ChatIcon } from './ChatIcon';
import { convertedAttachmentName } from './chatAttachments';
import type { AttachmentPart } from './chatAttachments';
import { useAppTranslation } from './i18n';

type Part = ChatMessage['parts'][number];
export type Invocation = Extract<Part, { toolCallId: string }>;
type ActivityPart = Extract<Part, { type: 'reasoning' }> | Invocation;
type Group = { type: 'text'; start: number; text: string } | { type: 'activity'; start: number; parts: ActivityPart[] }
  | { type: 'attachment'; start: number; name?: string; part: AttachmentPart };

export function groupMessageParts(parts: readonly Part[], user = false): Group[] {
  const groups: Group[] = [];
  parts.forEach((part, start) => {
    const last = groups.at(-1);
    const attachmentName = user ? convertedAttachmentName(part) : undefined;
    if (user && (part.type === 'file' || (part.type === 'text' && attachmentName))) {
      groups.push({ type: 'attachment', start, name: part.type === 'file' ? part.filename : attachmentName, part });
    } else if (part.type === 'text' && part.text) {
      if (last?.type === 'text') last.text += part.text;
      else groups.push({ type: 'text', start, text: part.text });
    } else if ((part.type === 'reasoning' && part.text.trim()) || 'toolCallId' in part) {
      if (last?.type === 'activity') last.parts.push(part);
      else groups.push({ type: 'activity', start, parts: [part] });
    }
  });
  return groups;
}

export function invocationName(part: Invocation) {
  return part.title || (part.type === 'dynamic-tool' ? part.toolName : part.type.slice(5));
}

export function ToolValue({ value }: { value: unknown }) {
  return <pre className="chat-tool-value">{typeof value === 'string' ? value : JSON.stringify(value, null, 2)}</pre>;
}

const toolStates = {
  'input-streaming': 'Preparing tool',
  'input-available': 'Tool requested',
  'input-error': 'Tool failed',
  'approval-requested': 'Awaiting approval',
  'approval-responded': 'Approved',
  'output-available': 'Completed',
  'output-error': 'Tool failed',
  'output-denied': 'Declined',
} as const;

export function ChatActivity({ parts, renderMarkdown }: { parts: ActivityPart[]; renderMarkdown: (text: string) => ReactNode }) {
  const { t } = useAppTranslation();
  const [selected, setSelected] = useState(0);
  const page = Math.min(selected, parts.length - 1);
  const part = parts[page];
  const reasoning = part.type === 'reasoning';
  const title = reasoning ? t('Reasoning') : invocationName(part);
  // API Chat reserves an approval record before execution, but MCP only asks to review the result.
  const mcpPending = !reasoning && part.state === 'approval-requested' &&
    (part.type === 'dynamic-tool' ? part.toolName.startsWith('mcp_') : part.type.startsWith('tool-mcp_'));
  const state = reasoning ? undefined : part.approval?.approved === false ? 'Declined' : mcpPending ? 'Tool requested' : toolStates[part.state];
  return <section className="chat-activity" aria-label={t('Assistant activity')}>
    <header className="chat-activity-header">
      <ChatIcon name={reasoning ? 'brain' : 'tool'} />
      <strong>{title}</strong>
      {state && <span className="chat-tool-badge">{t(state)}</span>}
      {parts.length > 1 && <div className="chat-activity-pages">
        <Button type="button" variant="subtle" aria-label={t('Previous activity')} disabled={page === 0}
          onClick={() => setSelected(page - 1)}><span aria-hidden="true">‹</span></Button>
        <span aria-live="polite">{t('{{page, number}} of {{count, number}}', { page: page + 1, count: parts.length })}</span>
        <Button type="button" variant="subtle" aria-label={t('Next activity')} disabled={page === parts.length - 1}
          onClick={() => setSelected(page + 1)}><span aria-hidden="true">›</span></Button>
      </div>}
    </header>
    {reasoning ? <div className="chat-activity-body">{renderMarkdown(part.text)}</div> : <div className="chat-activity-body" key={part.toolCallId}>
      {part.errorText && <p>{part.errorText}</p>}
      {part.input !== undefined && <details><summary>{t('Input')}</summary><ToolValue value={part.input} /></details>}
      {part.output !== undefined && <details><summary>{t('Output')}</summary><ToolValue value={part.output} /></details>}
    </div>}
  </section>;
}
