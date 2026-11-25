import { ChatIcon } from './ChatIcon';
import { useAppTranslation } from './i18n';

export function VersionBadge({ version }: { version: string | number }) {
  const { t } = useAppTranslation();
  const text = String(version);
  return <span className="chat-badge" role="img" aria-label={t('Version {{version}}', { version })}>
    <ChatIcon name="tag" />{/^v\d/i.test(text) ? text : `v${text}`}
  </span>;
}
