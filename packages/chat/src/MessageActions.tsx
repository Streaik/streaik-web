import type { ChatMessage } from '@streaik/gateway';
import { Button, Tooltip } from '@streaik/themes';
import type { IconName } from '@streaik/themes';
import { useState } from 'react';
import { ChatIcon } from './ChatIcon';
import { browserNumberFormat, useAppTranslation } from './i18n';

const integer = browserNumberFormat({ maximumFractionDigits: 0 });
const seconds = browserNumberFormat({ maximumFractionDigits: 2 });
const dollars = browserNumberFormat({ minimumFractionDigits: 2, maximumFractionDigits: 8 });

function number(value: unknown): number | undefined {
  const parsed = typeof value === 'string' && value.trim() ? Number(value) : value;
  return typeof parsed === 'number' && Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

function Badge({ icon, label, value, format, unit = '', details }: {
  icon: IconName; label: string; value: unknown; format: Intl.NumberFormat; unit?: string; details?: string;
}) {
  const amount = number(value);
  if (amount === undefined) return null;
  const text = `${format.format(amount)}${unit}`;
  return <Tooltip content={details ? `${label} (${details})` : label} visualOnly><span className="chat-badge" role="img"
    aria-label={`${label}: ${text}${details ? ` (${details})` : ''}`}><ChatIcon name={icon} />{text}</span></Tooltip>;
}

export function MessageActions({ message, userText }: { message: ChatMessage; userText?: string }) {
  const { t } = useAppTranslation();
  const [copyStatus, setCopyStatus] = useState('');
  const user = message.role === 'user';
  const text = user ? userText : message.parts.flatMap(part => part.type === 'text' && part.text ? [part.text] : []).join('\n\n');
  if (user && !text) return null;
  const { usage, providerMetadata, gateway } = (user ? undefined : message.metadata) ?? {};
  const metrics = providerMetadata?.gateway ?? gateway;
  const costLabel = metrics?.source === 'direct'
    ? metrics.estimated ? 'Estimated direct cost (USD)' : 'Provider-reported cost (USD)'
    : metrics?.estimated ? 'Estimated gateway cost (USD)' : 'Gateway cost (USD)';
  const input = number(usage?.promptTokens);
  const output = number(usage?.completionTokens);
  const tokens = number(usage?.totalTokens) ?? (input !== undefined && output !== undefined ? input + output : undefined);
  const breakdown = [input !== undefined ? t('{{count, number}} input', { count: input }) : '', output !== undefined ? t('{{count, number}} output', { count: output }) : '']
    .filter(Boolean).join(' · ');
  return <div className="chat-message-actions">
    {text && <Button variant="subtle" className="chat-copy" aria-label={t(user ? 'Copy user message' : 'Copy assistant message')} title={t('Copy')} onClick={async () => {
      try { await navigator.clipboard.writeText(text); setCopyStatus('Copied'); }
      catch { setCopyStatus('Copy failed'); }
    }}><ChatIcon name={copyStatus === 'Copied' ? 'check' : 'copy'} /></Button>}
    <Badge icon="tokens" label={t(tokens !== undefined ? 'Total tokens' : input !== undefined ? 'Input tokens' : 'Output tokens')}
      value={tokens ?? input ?? output} format={integer} details={tokens !== undefined ? breakdown : undefined} />
    <Badge icon="cost" label={t(costLabel)} value={metrics?.cost} format={dollars} />
    <Badge icon="timer" label={t('Time to first token')} value={metrics?.ttft} format={seconds} unit=" s" />
    <Badge icon="speed" label={t('Tokens per second')} value={metrics?.tps} format={integer} unit=" tok/s" />
    {copyStatus && <span role="status">{t(copyStatus)}</span>}
  </div>;
}
