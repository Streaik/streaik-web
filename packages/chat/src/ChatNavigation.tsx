import * as Menu from '@radix-ui/react-dropdown-menu';
import { Button, Tooltip } from '@streaik/themes';
import { useId, useLayoutEffect, useRef } from 'react';
import { useAgents } from './AgentsProvider';
import { ChatIcon } from './ChatIcon';
import { useAppTranslation } from './i18n';
import type { RouteMenu } from './routeMenu';
import { conversationTitle, newestFirst } from './conversations';
import type { Conversation } from './conversations';

export type ChatAccount = {
  name: string;
  busy?: boolean;
  onLogout?: () => void;
};

export type ChatView = 'chat' | 'images' | 'transcriptions' | 'models' | 'providers' | 'agents' | 'skills';

function initials(name: string) {
  const words = name.split('@')[0]?.match(/[\p{L}\p{N}]+/gu) ?? [];
  const first = Array.from(words[0] ?? '');
  const letters = words.length > 1 ? [first[0], Array.from(words.at(-1) ?? '')[0]] : first.slice(0, 2);
  return letters.join('').toLocaleUpperCase();
}

function RouteSubmenu({ routes, container }: { routes: RouteMenu; container: HTMLDivElement }) {
  const { t } = useAppTranslation();
  return <Menu.Sub>
    <Menu.SubTrigger className="chat-menu-item" disabled={routes.disabled}>
      <ChatIcon name="providers" /> {t('Route')}<span className="chat-menu-arrow" aria-hidden="true">›</span>
    </Menu.SubTrigger>
    <Menu.Portal container={container}>
      <Menu.SubContent className="chat-menu" sideOffset={4} collisionPadding={8}>
        {!routes.disabled && routes.groups.map(({ id, selected, options, submenu }) => {
          const group = <Menu.RadioGroup key={id} value={selected}>
            {options.map(({ value, label, onSelect }) => <Menu.RadioItem key={value} value={value} className="chat-menu-item" onSelect={onSelect}>
              <span className="chat-route-check" aria-hidden="true"><Menu.ItemIndicator>✓</Menu.ItemIndicator></span>
              {t(label)}
            </Menu.RadioItem>)}
          </Menu.RadioGroup>;
          return submenu ? <Menu.Sub key={id}>
            <Menu.SubTrigger className="chat-menu-item" disabled={submenu.disabled}>{t(submenu.label)}<span className="chat-menu-arrow" aria-hidden="true">›</span></Menu.SubTrigger>
            <Menu.Portal container={container}>
              <Menu.SubContent className="chat-menu" sideOffset={4} collisionPadding={8}>{group}</Menu.SubContent>
            </Menu.Portal>
          </Menu.Sub> : group;
        })}
      </Menu.SubContent>
    </Menu.Portal>
  </Menu.Sub>;
}

function AccountMenu({ account, onSettings, container, routes }: {
  account?: ChatAccount; onSettings: () => void; container: HTMLDivElement | null; routes?: RouteMenu;
}) {
  const { t } = useAppTranslation();
  const trigger = useRef<HTMLButtonElement>(null);
  const openSettings = useRef(false);
  const monogram = account && initials(account.name);
  return <Menu.Root modal={false}>
    <Tooltip content={account?.name || t('Account menu')}><Menu.Trigger ref={trigger} type="button" className="chat-avatar" aria-label={t('Account menu')}>
      {monogram ? <span aria-hidden="true">{monogram}</span> : <ChatIcon name="user" />}
    </Menu.Trigger></Tooltip>
    {container && <Menu.Portal container={container}>
      <Menu.Content className="chat-menu" side="top" align="start" sideOffset={8} collisionPadding={8}
        onCloseAutoFocus={(event) => {
          if (!openSettings.current) return;
          event.preventDefault();
          openSettings.current = false;
          // Return focus to the avatar before the native dialog takes focus.
          trigger.current?.focus();
          onSettings();
        }}>
        <Menu.Item className="chat-menu-item" onSelect={() => { openSettings.current = true; }}>
          <ChatIcon name="settings" /> {t('Settings')}
        </Menu.Item>
        {routes && <RouteSubmenu routes={routes} container={container} />}
        {account?.onLogout && <Menu.Item className="chat-menu-item" disabled={account.busy} onSelect={account.onLogout}>
          <ChatIcon name="logout" /> {t('Log out')}
        </Menu.Item>}
      </Menu.Content>
    </Menu.Portal>}
  </Menu.Root>;
}

function HistoryRow({ item, active, busy, container, pinButtonId, onOpen, onPin, onDelete }: {
  item: Conversation; active: boolean; busy: boolean; container: HTMLDivElement | null; pinButtonId: string;
  onOpen: () => void; onPin: () => void; onDelete: () => void;
}) {
  const { t } = useAppTranslation();
  const title = conversationTitle(item, t('Conversation'));
  const pinned = item.metadata?.pinned === true;
  const action = t(pinned ? 'Unpin' : 'Pin');
  const icon = pinned ? 'unpin' : 'pin';
  return <li className="chat-history-row" data-current={active || undefined}>
    <Button variant="subtle" className="chat-history-link" disabled={busy} aria-current={active ? 'true' : undefined}
      title={title} onClick={onOpen}>{title}</Button>
    <div className="chat-row-actions">
      <Tooltip content={action}><button id={pinButtonId} type="button" className="chat-row-button" aria-label={t(pinned ? 'Unpin {{title}}' : 'Pin {{title}}', { title })} onClick={onPin}>
        <ChatIcon name={icon} />
      </button></Tooltip>
      <Menu.Root modal={false}>
        <Tooltip content={t('More actions')}><Menu.Trigger type="button" className="chat-row-button chat-menu-trigger" aria-label={t('More actions for {{title}}', { title })}>
          <ChatIcon name="more" />
        </Menu.Trigger></Tooltip>
        {container && <Menu.Portal container={container}>
          <Menu.Content className="chat-menu" align="end" sideOffset={4} collisionPadding={8} hideWhenDetached>
            <Menu.Item className="chat-menu-item" onSelect={onPin}><ChatIcon name={icon} /> {action}</Menu.Item>
            <Menu.Item className="chat-menu-item" data-danger disabled={busy} onSelect={onDelete}><ChatIcon name="trash" /> {t('Delete')}</Menu.Item>
          </Menu.Content>
        </Menu.Portal>}
      </Menu.Root>
    </div>
  </li>;
}

export function ChatNavigation({ appName, expanded, history, active, busy, account, container, view, onView, toggle, onNew, onOpen, onPin, onDelete, onSettings, routes }: {
  appName: string; expanded: boolean; history: Conversation[]; active: string; busy: boolean; account?: ChatAccount; container: HTMLDivElement | null;
  view: ChatView; onView: (view: ChatView) => void;
  toggle: () => void; onNew: () => void; onOpen: (item: Conversation) => void; onPin: (id: string) => void;
  onDelete: (id: string) => void; onSettings: () => void; routes?: RouteMenu;
}) {
  const { t } = useAppTranslation();
  const agentsEnabled = !!useAgents();
  const panelId = useId();
  const toggleButton = useRef<HTMLButtonElement>(null);
  const pendingFocus = useRef<string | undefined>(undefined);
  useLayoutEffect(() => {
    if (!pendingFocus.current) return;
    document.getElementById(pendingFocus.current)?.focus();
    pendingFocus.current = undefined;
  }, [history]);

  const ordered = expanded ? [...history].sort(newestFirst) : [];
  function group(label: string, records: Conversation[]) {
    if (!records.length) return null;
    return <section className="chat-history-group">
      <h3>{label}</h3>
      <ul aria-label={label}>
        {records.map((item) => {
          const pinButtonId = `${panelId}-pin-${item.id}`;
          return <HistoryRow key={item.id} item={item} active={item.id === active} busy={busy} container={container}
            pinButtonId={pinButtonId} onOpen={() => onOpen(item)} onPin={() => {
              pendingFocus.current = pinButtonId;
              onPin(item.id);
            }} onDelete={() => { onDelete(item.id); toggleButton.current?.focus(); }} />;
        })}
      </ul>
    </section>;
  }

  return <>
    <nav className="chat-nav" aria-label={t('Chat navigation')}>
      <Tooltip content={t(expanded ? 'Hide chat history' : 'Show chat history')}><button ref={toggleButton} type="button" className="chat-rail-button" aria-label={t('Toggle navigation')} aria-expanded={expanded}
        aria-controls={panelId} onClick={toggle}>
        <ChatIcon name="sidebar" />
      </button></Tooltip>
      <Tooltip content={t('New chat')}><button type="button" className="chat-rail-button" aria-label={t('New chat')} disabled={busy} onClick={onNew}>
        <ChatIcon name="compose" />
      </button></Tooltip>
      {([['images', 'Images'], ['transcriptions', 'Transcriptions'], ['models', 'Models'], ['providers', 'Providers'], ['agents', 'Agents'], ['skills', 'Skills']] as const)
        .filter(([key]) => key !== 'agents' || agentsEnabled).map(([key, label]) =>
        <Tooltip key={key} content={t(label)}><button type="button" className="chat-rail-button" aria-label={t(label)} aria-current={view === key ? 'page' : undefined}
          onClick={() => onView(key)}><ChatIcon name={key === 'skills' ? 'docs' : key === 'transcriptions' ? 'mic' : key} /></button></Tooltip>)}
      <AccountMenu account={account} onSettings={onSettings} container={container} routes={routes} />
    </nav>
    <aside id={panelId} className="chat-history-panel" aria-label={t('Chat history')} hidden={!expanded}>
      <h2>{appName}</h2>
      <div className="chat-history-scroll" onKeyDown={(event) => {
        if (event.key === 'Escape' && !event.defaultPrevented && !(event.target as HTMLElement).closest('[role=menu]')) {
          toggle();
          toggleButton.current?.focus();
        }
      }}>
        {group(t('Pinned'), ordered.filter(item => item.metadata?.pinned === true))}
        {group(t('Recent'), ordered.filter(item => item.metadata?.pinned !== true))}
        {!history.length && <p>{t('No conversations yet.')}</p>}
      </div>
    </aside>
  </>;
}
