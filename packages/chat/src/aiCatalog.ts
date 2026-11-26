import type { CatalogModel } from '@streaik/gateway';
import type { CatalogProjection } from './catalogLookup.ts';
import directory from './provider-directory.json' with { type: 'json' };

export type CatalogProvider = {
  id: string; name: string; description?: string; category?: string; country?: string; regions?: readonly string[];
  urls?: Partial<Record<string, string>>;
};

export const directoryProviders: readonly CatalogProvider[] = [...directory.providers].sort((a, b) => a.name.localeCompare(b.name));
const providerMetadata = new Map(directoryProviders.map(provider => [provider.id, provider]));
export const providerName = (id: string) => providerMetadata.get(id)?.name ?? id;
export const providerCategories = new Map([
  ['model_provider', 'Model builder'], ['gateway_router', 'Gateway'], ['inference_compute', 'Inference & compute'],
  ['media_voice', 'Media & voice'], ['search_data', 'Search & data'], ['app_tools', 'Apps & tools'],
]);

const countries = new Intl.DisplayNames('en', { type: 'region' });
export const providerSearchDocument: CatalogProjection<CatalogProvider> = provider => ({
  title: provider.name,
  text: [provider.id, provider.description, provider.category, providerCategories.get(provider.category ?? ''),
    provider.country, provider.country && /^[A-Z]{2}$/.test(provider.country) ? countries.of(provider.country) : '',
    ...(provider.regions ?? [])].filter(Boolean).join('\n'),
});

export const modelSearchDocument: CatalogProjection<CatalogModel> = model => ({
  title: model.name,
  text: [model.id, model.description, model.provider, providerName(model.provider), model.type ?? 'other', ...model.tags]
    .filter(Boolean).join('\n'),
});

const availableProviders = new WeakMap<readonly CatalogModel[], readonly CatalogProvider[]>();
export function providersForCatalog(catalog: readonly CatalogModel[]) {
  let providers = availableProviders.get(catalog);
  if (!providers) {
    providers = [...new Set(catalog.map(model => model.provider))].map(id => providerMetadata.get(id) ?? { id, name: id });
    availableProviders.set(catalog, providers);
  }
  return providers;
}
