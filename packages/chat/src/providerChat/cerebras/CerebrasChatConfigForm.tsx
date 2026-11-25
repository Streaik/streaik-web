import { Card, Choice, Integer, ParallelCalls, setOption } from '../fields';
import type { ProviderFormProps } from '../fields';
import { supportsGptOssEffort } from '../settings';
import { useAppTranslation } from '../../i18n';

export function CerebrasChatConfigForm({ value, onChange, models }: ProviderFormProps) {
  const { t } = useAppTranslation();
  return <>
    <Card title="Reasoning">{models.some(model => supportsGptOssEffort(model.id))
      ? <Choice label="Reasoning effort" value={value.reasoning_effort} choices={['none', 'low', 'medium', 'high']}
        onChange={effort => onChange(setOption(value, 'reasoning_effort', effort))} />
      : <p>{t('Reasoning effort is not available for the selected models.')}</p>}</Card>
    <Card title="Other">
      <Integer label="Seed" value={value.seed} onChange={seed => onChange(setOption(value, 'seed', seed))} />
      <ParallelCalls value={value} onChange={onChange} />
    </Card>
  </>;
}
