import { Button, Tooltip } from '@streaik/themes';
import { useEffect, useId, useRef, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { ChatIcon } from './ChatIcon';
import { DialogTabs } from './DialogTabs';
import { useAppTranslation } from './i18n';
import { fetchMcpCatalog, filterMcpCatalog, mcpAppAuth, preferredMcpRemote } from './mcp';
import type { McpCatalogServer, McpOptions } from './mcp';
import { mcpEndpoint, mcpHeaderFields, resolveMcpHeaders } from './mcpConfiguration';
import type { McpHeaderRow, McpServerRecord } from './mcpConfiguration';
import type { McpSelection, McpServers } from './useMcpServers';
import { VersionBadge } from './VersionBadge';
import './mcpServers.css';

export type McpEditorTarget = { record?: McpServerRecord; installing?: boolean };

function McpDialog({ title, close, wide, children }: { title: string; close: () => void; wide?: boolean; children: (closeDialog: () => void) => ReactNode }) {
  const { t } = useAppTranslation();
  const id = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const closeDialog = () => dialog.current?.close();
  useEffect(() => { if (dialog.current && !dialog.current.open) dialog.current.showModal(); }, []);
  return <dialog ref={dialog} className={wide ? 'chat-settings mcp-dialog mcp-catalog-dialog' : 'chat-settings mcp-dialog'} aria-labelledby={id} onClose={close}>
    <header className="chat-settings-header"><h2 id={id}>{title}</h2>
      <Button type="button" variant="subtle" className="chat-close" aria-label={t('Close')} onClick={closeDialog}><ChatIcon name="close" /></Button>
    </header>
    {children(closeDialog)}
  </dialog>;
}

export function McpServerEditor({ target, options, store, close }: { target: McpEditorTarget; options?: McpOptions; store: McpServers; close: () => void }) {
  const { t } = useAppTranslation();
  const { record, installing } = target;
  const existing = record && store.credentials(record.id);
  const declarations = record?.declarations ?? [];
  const appAuth = record && mcpAppAuth(options, record);
  const [auth, setAuth] = useState(record?.auth ?? 'manual');
  const [title, setTitle] = useState(record?.title ?? '');
  const [url, setUrl] = useState(record?.endpoint ?? '');
  const [fields, setFields] = useState(existing?.fields ?? new Map<string, string>());
  const [rows, setRows] = useState<readonly McpHeaderRow[]>(existing?.rows ?? (record?.extraNames ?? []).map(name => ({ name, value: '' })));
  const [error, setError] = useState('');
  const endpoint = mcpEndpoint(url);
  const id = useId();

  function submit(event: FormEvent<HTMLFormElement>, closeDialog: () => void) {
    event.preventDefault();
    try {
      if (!endpoint) throw new Error('Enter an HTTPS MCP URL, or an HTTP URL on localhost, without credentials, a query, or a fragment.');
      const extra = rows.filter(row => row.name.trim() || row.value).map(row => ({ ...row, name: row.name.trim() }));
      const defaults = new Map(mcpHeaderFields(declarations, new Map()).map(field => [field.id, field.value]));
      const savedFields = new Map([...fields].filter(([key, value]) => defaults.has(key) && value !== defaults.get(key)));
      if (auth === 'manual') resolveMcpHeaders(declarations, savedFields, extra);
      else if (!appAuth?.ready) throw new Error('App credentials are unavailable. Choose manual headers or update your app credentials.');
      const needsSession = auth === 'manual' && (savedFields.size > 0 || extra.length > 0);
      store.save({ id: record?.id ?? crypto.randomUUID().slice(0, 12), title: title.trim() || new URL(endpoint).host,
        endpoint, source: record?.source ?? 'manual', auth, declarations,
        extraNames: auth === 'manual' ? extra.map(row => row.name) : [], needsSession },
      needsSession ? { fields: savedFields, rows: extra } : undefined);
      closeDialog();
    } catch (error) { setError(error instanceof Error ? error.message : 'Could not save the MCP server.'); }
  }

  function changeRow(index: number, key: keyof McpHeaderRow, value: string) {
    setRows(rows.map((row, rowIndex) => rowIndex === index ? { ...row, [key]: value } : row));
  }

  return <McpDialog title={t(installing ? 'Install MCP server' : record ? 'Model Context Server' : 'Add MCP server')} close={close}>{closeDialog =>
    <form className="chat-settings-section mcp-form" onSubmit={event => submit(event, closeDialog)} autoComplete="off">
      <label>{t('Server name')}<input value={title} onChange={event => setTitle(event.target.value)} maxLength={160} /></label>
      <label>{t('Server URL')}<input type="url" required value={url} readOnly={!!record} onChange={event => setUrl(event.target.value)} maxLength={2048} /></label>
      {(appAuth || auth === 'app') && <label>{t('Authentication')}<select value={auth} onChange={event => setAuth(event.target.value === 'app' ? 'app' : 'manual')}>
        <option value="app">{t('Use app credentials')}</option><option value="manual">{t('Enter headers manually')}</option>
      </select></label>}
      {auth === 'app' && !appAuth?.ready && <p role="status">{t('App credentials are unavailable for this server.')}</p>}
      {auth === 'manual' && <fieldset className="mcp-fields">
        <legend>{t('Request headers')}</legend>
        <p>{t('Header values are kept in memory only. Re-enter them after reloading or signing out.')}</p>
        {mcpHeaderFields(declarations, fields).map(field => <label key={field.id}>
          {field.label}{field.description && <small>{field.description}</small>}
          {field.choices && !field.fixed ? <select value={field.value} required={field.isRequired} onChange={event => setFields(new Map(fields).set(field.id, event.target.value))}>
            <option value="">{t('Choose a value')}</option>{field.choices.map(value => <option key={value}>{value}</option>)}
          </select> : <input type={field.isSecret ? 'password' : 'text'} autoComplete={field.isSecret ? 'new-password' : 'off'}
            spellCheck={false} required={field.isRequired} readOnly={field.fixed} maxLength={8192} value={field.value}
            onChange={event => setFields(new Map(fields).set(field.id, event.target.value))} />}
        </label>)}
        {rows.map((row, index) => <div className="mcp-header-row" key={index}>
          <label htmlFor={`${id}-name-${index}`}>{t('Header name')}<input id={`${id}-name-${index}`} value={row.name} maxLength={128}
            spellCheck={false} onChange={event => changeRow(index, 'name', event.target.value)} /></label>
          <label htmlFor={`${id}-value-${index}`}>{t('Header value')}<input id={`${id}-value-${index}`} type="password" autoComplete="new-password"
            value={row.value} maxLength={8192} onChange={event => changeRow(index, 'value', event.target.value)} /></label>
          <Button type="button" variant="subtle" aria-label={t('Remove header {{index, number}}', { index: index + 1 })}
            onClick={() => setRows(rows.filter((_, rowIndex) => rowIndex !== index))}><ChatIcon name="trash" /></Button>
        </div>)}
        <Button variant="subtle" type="button" disabled={rows.length >= 24} onClick={() => setRows([...rows, { name: '', value: '' }])}>
          <ChatIcon name="add" /> {t('Add header')}
        </Button>
      </fieldset>}
      {error && <p role="alert" className="chat-error">{t(error)}</p>}
      <div className="mcp-actions"><Button type="button" onClick={closeDialog}>{t('Cancel')}</Button>
        <Button type="submit" variant="primary" disabled={auth === 'app' && !appAuth?.ready}>{t(installing ? 'Install server' : 'Save server')}</Button>
      </div>
    </form>}
  </McpDialog>;
}

function Configure({ record, disabled, onConfigure }: { record: McpServerRecord; disabled?: boolean; onConfigure: () => void }) {
  const { t } = useAppTranslation();
  const label = t('Configure {{name}}', { name: record.title });
  return <Tooltip content={label}><Button type="button" variant="subtle" className="chat-composer-icon" aria-label={label}
    aria-haspopup="dialog" disabled={disabled} onClick={onConfigure}><ChatIcon name="edit" /></Button></Tooltip>;
}

type ServerSectionsProps = { store: McpServers; options?: McpOptions; locked: boolean; onEdit: (target: McpEditorTarget) => void };

function McpServerCard({ title, name, description, version, endpoint, actions, inDialog }: {
  title: string; name?: string; description?: string; version?: string; endpoint?: ReactNode; actions: ReactNode; inDialog?: boolean;
}) {
  const Heading = inDialog ? 'h3' : 'h2';
  return <article className="catalog-card mcp-card">
    <div className="catalog-card-title"><span className="catalog-mark"><ChatIcon name="tool" /></span>
      <div className="mcp-card-title-details"><Heading>{title}</Heading>
        {version && <VersionBadge version={version} />}{name && <small>{name}</small>}
      </div></div>
    {description && <p>{description}</p>}
    <div className="mcp-card-footer">
      {endpoint}
      <div className="mcp-actions">{actions}</div>
    </div>
  </article>;
}

function InstalledServers({ store, selection, locked, onEdit }: ServerSectionsProps & { selection?: McpSelection }) {
  const { t } = useAppTranslation();
  const id = useId();
  const [error, setError] = useState(false);
  const disabled = locked || !store.available;
  const addLabel = t('Add by URL');
  const servers = store.records.map(record => {
    const entry = selection?.entries.find(entry => entry.record === record);
    const ready = !!store.connection(record);
    const status = !ready ? t('Credentials needed') : entry?.state === 'loading' ? t('Connecting…')
      : entry?.state === 'error' ? t('Could not connect. Turn the server off and back on to retry.')
      : entry?.state === 'ready' ? entry.discovery.tools.length ? t('{{count, number}} tools available', { count: entry.discovery.tools.length })
        : entry.discovery.hasPrompts || entry.discovery.hasResources ? t('Connected') : t('No compatible tools') : undefined;
    const removeLabel = t('Remove {{name}}', { name: record.title });
    const actions = <>
      <Configure record={record} disabled={disabled} onConfigure={() => onEdit({ record })} />
      <Tooltip content={removeLabel}><Button className="chat-composer-icon" variant="subtle" type="button" disabled={disabled}
        aria-label={removeLabel} onClick={() => {
          setError(false);
          try { store.remove(record.id); } catch { setError(true); }
        }}><ChatIcon name="trash" /></Button></Tooltip>
    </>;
    const endpoint = <small className="mcp-endpoint">{record.endpoint}</small>;
    const statusId = `${id}-${record.id}`;
    const statusText = status && <small id={statusId} role="status">{status}</small>;
    if (!selection) return <McpServerCard key={record.id} title={record.title} endpoint={endpoint} actions={<>{statusText}{actions}</>} />;
    return <li className="mcp-row" key={record.id}>
      <label className="mcp-toggle"><input type="checkbox" role="switch" checked={!!entry} aria-describedby={status ? statusId : undefined}
        disabled={!ready || disabled} onChange={event => selection.set(record, event.target.checked)} /><span>{record.title}</span></label>
      <div className="mcp-actions">{actions}</div>
      {endpoint}
      {statusText}
    </li>;
  });
  return <section aria-label={t('Installed')}>
    {selection && <div className="mcp-section-heading"><h2>{t('Installed')}</h2>
      <Tooltip content={addLabel}><Button type="button" variant="subtle" className="chat-composer-icon" aria-label={addLabel}
        aria-haspopup="dialog" disabled={disabled} onClick={() => onEdit({})}><ChatIcon name="link" /></Button></Tooltip>
    </div>}
    {selection && servers.length > 0 && <p>{t('Only enable servers you trust. Tool inputs are sent when a tool runs; approval controls sharing the result with the chat model.')}</p>}
    {error && <p role="alert" className="chat-error">{t('Could not remove this MCP server.')}</p>}
    {servers.length === 0 ? <p>{t('No MCP servers installed yet.')}</p>
      : selection ? <ul className="mcp-list">{servers}</ul> : <div className="catalog-grid">{servers}</div>}
  </section>;
}

function CopyServerUrl({ endpoint }: { endpoint: string }) {
  const { t } = useAppTranslation();
  const [status, setStatus] = useState<'Copied' | 'Copy failed'>();
  return <>
    <small role="status">{status && t(status)}</small>
    <Tooltip content={endpoint}><Button type="button" variant="subtle" className="chat-composer-icon" aria-label={t('Copy server URL')}
      onClick={async () => {
        try { await navigator.clipboard.writeText(endpoint); setStatus('Copied'); }
        catch { setStatus('Copy failed'); }
      }}><ChatIcon name={status === 'Copied' ? 'check' : 'copy'} /></Button></Tooltip>
  </>;
}

function CatalogCard({ item, installed, disabled, options, install, inDialog }: { item: McpCatalogServer; installed: ReadonlySet<string>; disabled: boolean; options?: McpOptions;
  install: (item: McpCatalogServer, remote: McpCatalogServer['remotes'][number]) => void; inDialog: boolean }) {
  const { t } = useAppTranslation();
  const [selected, setSelected] = useState('');
  const remote = item.remotes.find(choice => choice.endpoint === selected) ?? preferredMcpRemote(item.remotes, options);
  const isInstalled = remote && installed.has(remote.endpoint);
  const installLabel = t('Install {{name}}', { name: item.title });
  const endpoint = item.remotes.length > 1 ? <label className="mcp-endpoint">{t('Server URL')} <select value={remote?.endpoint} onChange={event => setSelected(event.target.value)}>
      {item.remotes.map(choice => <option key={choice.endpoint}>{choice.endpoint}</option>)}
    </select></label> : undefined;
  const actions = !remote ? <small>{t('No compatible Streamable HTTP endpoint')}</small> : isInstalled ? <small>{t('Installed')}</small>
    : <Tooltip content={installLabel}><Button type="button" variant="subtle" className="chat-composer-icon" aria-label={installLabel}
      disabled={disabled} onClick={() => install(item, remote)}><ChatIcon name="download" /></Button></Tooltip>;
  return <McpServerCard title={item.title} name={item.name} description={item.description} version={item.version}
    endpoint={endpoint} actions={<>{remote && <CopyServerUrl key={remote.endpoint} endpoint={remote.endpoint} />}{actions}</>} inDialog={inDialog} />;
}

function McpRegistry({ store, options, locked, onEdit, inDialog }: ServerSectionsProps & { inDialog: boolean }) {
  const { t } = useAppTranslation();
  const [catalog, setCatalog] = useState<McpCatalogServer[]>([]);
  const [cursor, setCursor] = useState<string>();
  const [request, setRequest] = useState<{ cursor?: string }>();
  const [registryError, setRegistryError] = useState(false);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const registryUrl = options?.registryUrl;
  useEffect(() => { setCatalog([]); setCursor(undefined); setRegistryError(false); setRequest(registryUrl ? {} : undefined); }, [registryUrl]);
  useEffect(() => {
    if (!registryUrl || !request) return;
    const controller = new AbortController();
    void fetchMcpCatalog(registryUrl, controller.signal, request.cursor).then(page => {
      if (controller.signal.aborted) return;
      setCatalog(previous => [...new Map([...(request.cursor ? previous : []), ...page.servers].map(item => [item.name, item])).values()]);
      setCursor(page.cursor);
      setRegistryError(false);
    }, () => { if (!controller.signal.aborted) setRegistryError(true); }).finally(() => {
      if (!controller.signal.aborted) setRequest(undefined);
    });
    return () => controller.abort();
  }, [registryUrl, request]);

  const installed = new Set(store.records.map(record => record.endpoint));
  const term = query.trim().toLowerCase();
  const results = filterMcpCatalog(catalog, options?.filterRegistryRemote)
    .filter(item => `${item.title} ${item.name} ${item.description ?? ''}`.toLowerCase().includes(term));
  const disabled = locked || !store.available;
  const refreshLabel = t('Refresh registry');

  function install(item: McpCatalogServer, remote: McpCatalogServer['remotes'][number]) {
    setError('');
    const slug = item.name.split('/').at(-1)?.toLowerCase().replace(/[^a-z0-9]+/g, '_').slice(0, 22);
    const id = slug && !store.records.some(record => record.id === slug) ? slug : crypto.randomUUID().slice(0, 12);
    const record: McpServerRecord = { ...remote, id, title: item.title, source: 'registry', auth: 'manual', extraNames: [] };
    if (mcpAppAuth(options, record)?.ready) record.auth = 'app';
    else if (mcpHeaderFields(record.declarations, new Map()).some(field => !field.fixed)) { onEdit({ record, installing: true }); return; }
    try {
      if (record.auth === 'manual') resolveMcpHeaders(record.declarations, new Map(), []);
      store.save(record);
    } catch (error) { setError(error instanceof Error ? error.message : 'Could not install this MCP server.'); }
  }

  const refresh = registryUrl && <Tooltip content={refreshLabel}>
    <Button type="button" variant="subtle" className="chat-composer-icon" aria-label={refreshLabel}
      disabled={!!request} onClick={() => setRequest({})}><ChatIcon name="refresh" /></Button>
  </Tooltip>;
  return <section aria-label={t('MCP registry')}>
    {inDialog && <div className="mcp-section-heading"><h2>{t('Registry')}</h2>{refresh}</div>}
    {error && <p role="alert" className="chat-error">{t(error)}</p>}
      {!registryUrl ? <p>{t('No MCP registry is configured. You can still add servers by URL.')}</p> : <>
        <div className="catalog-filters mcp-registry-toolbar"><input type="search" aria-label={t('Search MCP servers')} placeholder={t('Search MCP servers')}
          value={query} onChange={event => setQuery(event.target.value)} />{!inDialog && refresh}</div>
        {request && <p role="status">{t('Loading MCP servers…')}</p>}
        {registryError && <p role="alert" className="chat-error">{t('Could not load the MCP registry.')}</p>}
        {results.length ? <div className="catalog-grid">{results.map(item => <CatalogCard key={item.name} item={item} installed={installed}
          disabled={disabled} options={options} install={install} inDialog={inDialog} />)}</div>
          : !request && !registryError && <p>{t(term ? 'No matching MCP servers.' : 'No MCP servers found in the registry.')}</p>}
        {cursor && <Button type="button" className="catalog-more" disabled={!!request} onClick={() => setRequest({ cursor })}>{t('Load more servers')}</Button>}
      </>}
  </section>;
}

function McpServerTabs({ selection, ...props }: ServerSectionsProps & { selection?: McpSelection }) {
  const { t } = useAppTranslation();
  const id = useId();
  const [tab, setTab] = useState<'installed' | 'registry'>(() => selection && !props.store.records.length ? 'registry' : 'installed');
  const [registryOpened, setRegistryOpened] = useState(tab === 'registry');
  return <>
    <DialogTabs id={id} label={t('MCP Servers')} tabs={[[ 'installed', t('Installed') ], [ 'registry', t('Registry') ]]} value={tab}
      className={selection ? undefined : 'catalog-tabs'}
      onChange={next => { setTab(next); if (next === 'registry') setRegistryOpened(true); }} />
    <div id={`${id}-installed-panel`} aria-labelledby={`${id}-installed-tab`} role="tabpanel" tabIndex={0} hidden={tab !== 'installed'}>
      <InstalledServers {...props} selection={selection} />
    </div>
    <div id={`${id}-registry-panel`} aria-labelledby={`${id}-registry-tab`} role="tabpanel" tabIndex={0} hidden={tab !== 'registry'}>
      {registryOpened && <McpRegistry {...props} inDialog={!!selection} />}
    </div>
  </>;
}

export function ModelContextDialog({ close, ...props }: ServerSectionsProps & { selection: McpSelection; close: () => void }) {
  const { t } = useAppTranslation();
  return <McpDialog title={t('Model Context')} close={close} wide>{() => <McpServerTabs {...props} />}</McpDialog>;
}

export function McpServersView({ toolbar, ...props }: ServerSectionsProps & { toolbar: HTMLElement | null }) {
  const { t } = useAppTranslation();
  const addLabel = t('Add by URL');
  return <div className="catalog-content mcp-page">
    {toolbar && createPortal(<Button className="agent-create" type="button" variant="primary" aria-label={addLabel} title={addLabel}
      aria-haspopup="dialog" disabled={props.locked || !props.store.available} onClick={() => props.onEdit({})}><ChatIcon name="add" /></Button>, toolbar)}
    <header><h1>{t('MCP Servers')}</h1></header>
    {!props.store.available && <p role="status">{t('Sign in or unlock this profile to manage MCP servers.')}</p>}
    <McpServerTabs {...props} />
  </div>;
}
