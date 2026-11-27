import { useAppTranslation } from './i18n';
import type { SkillExecution } from './chatPreferences';

export function SkillExecutionField({ value, onChange, disabled }: {
  value?: SkillExecution; onChange: (value: SkillExecution | undefined) => void; disabled?: boolean;
}) {
  const { t } = useAppTranslation();
  return <label className="agent-field skill-execution-field">
    <span>{t('Execution')}</span>
    <select className="ui-select" value={value ?? ''} disabled={disabled} onChange={({ currentTarget }) => {
      const mode = currentTarget.value;
      onChange(mode === 'hosted' || mode === 'client' ? mode : undefined);
    }}>
      <option value="">{t('Default')}</option>
      <option value="hosted">{t('Hosted')}</option>
      <option value="client">{t('Client')}</option>
    </select>
  </label>;
}
