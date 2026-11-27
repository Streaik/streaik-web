import type { ChatMessage } from '@streaik/gateway';
import { Button } from '@streaik/themes';
import { useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { ChatIcon } from './ChatIcon';
import { convertedAttachmentName } from './chatAttachments';
import type { AttachmentPart } from './chatAttachments';
import { isDecisionActivity } from './decisionActivity';
import { useAppTranslation } from './i18n';
import { ToolDetails } from './ToolDetails';
import { describeToolOutput } from './toolOutputContent';

type Part = ChatMessage['parts'][number];
export type Invocation = Extract<Part, { toolCallId: string }>;
type ActivityPart = Extract<Part, { type: 'reasoning' }> | Invocation;
type Group = { type: 'text'; start: number; text: string } | { type: 'activity'; start: number; parts: ActivityPart[]; decision?: true }
  | { type: 'attachment'; start: number; name?: string; part: AttachmentPart };

export function groupMessageParts(parts: readonly Part[], user = false, showDecisions = true): Group[] {
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
      // Keep decision cards visible even when the answer also contains reasoning or tools.
      if (isDecisionActivity(part)) {
        if (showDecisions) groups.push({ type: 'activity', start, parts: [part], decision: true });
      } else if (last?.type === 'activity' && !last.decision) last.parts.push(part);
      else groups.push({ type: 'activity', start, parts: [part] });
    }
  });
  return groups;
}

export function invocationName(part: Invocation) {
  return part.title || (part.type === 'dynamic-tool' ? part.toolName : part.type.slice(5));
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
  const [manualPage, setManualPage] = useState<number>();
  const lastPage = parts.length - 1;
  const page = Math.min(manualPage ?? lastPage, lastPage);
  const part = parts[page];
  const reasoning = part.type === 'reasoning';
  const decision = isDecisionActivity(part);
  const output = reasoning ? undefined : part.output;
  const result = useMemo(() => describeToolOutput(output), [output]);
  const title = reasoning ? t('Reasoning') : decision ? t('Model decision') : invocationName(part);
  const fallback = decision && output && typeof output === 'object' && 'fallback' in output && output.fallback === true;
  // API Chat reserves an approval record before execution, but MCP only asks to review the result.
  const mcpPending = !reasoning && part.state === 'approval-requested' &&
    (part.type === 'dynamic-tool' ? part.toolName.startsWith('mcp_') : part.type.startsWith('tool-mcp_'));
  const state = reasoning ? undefined : part.approval?.approved === false ? 'Declined' : mcpPending ? 'Tool requested'
    : fallback ? 'Fallback used' : result.isError ? 'Tool failed' : toolStates[part.state];
  return <section className="chat-activity" aria-label={t('Assistant activity')}>
    <header className="chat-activity-header">
      <ChatIcon name={reasoning ? 'brain' : 'tool'} />
      <strong>{title}</strong>
      {state && <span className="chat-tool-badge">{t(state)}</span>}
      {parts.length > 1 && <div className="chat-activity-pages">
        <Button type="button" variant="subtle" aria-label={t('Previous activity')} disabled={page === 0}
          onClick={() => setManualPage(page - 1)}><span aria-hidden="true">‹</span></Button>
        <span aria-live="polite">{t('{{page, number}} of {{count, number}}', { page: page + 1, count: parts.length })}</span>
        <Button type="button" variant="subtle" aria-label={t('Next activity')} disabled={page === lastPage}
          onClick={() => setManualPage(page + 1)}><span aria-hidden="true">›</span></Button>
      </div>}
    </header>
    {reasoning ? <div className="chat-activity-body">{renderMarkdown(part.text)}</div> : <div className="chat-activity-body" key={part.toolCallId}>
      {part.errorText && <p>{decision ? t(part.errorText) : part.errorText}</p>}
      <ToolDetails input={part.input} result={result} />
    </div>}
  </section>;
}
