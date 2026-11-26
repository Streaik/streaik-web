import { useEffect, useState } from 'react';
import { searchCatalog } from './catalogLookup';
import type { CatalogProjection } from './catalogLookup';

type Snapshot<T> = { items: readonly T[]; project: CatalogProjection<T> };

export function useCatalogSearch<T>(items: readonly T[], query: string, project: CatalogProjection<T>): {
  results: readonly T[];
  message?: 'Searching…' | 'Could not search.';
} {
  const term = query.trim();
  const [settled, setSettled] = useState<(Snapshot<T> & { term: string; results?: T[] })>();

  useEffect(() => {
    if (!term || !items.length) return;
    const controller = new AbortController();
    const { signal } = controller;
    void searchCatalog(items, project, term, signal).then(results => {
      if (!signal.aborted) setSettled({ items, project, term, results });
    }, () => {
      if (!signal.aborted) setSettled({ items, project, term });
    });
    return () => controller.abort();
  }, [items, project, term]);

  if (!term || !items.length) return { results: items };
  // Ignore results from an older query or catalog (e.g. a different profile or newly loaded page).
  if (settled?.items !== items || settled.project !== project || settled.term !== term) return { results: [], message: 'Searching…' };
  return settled.results ? { results: settled.results } : { results: [], message: 'Could not search.' };
}
