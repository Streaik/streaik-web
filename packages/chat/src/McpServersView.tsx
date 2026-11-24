import { Button, Tooltip } from '@streaik/themes';
import { useEffect, useId, useRef, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import { ChatIcon } from './ChatIcon';
import { DialogTabs } from './ChatToolsDialogs';
import { useAppTranslation } from './i18n';
import { fetchMcpCatalog, mcpAppAuth, preferredMcpRemote } from './mcp';
import type { McpCatalogServer, McpOptions } from './mcp';
import { mcpEndpoint, mcpHeaderFields, resolveMcpHeaders } from './mcpConfiguration';
import type { McpHeaderRow, McpServerRecord } from './mcpConfiguration';
import type { McpSelection, McpServers } from './useMcpServers';
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

  return <McpDialog title={t(installing ? 'Install MCP server' : record ? 'Configure MCP server' : 'Add MCP server')} close={close}>{closeDialog =>
    <form className="chat-settings-section mcp-form" onSubmit={event => submit(event, closeDialog)} autoComplete="off">
      <label>{t('Server name')}<input value={title} onChange={event => setTitle(event.target.value)} maxLength={160} /></label>
      <label>{t('Server URL')}<input type="url" required value={url} readOnly={!!record} onChange={event => setUrl(event.target.value)} maxLength={2048} /></label>
      {endpoint && <p>{t('Headers are sent only to {{host}} at this server URL.', { host: new URL(endpoint).host })}</p>}
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

function InstalledServers({ store, selection, locked, onEdit }: ServerSectionsProps & { selection?: McpSelection }) {
  const { t } = useAppTranslation();
  const id = useId();
  const [error, setError] = useState(false);
  const disabled = locked || !store.available;
  return <section aria-label={t('Installed servers')}>
    <div className="mcp-section-heading"><h2>{t('Installed servers')}</h2><Button type="button" disabled={disabled} onClick={() => onEdit({})}>
      <ChatIcon name="add" /> {t('Add by URL')}
    </Button></div>
    {selection && store.records.length > 0 && <p>{t('Only enable servers you trust. Tool inputs are sent when a tool runs; approval controls sharing the result with the chat model.')}</p>}
    {error && <p role="alert" className="chat-error">{t('Could not remove this MCP server.')}</p>}
      {store.records.length ? <ul className="mcp-list">{store.records.map(record => {
        const entry = selection?.entries.find(entry => entry.record === record);
        const ready = !!store.connection(record);
        const status = !ready ? t('Credentials needed') : entry?.state === 'loading' ? t('Loading tools…')
          : entry?.state === 'error' ? t('Could not connect. Turn the server off and back on to retry.')
          : entry?.state === 'ready' ? entry.tools?.length ? t('{{count, number}} tools available', { count: entry.tools.length })
            : t('No compatible tools') : undefined;
        const description = `${id}-${record.id}`;
        return <li className="mcp-row" key={record.id}>
          {selection ? <label className="mcp-toggle"><input type="checkbox" role="switch" checked={!!entry} aria-describedby={status ? description : undefined}
            disabled={!ready || disabled} onChange={event => selection.set(record, event.target.checked)} /><span>{record.title}</span></label>
            : <strong>{record.title}</strong>}
          <div className="mcp-actions">
            <Configure record={record} disabled={disabled} onConfigure={() => onEdit({ record })} />
            <Tooltip content={t('Remove {{name}}', { name: record.title })}><Button className="chat-composer-icon" variant="subtle" type="button" disabled={disabled}
              aria-label={t('Remove {{name}}', { name: record.title })} onClick={() => {
                setError(false);
                try { store.remove(record.id); } catch { setError(true); }
              }}><ChatIcon name="trash" /></Button></Tooltip>
          </div>
          <small className="mcp-endpoint">{record.endpoint}</small>
          {status && <small id={description} role="status">{status}</small>}
        </li>;
      })}</ul> : <p>{t('No MCP servers installed yet.')}</p>}
  </section>;
}

function CatalogCard({ item, installed, disabled, options, install }: { item: McpCatalogServer; installed: ReadonlySet<string>; disabled: boolean; options?: McpOptions;
  install: (item: McpCatalogServer, remote: McpCatalogServer['remotes'][number]) => void }) {
  const { t } = useAppTranslation();
  const [selected, setSelected] = useState('');
  const remote = item.remotes.find(choice => choice.endpoint === selected) ?? preferredMcpRemote(item.remotes, options);
  const isInstalled = remote && installed.has(remote.endpoint);
  return <article className="catalog-card">
    <div className="catalog-card-title"><span className="catalog-mark"><ChatIcon name="tool" /></span>
      <div><h3>{item.title}</h3><small>{item.name}</small></div></div>
    {item.description && <p>{item.description}</p>}
    {item.version && <small>{t('Version {{version}}', { version: item.version })}</small>}
    {item.remotes.length > 1 ? <label className="mcp-endpoint">{t('Server URL')} <select value={remote?.endpoint} onChange={event => setSelected(event.target.value)}>
      {item.remotes.map(choice => <option key={choice.endpoint}>{choice.endpoint}</option>)}
    </select></label> : remote && <small className="mcp-endpoint">{remote.endpoint}</small>}
    <div className="mcp-actions">{!remote ? <small>{t('No compatible Streamable HTTP endpoint')}</small> : isInstalled ? <small>{t('Installed')}</small>
      : <Button type="button" aria-label={t('Install {{name}}', { name: item.title })} disabled={disabled} onClick={() => install(item, remote)}>{t('Install')}</Button>}</div>
  </article>;
}

function McpRegistry({ store, options, locked, onEdit }: ServerSectionsProps) {
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
  const results = catalog.filter(item => `${item.title} ${item.name} ${item.description ?? ''}`.toLowerCase().includes(term));
  const disabled = locked || !store.available;

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

  return <section aria-label={t('MCP registry')}>
    <div className="mcp-section-heading"><h2>{t('Registry')}</h2>{registryUrl && <Button type="button" disabled={!!request} onClick={() => setRequest({})}>{t('Refresh registry')}</Button>}</div>
    {error && <p role="alert" className="chat-error">{t(error)}</p>}
      {!registryUrl ? <p>{t('No MCP registry is configured. You can still add servers by URL.')}</p> : <>
        <div className="catalog-filters"><input type="search" aria-label={t('Search MCP servers')} placeholder={t('Search MCP servers')} value={query}
          onChange={event => setQuery(event.target.value)} /></div>
        {request && <p role="status">{t('Loading MCP servers…')}</p>}
        {registryError && <p role="alert" className="chat-error">{t('Could not load the MCP registry.')}</p>}
        {results.length ? <div className="catalog-grid">{results.map(item => <CatalogCard key={item.name} item={item} installed={installed} disabled={disabled} options={options} install={install} />)}</div>
          : !request && !registryError && <p>{t(term ? 'No matching MCP servers.' : 'No MCP servers found in the registry.')}</p>}
        {cursor && <Button type="button" className="catalog-more" disabled={!!request} onClick={() => setRequest({ cursor })}>{t('Load more servers')}</Button>}
      </>}
  </section>;
}

export function ModelContextDialog({ close, selection, ...props }: ServerSectionsProps & { selection: McpSelection; close: () => void }) {
  const { t } = useAppTranslation();
  const id = useId();
  const [tab, setTab] = useState<'installed' | 'registry'>(() => props.store.records.length ? 'installed' : 'registry');
  const [registryOpened, setRegistryOpened] = useState(tab === 'registry');
  return <McpDialog title={t('Model Context')} close={close} wide>{() => <>
    <DialogTabs id={id} label={t('MCP Servers')} tabs={[[ 'installed', t('Installed') ], [ 'registry', t('Registry') ]]} value={tab}
      onChange={next => { setTab(next); if (next === 'registry') setRegistryOpened(true); }} />
    <div id={`${id}-installed-panel`} aria-labelledby={`${id}-installed-tab`} role="tabpanel" tabIndex={0} hidden={tab !== 'installed'}>
      <InstalledServers {...props} selection={selection} />
    </div>
    <div id={`${id}-registry-panel`} aria-labelledby={`${id}-registry-tab`} role="tabpanel" tabIndex={0} hidden={tab !== 'registry'}>
      {registryOpened && <McpRegistry {...props} />}
    </div>
  </>}</McpDialog>;
}

export function McpServersView(props: ServerSectionsProps) {
  const { t } = useAppTranslation();
  return <div className="catalog-content mcp-page">
    <header><h1>{t('MCP Servers')}</h1><p>{t('Install servers from the registry or add an MCP server by URL. Choose which installed servers to use in the chat composer.')}</p></header>
    {!props.store.available && <p role="status">{t('Sign in or unlock this profile to manage MCP servers.')}</p>}
    <InstalledServers {...props} />
    <McpRegistry {...props} />
  </div>;
}
