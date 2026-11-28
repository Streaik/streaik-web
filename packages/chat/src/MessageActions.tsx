import type { ChatMessage } from '@streaik/gateway';
import { Button, Tooltip } from '@streaik/themes';
import type { IconName } from '@streaik/themes';
import { useState } from 'react';
import { OutputAttachmentMenu } from './AssistantAttachments';
import { ChatIcon } from './ChatIcon';
import { browserNumberFormat, useAppTranslation } from './i18n';
import { messageCost, messageTokens, nonnegativeNumber } from './messageMetadata';
import type { OutputAttachment } from './outputAttachments';
import type { MessageSpeechState, ToggleMessageSpeech } from './useMessageSpeech';

const integer = browserNumberFormat({ maximumFractionDigits: 0 });
const seconds = browserNumberFormat({ maximumFractionDigits: 2 });
const costFormat = browserNumberFormat({ minimumFractionDigits: 2, maximumFractionDigits: 8 });

function Badge({ icon, label, value, format, unit = '', details }: {
  icon: IconName; label: string; value: unknown; format: Intl.NumberFormat; unit?: string; details?: string;
}) {
  const amount = nonnegativeNumber(value);
  if (amount === undefined) return null;
  const text = `${format.format(amount)}${unit}`;
  return <Tooltip content={details ? `${label} (${details})` : label} visualOnly><span className="chat-badge" role="img"
    aria-label={`${label}: ${text}${details ? ` (${details})` : ''}`}><ChatIcon name={icon} />{text}</span></Tooltip>;
}

export function MessageActions({ message, userText, showMessageTokens, showMetrics, pendingReply, speechState, onReadAloud, attachments, menuContainer }: {
  message: ChatMessage; userText?: string; showMessageTokens: boolean; showMetrics: boolean;
  pendingReply: boolean; speechState?: MessageSpeechState; onReadAloud?: ToggleMessageSpeech;
  attachments?: readonly OutputAttachment[]; menuContainer: HTMLDivElement | null;
}) {
  const { t } = useAppTranslation();
  const [copyStatus, setCopyStatus] = useState('');
  const user = message.role === 'user';
  const text = user ? userText : message.parts.flatMap(part => part.type === 'text' && part.text ? [part.text] : []).join('\n\n');
  const spokenText = message.role === 'assistant' && (!pendingReply || speechState) ? text?.trim() : undefined;
  const speaking = speechState?.phase === 'generating' || speechState?.phase === 'playing';
  const speechLabel = speechState?.phase === 'generating' ? t('Cancel speech generation') : speaking ? t('Stop reading aloud') : t('Read aloud');
  if (user && !text) return null;
  const metadata = user ? undefined : message.metadata;
  const { providerMetadata, gateway } = metadata ?? {};
  const metrics = providerMetadata?.gateway ?? gateway;
  const { cost, source } = messageCost(metadata);
  const costLabel = source === 'direct' ? 'Direct cost' : 'Gateway cost';
  const { input, output, total: tokens } = messageTokens(metadata);
  const breakdown = [input !== undefined ? t('{{count, number}} input', { count: input }) : '', output !== undefined ? t('{{count, number}} output', { count: output }) : '']
    .filter(Boolean).join(' · ');
  return <div className="chat-message-actions">
    {text && <Button variant="subtle" className="chat-copy" aria-label={t(user ? 'Copy user message' : 'Copy assistant message')} title={t('Copy')} onClick={async () => {
      try { await navigator.clipboard.writeText(text); setCopyStatus('Copied'); }
      catch { setCopyStatus('Copy failed'); }
    }}><ChatIcon name={copyStatus === 'Copied' ? 'check' : 'copy'} /></Button>}
    {spokenText && <Button type="button" variant="subtle" className="chat-read-aloud" disabled={!onReadAloud}
      aria-label={speechLabel} title={onReadAloud ? speechLabel : t('No configured speech model is available.')}
      onClick={() => { void onReadAloud?.(message.id, spokenText); }}><ChatIcon name={speaking ? 'stop' : 'audio'} /></Button>}
    {!!attachments?.length && menuContainer && <OutputAttachmentMenu files={attachments} container={menuContainer} />}
    {showMessageTokens && <Badge icon="tokens" label={t(tokens !== undefined ? 'Total tokens' : input !== undefined ? 'Input tokens' : 'Output tokens')}
      value={tokens ?? input ?? output} format={integer} details={tokens !== undefined ? breakdown : undefined} />}
    <Badge icon="cost" label={t(costLabel)} value={cost} format={costFormat} />
    {showMetrics && <>
      <Badge icon="timer" label={t('Time to first token')} value={metrics?.ttft} format={seconds} unit=" s" />
      <Badge icon="speed" label={t('Tokens per second')} value={metrics?.tps} format={integer} unit=" tok/s" />
    </>}
    {copyStatus && <span role="status">{t(copyStatus)}</span>}
    {speechState?.phase === 'generating' && <span role="status">{t('Generating speech…')}</span>}
    {speechState?.phase === 'blocked' && <span role="status">{t('Select Read aloud again to play this message.')}</span>}
    {speechState?.phase === 'error' && <span role="alert">{t(speechState.message)}</span>}
  </div>;
}
