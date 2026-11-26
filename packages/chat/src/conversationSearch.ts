import { create, remove, search, upsert } from '@orama/orama';
import { convertedAttachmentName } from './chatAttachments.ts';
import { conversationTitle } from './conversations.ts';
import type { Conversation } from './conversations.ts';
import { createSearchTokenizer, normalizeWord, tokenize, wordPattern } from './searchTokenizer.ts';

type SearchHit = { id: string; excerpt?: string };
export type SearchHistory = (term: string) => Promise<SearchHit[]>;
type TextMatch = { conversationId: string; conversationName: string; messageId: string; messageIndex: number;
  role: 'user' | 'assistant'; partIndex: number; matchIndex: number; snippet: string };
export type SearchConversationText = (query: string, limit: number) => Promise<{ query: string; total: number; limit: number; results: TextMatch[] }>;

function* searchableParts({ messages }: Conversation) {
  for (const [messageIndex, message] of messages.entries()) {
    if (message.role !== 'user' && message.role !== 'assistant') continue;
    for (const [partIndex, part] of message.parts.entries()) {
      if (part.type === 'text' && convertedAttachmentName(part) === undefined) yield { messageIndex, partIndex, text: part.text };
    }
  }
}

function firstMatch(text: string, terms: string[]) {
  for (const match of text.matchAll(wordPattern)) {
    const word = normalizeWord(match[0]);
    if (terms.some(term => word.startsWith(term))) return match.index;
  }
}

function excerpt(text: string, matchIndex: number, before: number, length: number) {
  const start = Math.max(0, matchIndex - before);
  const end = start + length;
  return `${start ? '…' : ''}${text.slice(start, end).replace(/\s+/g, ' ').trim()}${end < text.length ? '…' : ''}`;
}

function createHistoryIndex<Database>(database: () => Database,
  update: (db: Database, record: Conversation | undefined, previous: Conversation | undefined, yieldIfNeeded: () => Promise<void>) => Promise<void>) {
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
      let deadline = performance.now() + 12;
      async function yieldIfNeeded() {
        if (performance.now() >= deadline) {
          // Let the UI paint during an initial backfill of a large history.
          await new Promise(resolve => setTimeout(resolve, 0));
          deadline = performance.now() + 12;
        }
      }
      for (const [id, previous] of indexed) {
        if (!current.has(id)) await update(db, undefined, previous, yieldIfNeeded);
      }
      for (const record of current.values()) {
        const previous = indexed.get(record.id);
        if (previous?.messages === record.messages && previous.metadata?.name === record.metadata?.name) continue;
        await update(db, record, previous, yieldIfNeeded);
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
    read: <T>(records: readonly Conversation[], query: (db: Database, indexed: ReadonlyMap<string, Conversation>) => Promise<T>) => enqueue(async () => {
      await reconcile(records);
      return query(db, indexed);
    }),
  };
}

function textDocuments(record: Conversation | undefined) {
  const parts = new Map<string, string>();
  if (record) for (const { messageIndex, partIndex, text } of searchableParts(record)) {
    if (text.trim()) parts.set(JSON.stringify([record.id, messageIndex, partIndex]), text);
  }
  return parts;
}

function createTextPartIndex() {
  return createHistoryIndex(() => create({ schema: { text: 'string' }, sort: { enabled: false },
    components: { tokenizer: createSearchTokenizer() } }), async (db, record, previous, yieldIfNeeded) => {
    if (previous?.messages === record?.messages) return;
    const next = textDocuments(record);
    const before = textDocuments(previous);
    for (const id of before.keys()) {
      if (!next.has(id)) {
        await remove(db, id);
        await yieldIfNeeded();
      }
    }
    for (const [id, text] of next) {
      if (before.get(id) !== text) {
        await upsert(db, { id, text });
        await yieldIfNeeded();
      }
    }
  });
}

export function createConversationSearch() {
  const conversations = createHistoryIndex(() => create({ schema: { title: 'string', text: 'string' }, sort: { enabled: false },
    components: { tokenizer: createSearchTokenizer() } }), async (db, record, previous, yieldIfNeeded) => {
    if (record) {
      const name = record.metadata?.name;
      const title = (typeof name === 'string' && name.trim()) || conversationTitle(record, '');
      const text = Array.from(searchableParts(record), part => part.text).join('\n');
      await upsert(db, { id: record.id, title, text });
    } else if (previous) await remove(db, previous.id);
    await yieldIfNeeded();
  });
  // Build this index only when the browser tool needs part-level results, not for the history UI.
  let parts: ReturnType<typeof createTextPartIndex> | undefined;

  return {
    sync: conversations.sync,
    async search(records: readonly Conversation[], term: string): Promise<SearchHit[]> {
      const terms = tokenize(term);
      if (!terms.length) return [];
      return conversations.read(records, async db => {
        const { hits } = await search(db, { mode: 'fulltext', term, properties: ['title', 'text'],
          boost: { title: 2 }, threshold: 0, limit: 30 });
        return hits.map(({ id, document }) => {
          const match = firstMatch(document.text, terms);
          return { id, excerpt: match === undefined ? undefined : excerpt(document.text, match, 40, 160) };
        });
      });
    },
    async searchText(records: readonly Conversation[], query: string, limit: number): ReturnType<SearchConversationText> {
      const terms = tokenize(query);
      if (!terms.length || !records.length) return { query, total: 0, limit, results: [] };
      return (parts ??= createTextPartIndex()).read(records, async (db, indexed) => {
        const { count, hits } = await search(db, { mode: 'fulltext', term: query, properties: ['text'], threshold: 0, limit });
        const results: TextMatch[] = hits.flatMap(({ id, document: { text } }) => {
          const [conversationId, messageIndex, partIndex] = JSON.parse(id) as [string, number, number];
          const record = indexed.get(conversationId);
          const message = record?.messages[messageIndex];
          if (!record || (message?.role !== 'user' && message?.role !== 'assistant')) return [];
          const matchIndex = firstMatch(text, terms) ?? 0;
          return [{ conversationId, conversationName: conversationTitle(record), messageId: message.id, messageIndex,
            role: message.role, partIndex, matchIndex, snippet: excerpt(text, matchIndex, 90, 260) }];
        });
        return { query, total: count, limit, results };
      });
    },
  };
}
