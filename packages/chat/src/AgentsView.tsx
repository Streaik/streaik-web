import * as Menu from '@radix-ui/react-dropdown-menu';
import { Button, Tooltip, useColorScheme } from '@streaik/themes';
import type { CatalogModel } from '@streaik/gateway';
import { useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AgentEditor, ConfirmAgentChange } from './AgentEditor';
import type { AgentEntry } from './agentCatalog';
import { primaryAgentModel } from './agentDefinition';
import type { AgentDefinition } from './agentDefinition';
import { agentIconSources } from './agentDraft';
import { useAgents } from './AgentsProvider';
import { CatalogMark } from './CatalogMark';
import { ChatIcon } from './ChatIcon';
import { useAppTranslation } from './i18n';
import { useCatalogSearch } from './useCatalogSearch';

type Action = { kind: 'create'; seed?: AgentDefinition } | { kind: 'edit' | 'remove'; entry: AgentEntry };

const noAgents: readonly AgentEntry[] = [];

function agentSearchDocument({ definition }: AgentEntry) {
  return { title: definition.name, text: [definition.description, definition.model?.id,
    ...(definition.models?.map(({ id }) => id) ?? []), ...(definition.tags ?? [])].join('\n') };
}

function AgentCardActions({ entry, container, onAction }: {
  entry: AgentEntry; container: HTMLDivElement | null; onAction: (action: Action, opener: HTMLElement) => void;
}) {
  const { t } = useAppTranslation();
  const trigger = useRef<HTMLButtonElement>(null);
  const pending = useRef<Action | undefined>(undefined);
  const { definition, source } = entry;
  return <div className="agent-card-actions">
    <Tooltip content={t('Edit')}><button type="button" className="chat-row-button" aria-label={t('Edit')}
      onClick={(event) => onAction({ kind: 'edit', entry }, event.currentTarget)}><ChatIcon name="edit" /></button></Tooltip>
    <Menu.Root modal={false}>
      <Tooltip content={t('More actions')}><Menu.Trigger ref={trigger} type="button" className="chat-row-button"
        aria-label={t('More actions for {{title}}', { title: definition.name })}><ChatIcon name="moreVertical" /></Menu.Trigger></Tooltip>
      {container && <Menu.Portal container={container}>
        <Menu.Content className="chat-menu" align="end" sideOffset={4} collisionPadding={8} hideWhenDetached
          onCloseAutoFocus={(event) => {
            const action = pending.current;
            const button = trigger.current;
            if (!action || !button) return;
            pending.current = undefined;
            event.preventDefault();
            // Let the menu finish closing before the native dialog takes focus.
            button.focus();
            onAction(action, button);
          }}>
          {source === 'sample' && <Menu.Item className="chat-menu-item" onSelect={() => {
            pending.current = { kind: 'create', seed: { ...definition, name: t('{{name}} copy', { name: definition.name }) } };
          }}><ChatIcon name="copy" /> {t('Duplicate')}</Menu.Item>}
          {(source === 'local' || entry.overridden) && <Menu.Item className="chat-menu-item" data-danger={source === 'local' || undefined}
            onSelect={() => { pending.current = { kind: 'remove', entry }; }}>
            <ChatIcon name={source === 'local' ? 'trash' : 'back'} /> {t(source === 'local' ? 'Delete' : 'Reset to sample default')}
          </Menu.Item>}
        </Menu.Content>
      </Menu.Portal>}
    </Menu.Root>
  </div>;
}

import type { McpServers } from './useMcpServers';

export function AgentsView({ catalog, catalogStatus, toolbar, menuContainer, mcpServers }: {
  catalog: readonly CatalogModel[]; catalogStatus?: string; toolbar: HTMLDivElement | null; menuContainer: HTMLDivElement | null;
  mcpServers: McpServers;
}) {
  const { t } = useAppTranslation();
  const store = useAgents();
  const scheme = useColorScheme();
  const [query, setQuery] = useState('');
  const [action, setAction] = useState<Action>();
  const search = useRef<HTMLInputElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const { results: visible, message: searchMessage } = useCatalogSearch(store?.entries ?? noAgents, query, agentSearchDocument);
  useLayoutEffect(() => {
    if (action || !opener.current) return;
    const target = opener.current;
    opener.current = null;
    if (target.isConnected) target.focus();
    if (document.activeElement !== target) search.current?.focus();
  }, [action]);
  if (!store) return null;

  const tagOptions = [...new Set(store.entries.flatMap(({ definition }) => definition.tags ?? []).map((tag) => tag.trim()).filter(Boolean))].sort();

  function start(next: Action, button: HTMLElement) { opener.current = button; setAction(next); }
  function end() { setAction(undefined); }

  return <section className="catalog-content" aria-labelledby="agents-title">
    {toolbar && createPortal(<Button className="agent-create" variant="primary" aria-label={t('Create agent')} title={t('Create agent')}
      onClick={(event) => start({ kind: 'create' }, event.currentTarget)}><ChatIcon name="add" /></Button>, toolbar)}
    <header className="catalog-overview-header">
      <h1 id="agents-title">{t('Agents')}</h1>
    </header>
    {store.notice && <p className="chat-notice" role="status">{t(store.notice)}</p>}
    <input ref={search} className="ui-input agent-input" aria-label={t('Search agents')} type="search" placeholder={t('Search agents…')}
      value={query} onChange={(event) => setQuery(event.currentTarget.value)} />
    {visible.length === 0 ? <p role="status">{t(searchMessage ?? (query.trim() ? 'No matching agents.' : 'No agents yet.'))}</p> :
      <div className="catalog-grid agent-grid">{visible.map((entry) => {
        const { definition, source } = entry;
        const model = primaryAgentModel(definition, ({ id, type }) => (type ?? catalog.find((item) => item.id === id && item.type === 'language')?.type
          ?? catalog.find((item) => item.id === id)?.type) === 'decision');
        const provider = model?.id.includes('/') ? model.id.split('/')[0] : '';
        return <article className="catalog-card agent-card" aria-label={definition.name} key={entry.key}>
          <header className="agent-card-header">
            <div className="catalog-card-title">
              <CatalogMark provider={provider} name={definition.name} icons={agentIconSources(definition.icons, scheme)} />
              <div><h2>{definition.name}</h2>
                <p>{t(source === 'sample' ? entry.overridden ? 'Sample agent · Local override' : 'Sample agent' : 'Local agent')}</p>
              </div>
            </div>
            <AgentCardActions entry={entry} container={menuContainer} onAction={start} />
          </header>
          <p>{definition.description}</p>
          {model && <p className="agent-hint">{model.id}</p>}
          {!!definition.tags?.length && <div className="catalog-badges">{definition.tags.map((tag, index) => <span key={`${tag}:${index}`}>{tag}</span>)}</div>}
        </article>;
      })}</div>}
    {action?.kind === 'remove' ? <ConfirmAgentChange entry={action.entry} onConfirm={() => store.removeChange(action.entry)} onClose={end} />
      : action && <AgentEditor entry={action.kind === 'edit' ? action.entry : undefined} seed={action.kind === 'create' ? action.seed : undefined}
        catalog={catalog} catalogStatus={catalogStatus} tags={tagOptions} mcpServers={mcpServers} onSave={store.save} onClose={end} />}
  </section>;
}
