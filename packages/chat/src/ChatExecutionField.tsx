import { AgentSelectField } from './AgentToolControls';
import { useAppTranslation } from './i18n';
import type { ChatExecution } from './chatModelContext';

export function ChatExecutionField({ value, onChange, disabled, hostedSupported = true }: {
  value?: ChatExecution; onChange: (value: ChatExecution | undefined) => void; disabled?: boolean; hostedSupported?: boolean;
}) {
  const { t } = useAppTranslation();
  return <div className="chat-execution-field"><AgentSelectField label={t('Execution')} value={value ?? 'default'} disabled={disabled} options={[
    { value: 'default', label: t('Default') }, { value: 'client', label: t('Client') },
    ...(hostedSupported ? [{ value: 'hosted', label: t('Hosted') }] : []),
  ]} onValueChange={mode => onChange(mode === 'hosted' || mode === 'client' ? mode : undefined)} /></div>;
}
