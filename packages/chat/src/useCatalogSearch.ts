import { useEffect, useRef, useState } from 'react';
import type { CatalogSearchDocument, createCatalogSearch } from './catalogSearch';

type Projection<T> = (item: T) => CatalogSearchDocument;
type SearchIndex = ReturnType<typeof createCatalogSearch>;
type Snapshot<T> = { items: readonly T[]; project: Projection<T> };

export function useCatalogSearch<T>(items: readonly T[], query: string, project: Projection<T>): {
  results: readonly T[];
  message?: 'Searching…' | 'Could not search.';
} {
  const term = query.trim();
  const cached = useRef<(Snapshot<T> & { index: SearchIndex }) | undefined>(undefined);
  const [settled, setSettled] = useState<(Snapshot<T> & { term: string; results?: T[] })>();

  useEffect(() => {
    if (!term || !items.length) return;
    let snapshot = cached.current;
    if (snapshot?.items !== items || snapshot.project !== project) {
      const index = import('./catalogSearch').then(({ createCatalogSearch }) => createCatalogSearch(items.map(project)));
      cached.current = snapshot = { items, project, index };
    }
    const indexed = snapshot;
    let cancelled = false;
    void indexed.index.then(search => cancelled ? undefined : search(term)).then(positions => {
      if (!cancelled && positions) setSettled({ items, project, term, results: positions.map(position => items[position]) });
    }, () => {
      if (cached.current === indexed) cached.current = undefined;
      if (!cancelled) setSettled({ items, project, term });
    });
    return () => { cancelled = true; };
  }, [items, project, term]);

  if (!term || !items.length) return { results: items };
  // Ignore results from an older query or catalog (e.g. a different profile or newly loaded page).
  if (settled?.items !== items || settled.project !== project || settled.term !== term) return { results: [], message: 'Searching…' };
  return settled.results ? { results: settled.results } : { results: [], message: 'Could not search.' };
}
