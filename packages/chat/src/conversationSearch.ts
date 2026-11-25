import { create, remove, search, upsert } from '@orama/orama';
import { convertedAttachmentName } from './chatAttachments.ts';
import { conversationTitle } from './conversations.ts';
import type { Conversation } from './conversations.ts';
import { createSearchTokenizer, normalizeWord, tokenize, wordPattern } from './searchTokenizer.ts';

type SearchHit = { id: string; excerpt?: string };
export type SearchHistory = (term: string) => Promise<SearchHit[]>;

function searchableText({ messages }: Conversation) {
  const parts: string[] = [];
  for (const message of messages) {
    if (message.role !== 'user' && message.role !== 'assistant') continue;
    for (const part of message.parts) {
      if (part.type === 'text' && convertedAttachmentName(part) === undefined) parts.push(part.text);
    }
  }
  return parts.join('\n');
}

function excerpt(text: string, terms: string[]) {
  for (const match of text.matchAll(wordPattern)) {
    const word = normalizeWord(match[0]);
    if (!terms.some(term => word.startsWith(term))) continue;
    const start = Math.max(0, match.index - 40);
    const end = start + 160;
    return `${start ? '…' : ''}${text.slice(start, end).replace(/\s+/g, ' ').trim()}${end < text.length ? '…' : ''}`;
  }
}

function database() {
  return create({ schema: { title: 'string', text: 'string' }, sort: { enabled: false },
    components: { tokenizer: createSearchTokenizer() } });
}

export function createConversationSearch() {
  let db = database();
  let indexed = new Map<string, Conversation>();
  let snapshot: readonly Conversation[] | undefined;
  let queue = Promise.resolve();

  function enqueue<T>(task: () => Promise<T>): Promise<T> {
    const next = queue.then(task);
    queue = next.then(() => {}, () => {});
    return next;
  }

  async function reconcile(records: readonly Conversation[]) {
    if (snapshot === records) return;
    const current = new Map(records.map(record => [record.id, record]));
    try {
      for (const id of indexed.keys()) {
        if (!current.has(id)) await remove(db, id);
      }
      let deadline = performance.now() + 12;
      for (const record of current.values()) {
        const previous = indexed.get(record.id);
        if (previous?.messages === record.messages && previous.metadata?.name === record.metadata?.name) continue;
        const name = record.metadata?.name;
        const title = (typeof name === 'string' && name.trim()) || conversationTitle(record, '');
        await upsert(db, { id: record.id, title, text: searchableText(record) });
        if (performance.now() >= deadline) {
          // Let the UI paint during an initial backfill of a large history.
          await new Promise(resolve => setTimeout(resolve, 0));
          deadline = performance.now() + 12;
        }
      }
      indexed = current;
      snapshot = records;
    } catch (error) {
      // Never reuse a partially updated index. The next query can rebuild it from history.
      db = database();
      indexed.clear();
      snapshot = undefined;
      throw error;
    }
  }

  return {
    sync: (records: readonly Conversation[]) => enqueue(() => reconcile(records)),
    search: (records: readonly Conversation[], term: string): Promise<SearchHit[]> => enqueue(async () => {
      const terms = tokenize(term);
      if (!terms.length) return [];
      await reconcile(records);
      const { hits } = await search(db, { mode: 'fulltext', term, properties: ['title', 'text'],
        boost: { title: 2 }, threshold: 0, limit: 30 });
      return hits.map(({ id, document }) => ({ id, excerpt: excerpt(document.text, terms) }));
    }),
  };
}
