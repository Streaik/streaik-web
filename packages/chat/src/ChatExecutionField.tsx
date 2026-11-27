import { AgentSelectField } from './AgentToolControls';
import { useAppTranslation } from './i18n';
import type { ChatExecution } from './chatModelContext';

export function ChatExecutionField({ value, onChange, disabled, hostedSupported = true, providerSupported = false }: {
  value?: ChatExecution; onChange: (value: ChatExecution | undefined) => void; disabled?: boolean; hostedSupported?: boolean; providerSupported?: boolean;
}) {
  const { t } = useAppTranslation();
  return <div className="chat-execution-field"><AgentSelectField label={t('Execution')} value={value ?? 'default'} disabled={disabled} options={[
    { value: 'default', label: t('Default') }, { value: 'client', label: t('Client') },
    ...(hostedSupported ? [{ value: 'hosted', label: t('Hosted') }] : []),
    ...(providerSupported ? [{ value: 'provider', label: t('Provider') }] : []),
  ]} onValueChange={mode => onChange(mode === 'hosted' || mode === 'client' || mode === 'provider' && providerSupported ? mode : undefined)} /></div>;
}
