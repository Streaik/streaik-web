import { create, insertMultiple, search } from '@orama/orama';
import { createSearchTokenizer, tokenize } from './searchTokenizer.ts';

export type CatalogSearchDocument = { title: string; text: string };

export async function createCatalogSearch(documents: readonly CatalogSearchDocument[]) {
  const db = create({ schema: { title: 'string', text: 'string' }, sort: { enabled: false },
    components: { tokenizer: createSearchTokenizer() } });
  // Use positions within this catalog snapshot, not IDs shared across sources or profiles.
  await insertMultiple(db, documents.map(({ title, text }, index) => ({ id: String(index), title, text })));

  return async (term: string) => {
    const terms = tokenize(term);
    if (!terms.length) return [];
    const { hits } = await search(db, { mode: 'fulltext', term, properties: ['title', 'text'],
      boost: { title: 3 }, threshold: 1, limit: documents.length });
    // Orama's all-terms threshold requires one field to match. A catalog query can span fields.
    const matches = terms.length === 1 ? hits : hits.filter(({ document: { title, text } }) => {
      const words = tokenize(`${title}\n${text}`);
      return terms.every(term => words.some(word => word.startsWith(term)));
    });
    return matches.map(({ id }) => Number(id));
  };
}
