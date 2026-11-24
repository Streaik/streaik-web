import { Button } from '@streaik/themes';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ChatIcon } from './ChatIcon';
import { conversationTitle, newestFirst } from './conversations';
import type { Conversation } from './conversations';
import type { SearchHistory } from './conversationSearch';
import { useAppTranslation } from './i18n';

type Response = { term: string; history: readonly Conversation[]; hits?: Awaited<ReturnType<SearchHistory>> };

export function ChatHistorySearch({ id, history, active, busy, search, onOpen, onClose }: {
  id: string; history: readonly Conversation[]; active: string; busy: boolean; search: SearchHistory;
  onOpen: (conversation: Conversation) => void; onClose: () => void;
}) {
  const { t } = useAppTranslation();
  const dialog = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState('');
  const [response, setResponse] = useState<Response>();
  const term = query.trim();

  useLayoutEffect(() => {
    if (!dialog.current?.open) dialog.current?.showModal();
    input.current?.focus();
  }, []);

  useEffect(() => {
    if (!term || !history.length) return;
    let current = true;
    const timer = window.setTimeout(() => {
      void search(term).then(hits => {
        if (current) setResponse({ term, history, hits });
      }).catch(() => {
        if (current) setResponse({ term, history });
      });
    }, 120);
    return () => { current = false; window.clearTimeout(timer); };
  }, [history, search, term]);

  // Never render hits from a stale search or let them navigate to a deleted conversation.
  const result = response?.term === term && response.history === history ? response : undefined;
  const records = new Map(history.map(item => [item.id, item]));
  const entries: { item: Conversation; excerpt?: string }[] = term
    ? (result?.hits ?? []).flatMap(hit => {
      const item = records.get(hit.id);
      return item ? [{ item, excerpt: hit.excerpt }] : [];
    })
    : [...history].sort(newestFirst).slice(0, 6).map(item => ({ item }));
  const status = !term ? (entries.length ? '' : t('No conversations yet.'))
    : !result && history.length ? t('Searching chat history…')
    : result && !result.hits ? t('Could not search chat history.')
    : !entries.length ? t('No matches found.') : '';

  function open(item: Conversation) {
    if (busy) return;
    dialog.current?.close();
    onOpen(item);
  }

  return <dialog ref={dialog} id={id} className="chat-settings chat-history-search" aria-labelledby={`${id}-title`} onClose={onClose}>
    <header className="chat-settings-header">
      <h2 id={`${id}-title`}>{t('Search chat history')}</h2>
      <Button type="button" variant="subtle" className="chat-close" aria-label={t('Close')} onClick={() => dialog.current?.close()}>
        <ChatIcon name="close" />
      </Button>
    </header>
    <form onSubmit={event => {
      event.preventDefault();
      if (entries[0]) open(entries[0].item);
    }}>
      <input ref={input} className="ui-input" type="search" aria-label={t('Search chat history')} placeholder={t('Search conversations…')}
        onKeyDown={event => {
          // Native search inputs can otherwise consume Escape to clear the query.
          if (event.key === 'Escape' && !event.nativeEvent.isComposing) {
            event.preventDefault();
            dialog.current?.close();
          }
        }}
        value={query} onChange={event => {
          const next = event.currentTarget.value;
          if (next.trim() !== term) setResponse(undefined);
          setQuery(next);
        }} />
    </form>
    <div className="chat-history-search-results">
      {status && <p role="status">{status}</p>}
      {entries.length > 0 && <section className="chat-history-group">
        <h3 id={`${id}-results`}>{t(term ? 'Search results' : 'Recent')}</h3>
        <ul aria-labelledby={`${id}-results`}>
          {entries.map(({ item, excerpt }, index) => {
            const title = conversationTitle(item, t('Conversation'));
            const excerptId = `${id}-excerpt-${index}`;
            return <li key={item.id}>
              <Button type="button" variant="subtle" disabled={busy} aria-current={item.id === active ? 'true' : undefined}
                aria-label={title} aria-describedby={excerpt ? excerptId : undefined} onClick={() => open(item)}>
                <span className="chat-history-search-title" title={title}>{title}</span>
                {excerpt && <span id={excerptId} className="chat-history-search-excerpt">{excerpt}</span>}
              </Button>
            </li>;
          })}
        </ul>
      </section>}
    </div>
  </dialog>;
}
