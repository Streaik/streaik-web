import type { ChatModel } from '@streaik/gateway';
import { Select } from '@streaik/themes';
import { providerName } from './aiCatalog';
import { useAppTranslation } from './i18n';

function modelOptions(models: readonly ChatModel[]) {
  const providers = new Map<string, ChatModel[]>();
  for (const model of models) {
    const group = providers.get(model.provider);
    if (group) group.push(model);
    else providers.set(model.provider, [model]);
  }
  return [...providers].flatMap(([provider, models]) => {
    const group = { id: provider, label: providerName(provider) };
    return models.sort((a, b) => a.created === b.created ? 0 : (b.created ?? -Infinity) - (a.created ?? -Infinity))
      .map(({ id, name }) => ({ value: id, label: name, group }));
  });
}

function modelSummary(selected: readonly string[], models: readonly ChatModel[]) {
  if (selected.length < 2) return;
  const withoutProvider = (id: string) => id.slice(id.indexOf('/') + 1);
  const ids = new Set(models.map(({ id }) => id));
  const counts = new Map<string, number>();
  for (const id of ids) {
    const short = withoutProvider(id);
    counts.set(short, (counts.get(short) ?? 0) + 1);
  }
  return selected.map(id => {
    const short = withoutProvider(id);
    // A nested ID without its prefix can also match another model's full ID.
    return counts.get(short) === 1 && !ids.has(short) ? short : id;
  }).join(', ');
}

export function ModelPicker({ models, selected, multiple, loading, disabled, onChange }: {
  models: readonly ChatModel[]; selected: readonly ChatModel[]; multiple: boolean;
  loading?: boolean; disabled?: boolean; onChange: (ids: string[]) => void;
}) {
  const { t } = useAppTranslation();
  const values = selected.map(({ id }) => id);
  const picker = {
    label: t('Model'), disabled: disabled || !models.length,
    placeholder: t(models.length ? multiple ? 'Select models' : 'Select a model' : loading ? 'Loading models…' : 'No model available'),
    search: { label: t('Search models'), placeholder: t('Search models…'), emptyMessage: t('No matching models.'), allowDeselect: true },
    options: modelOptions(models),
  };
  return multiple ? <Select {...picker} multiple value={values} onValueChange={onChange}
    className={values.length > 1 ? 'chat-model-summary' : undefined} selectionSummary={modelSummary(values, models)} />
    : <Select {...picker} value={values[0] ?? ''} onValueChange={id => onChange(id ? [id] : [])} />;
}
