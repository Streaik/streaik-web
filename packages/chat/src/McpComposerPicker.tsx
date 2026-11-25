import { Button } from '@streaik/themes';
import { useCallback, useId, useLayoutEffect, useRef, useState } from 'react';
import { ChatIcon } from './ChatIcon';
import { completeMcpArgument, expandMcpResource, getMcpPrompt, mcpFailure, mcpTemplateSlots, readMcpResource } from './mcp';
import type { McpCompletionReference, McpOutput, McpPrompt, McpServer } from './mcp';
import { forUser } from './mcpChatContext';
import type { ConnectedMcpServer } from './mcpChatContext';
import type { McpServerRecord } from './mcpConfiguration';
import { useAppTranslation } from './i18n';
import { useMcpElicitation } from './McpElicitation';
import { McpArgumentFields } from './McpArgumentFields';
import type { McpArgumentField, SuggestMcpArgument } from './McpArgumentFields';

type Mode = 'prompts' | 'resources';
type Item = { key: string; record: McpServerRecord; label: string; description?: string; fields: readonly McpArgumentField[] } & (
  { kind: 'prompt'; prompt: McpPrompt } | { kind: 'resource'; uri: string } | { kind: 'template'; uriTemplate: string }
);

type Props = {
  mode: Mode; servers: readonly ConnectedMcpServer[]; canSend: boolean;
  connect: (record: McpServerRecord) => McpServer | undefined;
  close: () => void;
  onPrompt: (text: string, signal: AbortSignal) => Promise<void>;
  onResource: (record: McpServerRecord, uri: string, label: string, output: McpOutput) => string | undefined;
};

export function hasMcpPickerResources(servers: readonly ConnectedMcpServer[]) {
  return servers.some(({ discovery }) => discovery.resources.some(forUser) ||
    discovery.resourceTemplates.some(item => forUser(item) && mcpTemplateSlots(item.uriTemplate) !== undefined));
}

function pickerItems(mode: Mode, servers: readonly ConnectedMcpServer[]): Item[] {
  return servers.flatMap<Item>(({ record, discovery }) => mode === 'prompts' ? discovery.prompts.map(prompt => ({
    kind: 'prompt', key: JSON.stringify([record.id, 'prompt', prompt.name]), record, prompt,
    label: prompt.title || prompt.name, description: prompt.description, fields: prompt.arguments ?? [],
  })) : [
    ...discovery.resources.filter(forUser).map(resource => ({
      kind: 'resource' as const, key: JSON.stringify([record.id, 'resource', resource.uri]), record, uri: resource.uri,
      label: resource.title || resource.name, description: resource.description, fields: [],
    })),
    ...discovery.resourceTemplates.filter(forUser).flatMap(template => {
      const slots = mcpTemplateSlots(template.uriTemplate);
      return slots ? [{ kind: 'template' as const, key: JSON.stringify([record.id, 'template', template.uriTemplate]), record,
        uriTemplate: template.uriTemplate, label: template.title || template.name, description: template.description,
        fields: slots.map(name => ({ name, required: true })) }] : [];
    }),
  ]);
}

export function McpComposerPicker(props: Props) {
  const { mode, servers, canSend, close } = props;
  const { t } = useAppTranslation();
  const elicit = useMcpElicitation();
  const id = useId();
  const title = t(mode === 'prompts' ? 'Prompts' : 'Resources');
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<Item>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const dialog = useRef<HTMLDialogElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const request = useRef<AbortController | null>(null);
  const latest = useRef(props);
  const supportsCompletions = servers.find(({ record }) => record === selected?.record)?.discovery.hasCompletions;
  useLayoutEffect(() => { latest.current = props; });
  useLayoutEffect(() => {
    dialog.current?.showModal();
    return () => { request.current?.abort(); };
  }, []);
  useLayoutEffect(() => {
    if (!selected || servers.some(({ record }) => record === selected.record)) return;
    request.current?.abort();
    request.current = null;
    setSelected(undefined);
    setBusy(false);
    setError('This MCP server is no longer connected.');
  }, [selected, servers]);

  const suggest = useCallback<SuggestMcpArgument>(async (argument, args, signal) => {
    if (!selected || selected.kind === 'resource' || !dialog.current?.open) return [];
    const current = latest.current;
    if (!current.servers.some(({ record, discovery }) => record === selected.record && discovery.hasCompletions)) return [];
    const server = current.connect(selected.record);
    if (!server) return [];
    const ref: McpCompletionReference = selected.kind === 'prompt' ? { type: 'ref/prompt', name: selected.prompt.name }
      : { type: 'ref/resource', uri: selected.uriTemplate };
    return completeMcpArgument(server, { ref, argument, ...(Object.keys(args).length ? { context: { arguments: args } } : {}) }, signal);
  }, [selected]);

  async function apply(item: Item, values: Record<string, string>) {
    if (request.current || item.kind === 'prompt' && !latest.current.canSend) return;
    const server = latest.current.connect(item.record);
    if (!server || !latest.current.servers.some(({ record }) => record === item.record)) return;
    const controller = new AbortController();
    request.current = controller;
    setBusy(true);
    setError('');
    try {
      if (item.kind === 'prompt') {
        const text = await getMcpPrompt(server, item.prompt.name, values, controller.signal, elicit);
        controller.signal.throwIfAborted();
        if (!text.trim()) { setError('This prompt has no supported text.'); return; }
        await latest.current.onPrompt(text, controller.signal);
      } else {
        const uri = item.kind === 'resource' ? item.uri : expandMcpResource(item.uriTemplate, values);
        const output = await readMcpResource(server, uri, controller.signal, elicit);
        controller.signal.throwIfAborted();
        const failure = latest.current.onResource(item.record, uri, item.label, output);
        if (failure) { setError(failure); return; }
      }
      dialog.current?.close();
    } catch (error) {
      if (!controller.signal.aborted) setError(mcpFailure(error));
    } finally {
      if (request.current === controller) { request.current = null; setBusy(false); }
    }
  }

  const items = pickerItems(mode, servers);
  const keyword = query.trim().toLocaleLowerCase();
  const matches = items.filter(item => [item.label, item.record.title, item.description].some(value => value?.toLocaleLowerCase().includes(keyword)));
  return <dialog ref={dialog} className="chat-settings chat-tools-dialog mcp-composer-picker" aria-labelledby={`${id}-title`} onClose={close}
    onCancel={() => request.current?.abort()}>
    <header className="chat-settings-header"><h2 id={`${id}-title`}>{title}</h2>
      <Button type="button" className="chat-close" variant="subtle" aria-label={t('Close')} onClick={() => {
        request.current?.abort(); dialog.current?.close();
      }}><ChatIcon name="close" /></Button>
    </header>
    {selected ? <form key={selected.key} className="mcp-composer-arguments" onSubmit={event => {
      event.preventDefault();
      const data = new FormData(event.currentTarget);
      const values = Object.fromEntries(selected.fields.flatMap(({ name }) => {
        const value = data.get(name);
        return typeof value === 'string' && value.length ? [[name, value]] : [];
      }));
      void apply(selected, values);
    }}>
      <div><h3>{selected.label}</h3><small>{selected.record.title}</small></div>
      {selected.description && <p>{selected.description}</p>}
      <McpArgumentFields fields={selected.fields} busy={busy} suggest={supportsCompletions ? suggest : undefined} />
      {busy && <p role="status">{t('Loading from MCP…')}</p>}
      {error && <p className="chat-error" role="alert">{t(error)}</p>}
      <footer className="chat-tool-footer">
        <Button type="button" variant="subtle" disabled={busy} onClick={() => {
          setSelected(undefined); setError(''); requestAnimationFrame(() => search.current?.focus());
        }}>{t('Back')}</Button>
        <Button type="submit" variant="primary" disabled={busy || mode === 'prompts' && !canSend}>{t(mode === 'prompts' ? 'Run prompt' : 'Add resource')}</Button>
      </footer>
    </form> : <div className="mcp-composer-results">
      <input ref={search} type="search" autoFocus value={query} aria-label={t(mode === 'prompts' ? 'Search prompts' : 'Search resources')}
        placeholder={t(mode === 'prompts' ? 'Search prompts' : 'Search resources')} onChange={event => setQuery(event.currentTarget.value)} />
      {mode === 'prompts' && servers.some(({ discovery }) => discovery.promptsFailed) && <p role="status">{t('Some MCP prompts could not be loaded.')}</p>}
      {error && <p className="chat-error" role="alert">{t(error)}</p>}
      {matches.length ? <ul>{matches.map(item => <li key={item.key}>
        <button type="button" disabled={mode === 'prompts' && !canSend} onClick={() => {
          setSelected(item); setError(''); if (!item.fields.length) void apply(item, {});
        }}><strong>{item.label}</strong><small>{item.record.title}</small>
          {item.description && <span>{item.description.slice(0, 500)}</span>}</button>
      </li>)}</ul> : <p>{t(mode === 'prompts' ? 'No prompts found.' : 'No resources found.')}</p>}
    </div>}
  </dialog>;
}
