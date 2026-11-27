import { TabList } from '@streaik/themes';
import { useAppTranslation } from './i18n';

export function DialogTabs<T extends string>({ id, label, tabs, value, onChange, className = 'chat-tool-tabs' }: {
  id: string; label: string; tabs: ReadonlyArray<readonly [T, string]>; value: T; onChange: (tab: T) => void; className?: string;
}) {
  const { t } = useAppTranslation();
  return <TabList className={className} label={label} moreLabel={t('More tabs')} value={value} onValueChange={onChange}
    items={tabs.map(([key, title]) => ({ value: key, id: `${id}-${key}-tab`, panelId: `${id}-${key}-panel`, label: title }))} />;
}
