import type { ChatModel } from '@streaik/gateway';
import { Select } from '@streaik/themes';
import { providerName } from './CatalogViews';
import { useAppTranslation } from './i18n';

export function resolveModelSelection<T extends ChatModel>(models: readonly T[], ids: string[] | undefined, multiple: boolean) {
  const byId = new Map(models.map(model => [model.id, model]));
  const checked = ids?.flatMap(id => {
    const model = byId.get(id);
    return model ? [model] : [];
  }) ?? [];
  // Default to the first model unless the user explicitly cleared the selection.
  const selected = checked.length || ids?.length === 0 ? checked : models.slice(0, 1);
  return { byId, selected: multiple ? selected : selected.slice(0, 1) };
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
    options: models.map(({ id, name, provider }) => ({ value: id, label: name, group: { id: provider, label: providerName(provider) } })),
  };
  return multiple ? <Select {...picker} multiple value={values} onValueChange={onChange}
    className={values.length > 1 ? 'chat-model-summary' : undefined} selectionSummary={modelSummary(values, models)} />
    : <Select {...picker} value={values[0] ?? ''} onValueChange={id => onChange(id ? [id] : [])} />;
}
