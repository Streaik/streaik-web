import type { CatalogSearchDocument, createCatalogSearch } from './catalogSearch.ts';

export type CatalogProjection<T> = (item: T) => CatalogSearchDocument;
type SearchIndex = ReturnType<typeof createCatalogSearch>;
const indexes = new WeakMap<readonly unknown[], WeakMap<object, SearchIndex>>();

// Share a lazily built index only when the source snapshot and projection are both identical.
export async function searchCatalog<T>(items: readonly T[], project: CatalogProjection<T>, term: string, signal?: AbortSignal) {
  if (!items.length) return [];
  const projections = indexes.get(items) ?? new WeakMap<object, SearchIndex>();
  indexes.set(items, projections);
  const index = projections.get(project) ?? import('./catalogSearch.ts')
    .then(({ createCatalogSearch }) => createCatalogSearch(items.map(project)));
  projections.set(project, index);
  try {
    const search = await index;
    if (signal?.aborted) return [];
    const positions = await search(term);
    return positions.map(position => items[position]);
  } catch (error) {
    if (projections.get(project) === index) projections.delete(project);
    throw error;
  }
}
