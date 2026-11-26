import { Tooltip } from '@streaik/themes';
import { ChatIcon } from './ChatIcon';
import { browserNumberFormat, useAppTranslation } from './i18n';

const compact = browserNumberFormat({ notation: 'compact', maximumFractionDigits: 1 });
const integer = browserNumberFormat({ maximumFractionDigits: 0 });
const costFormat = browserNumberFormat({ minimumFractionDigits: 2, maximumFractionDigits: 8 });

export function ComposerUsage({ context, cost }: { context?: { used: number; window: number; maxOutput?: number }; cost?: number }) {
  const { t } = useAppTranslation();
  if (!context && cost === undefined) return null;
  const contextLabel = context && t('Tokens used: {{usedTokens}} of {{totalTokens}}', {
    usedTokens: integer.format(context.used), totalTokens: integer.format(context.window),
  });
  const contextDetails = context?.maxOutput && context.maxOutput > 0 ? [contextLabel,
    t('Tokens available for output: {{max_output_tokens}}', { max_output_tokens: integer.format(context.maxOutput) }),
    t('Available space: {{availableSpace}}', { availableSpace: integer.format(Math.max(0, context.window - context.used - context.maxOutput)) }),
  ].join(' · ') : contextLabel;
  const costLabel = t('Conversation cost');
  const price = cost === undefined ? undefined : costFormat.format(cost);
  return <div className="chat-composer-usage">
    {context && <Tooltip content={contextDetails} visualOnly><span className="chat-context-usage">
      <progress aria-label={t('Context window')} aria-valuetext={contextDetails} max={context.window} value={Math.min(context.used, context.window)} />
      <span aria-hidden="true">{compact.format(context.used)}/{compact.format(context.window)}</span>
    </span></Tooltip>}
    {price !== undefined && <Tooltip content={costLabel} visualOnly><span className="chat-badge" role="img" aria-label={`${costLabel}: ${price}`}>
      <ChatIcon name="cost" />{price}</span></Tooltip>}
  </div>;
}
