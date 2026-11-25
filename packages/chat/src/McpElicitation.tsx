import { Button } from '@streaik/themes';
import { createContext, useCallback, useContext, useId, useLayoutEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { ElicitRequestFormParams, ElicitResult } from '@modelcontextprotocol/client';
import { ChatIcon } from './ChatIcon';
import { ElicitationForm } from './ElicitationForm';
import type { RequestElicitation } from './elicitation';
import { useAppTranslation } from './i18n';

type Prompt = { id: number; request: ElicitRequestFormParams; answer: (result: ElicitResult) => void };
const ElicitationContext = createContext<RequestElicitation | undefined>(undefined);

export function useMcpElicitation() { return useContext(ElicitationContext); }

export function McpElicitationProvider({ enabled, children }: { enabled: boolean; children: ReactNode }) {
  const [queue, setQueue] = useState<Prompt[]>([]);
  const nextId = useRef(0);
  const pending = useRef(new Map<number, () => void>());
  useLayoutEffect(() => () => { pending.current.forEach(dispose => dispose()); }, []);

  const ask = useCallback<RequestElicitation>((request, _source, signal) => new Promise((resolve, reject) => {
    signal.throwIfAborted();
    // The SDK may dispatch multiple forms in the same round. Show one at a time.
    if (pending.current.size >= 10) throw new Error('Too many MCP input requests.');
    const id = nextId.current++;
    function finish(result?: ElicitResult, unmounting = false) {
      if (!pending.current.delete(id)) return;
      signal.removeEventListener('abort', abort);
      if (!unmounting) setQueue(prompts => prompts.filter(prompt => prompt.id !== id));
      if (result && !signal.aborted) resolve(result);
      else reject(signal.reason ?? new DOMException('MCP input cancelled.', 'AbortError'));
    }
    const abort = () => finish();
    signal.addEventListener('abort', abort, { once: true });
    pending.current.set(id, () => finish(undefined, true));
    setQueue(prompts => [...prompts, { id, request, answer: finish }]);
  }), []);

  return <ElicitationContext.Provider value={enabled ? ask : undefined}>
    {children}
    {queue[0] && <ElicitationDialog key={queue[0].id} prompt={queue[0]} />}
  </ElicitationContext.Provider>;
}

function ElicitationDialog({ prompt }: { prompt: Prompt }) {
  const { t } = useAppTranslation();
  const dialog = useRef<HTMLDialogElement>(null);
  const id = useId();
  useLayoutEffect(() => {
    const node = dialog.current;
    node?.showModal();
    return () => node?.close();
  }, []);
  const cancel = () => prompt.answer({ action: 'cancel' });
  return <dialog ref={dialog} className="chat-settings chat-tools-dialog elicitation-dialog" aria-labelledby={id}
    onCancel={event => { event.preventDefault(); cancel(); }}>
    <header className="chat-settings-header">
      <h2 id={id}>{t('Elicitation')}</h2>
      <Button type="button" className="chat-close" variant="subtle" aria-label={t('Close')} onClick={cancel}><ChatIcon name="close" /></Button>
    </header>
    <ElicitationForm request={prompt.request} onAnswer={prompt.answer} />
  </dialog>;
}
