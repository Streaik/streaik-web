import { Button, Tooltip } from '@streaik/themes';
import { useEffect, useId, useRef, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import { ChatIcon } from './ChatIcon';
import { useAppTranslation } from './i18n';
import { fetchMcpCatalog, mcpAppAuth } from './mcp';
import type { McpCatalogServer, McpOptions } from './mcp';
import { mcpEndpoint, mcpHeaderFields, resolveMcpHeaders } from './mcpConfiguration';
import type { McpHeaderRow, McpServerRecord } from './mcpConfiguration';
import type { McpSelection, McpServers } from './useMcpServers';
import './mcpServers.css';

export type McpEditorTarget = { record?: McpServerRecord; installing?: boolean };

function McpDialog({ title, close, children }: { title: string; close: () => void; children: ReactNode }) {
  const { t } = useAppTranslation();
  const id = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { if (dialog.current && !dialog.current.open) dialog.current.showModal(); }, []);
  return <dialog ref={dialog} className="chat-settings mcp-dialog" aria-labelledby={id} onClose={close}>
    <header className="chat-settings-header"><h2 id={id}>{title}</h2>
      <Button type="button" variant="subtle" className="chat-close" aria-label={t('Close')} onClick={() => dialog.current?.close()}><ChatIcon name="close" /></Button>
    </header>
    {children}
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

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      if (!endpoint) throw new Error('Enter an HTTPS MCP URL, or an HTTP URL on localhost, without credentials, a query, or a fragment.');
      const extra = rows.filter(row => row.name.trim() || row.value).map(row => ({ ...row, name: row.name.trim() }));
      const savedFields = new Map([...fields].filter(([key, value]) => value !== mcpHeaderFields(declarations, new Map()).find(field => field.id === key)?.value));
      if (auth === 'manual') resolveMcpHeaders(declarations, savedFields, extra);
      else if (!appAuth?.ready) throw new Error('App credentials are unavailable. Choose manual headers or update your app credentials.');
      const needsSession = auth === 'manual' && (savedFields.size > 0 || extra.length > 0);
      store.save({ id: record?.id ?? crypto.randomUUID().slice(0, 12), title: title.trim() || new URL(endpoint).host,
        endpoint, source: record?.source ?? 'manual', auth, declarations,
        extraNames: auth === 'manual' ? extra.map(row => row.name) : [], needsSession },
      needsSession ? { fields: savedFields, rows: extra } : undefined);
      close();
    } catch (error) { setError(error instanceof Error ? error.message : 'Could not save the MCP server.'); }
  }

  function changeRow(index: number, key: keyof McpHeaderRow, value: string) {
    setRows(rows.map((row, rowIndex) => rowIndex === index ? { ...row, [key]: value } : row));
  }

  return <McpDialog title={t(installing ? 'Install MCP server' : record ? 'Configure MCP server' : 'Add MCP server')} close={close}>
    <form className="chat-settings-section mcp-form" onSubmit={submit} autoComplete="off">
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
      <div className="mcp-actions"><Button type="button" onClick={close}>{t('Cancel')}</Button>
        <Button type="submit" variant="primary" disabled={auth === 'app' && !appAuth?.ready}>{t(installing ? 'Install server' : 'Save server')}</Button>
      </div>
    </form>
  </McpDialog>;
}

function Configure({ record, disabled, onConfigure }: { record: McpServerRecord; disabled?: boolean; onConfigure: () => void }) {
  const { t } = useAppTranslation();
  const label = t('Configure {{name}}', { name: record.title });
  return <Tooltip content={label}><Button type="button" variant="subtle" className="chat-composer-icon" aria-label={label}
    aria-haspopup="dialog" disabled={disabled} onClick={onConfigure}><ChatIcon name="edit" /></Button></Tooltip>;
}

export function McpServerPicker({ store, selection, locked, onConfigure, onBrowse, close }: {
  store: McpServers; selection: McpSelection; locked: boolean; onConfigure: (record: McpServerRecord) => void; onBrowse: () => void; close: () => void;
}) {
  const { t } = useAppTranslation();
  const id = useId();
  return <McpDialog title={t('MCP servers for this chat')} close={close}>
    <div className="chat-settings-section">
      {store.records.length ? <ul className="mcp-list">{store.records.map(record => {
        const entry = selection.entries.find(entry => entry.record === record);
        const ready = !!store.connection(record);
        const status = !ready ? 'Credentials needed' : entry?.state === 'loading' ? 'Loading tools…'
          : entry?.state === 'error' ? 'Could not connect. Turn the server off and back on to retry.'
          : entry?.state === 'ready' ? entry.tools?.length ? `${entry.tools.length}` : 'No compatible tools' : undefined;
        const description = `${id}-${record.id}`;
        return <li className="mcp-row" key={record.id}>
          <label className="mcp-toggle"><input type="checkbox" role="switch" checked={!!entry} aria-describedby={status ? description : undefined}
            disabled={!ready || locked} onChange={event => selection.set(record, event.target.checked)} /><span>{record.title}</span></label>
          <Configure record={record} disabled={locked} onConfigure={() => onConfigure(record)} />
          {status && <small id={description} role="status">{entry?.state === 'ready' && entry.tools?.length
            ? t('{{count, number}} tools available', { count: entry.tools.length }) : t(status)}</small>}
        </li>;
      })}</ul> : <p>{t('No MCP servers installed yet.')}</p>}
      <div className="mcp-actions"><Button type="button" onClick={onBrowse}>{t('Manage MCP servers')}</Button></div>
    </div>
  </McpDialog>;
}

function CatalogCard({ item, installed, disabled, install }: { item: McpCatalogServer; installed: ReadonlySet<string>; disabled: boolean;
  install: (item: McpCatalogServer, remote: McpCatalogServer['remotes'][number]) => void }) {
  const { t } = useAppTranslation();
  const [selected, setSelected] = useState('');
  const remote = item.remotes.find(choice => choice.endpoint === selected) ?? item.remotes[0];
  const isInstalled = remote && installed.has(remote.endpoint);
  return <article className="catalog-card">
    <div className="catalog-card-title"><ChatIcon name="tool" /><div><h3>{item.title}</h3><small>{item.name}</small></div></div>
    {item.description && <p>{item.description}</p>}
    {item.version && <small>{t('Version {{version}}', { version: item.version })}</small>}
    {item.remotes.length > 1 ? <label className="mcp-endpoint">{t('Server URL')} <select value={remote?.endpoint} onChange={event => setSelected(event.target.value)}>
      {item.remotes.map(choice => <option key={choice.endpoint}>{choice.endpoint}</option>)}
    </select></label> : remote && <small className="mcp-endpoint">{remote.endpoint}</small>}
    <div className="mcp-actions">{!remote ? <small>{t('No compatible Streamable HTTP endpoint')}</small> : isInstalled ? <small>{t('Installed')}</small>
      : <Button type="button" aria-label={t('Install {{name}}', { name: item.title })} disabled={disabled} onClick={() => install(item, remote)}>{t('Install')}</Button>}</div>
  </article>;
}

export function McpServersView({ store, options, locked, onEdit }: { store: McpServers; options?: McpOptions; locked: boolean;
  onEdit: (target: McpEditorTarget) => void }) {
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

  return <div className="catalog-content mcp-page">
    <header><h1>{t('MCP Servers')}</h1><p>{t('Install servers from the registry or add an MCP server by URL. Choose which installed servers to use in the chat composer.')}</p></header>
    {!store.available && <p role="status">{t('Sign in or unlock this profile to manage MCP servers.')}</p>}
    {error && <p role="alert" className="chat-error">{t(error)}</p>}
    <section aria-label={t('Installed servers')}>
      <div className="mcp-section-heading"><h2>{t('Installed servers')}</h2><Button type="button" disabled={disabled} onClick={() => onEdit({})}>
        <ChatIcon name="add" /> {t('Add by URL')}
      </Button></div>
      {store.records.length ? <ul className="mcp-list">{store.records.map(record => <li className="mcp-row" key={record.id}>
        <strong>{record.title}</strong><div className="mcp-actions">
          <Configure record={record} disabled={disabled} onConfigure={() => onEdit({ record })} />
          <Tooltip content={t('Remove {{name}}', { name: record.title })}><Button className="chat-composer-icon" variant="subtle" type="button" disabled={disabled}
            aria-label={t('Remove {{name}}', { name: record.title })} onClick={() => {
              setError('');
              try { store.remove(record.id); } catch { setError('Could not remove this MCP server.'); }
            }}><ChatIcon name="trash" /></Button></Tooltip>
        </div><small className="mcp-endpoint">{record.endpoint}</small>
        {!store.connection(record) && <small role="status">{t('Credentials needed')}</small>}
      </li>)}</ul> : <p>{t('No MCP servers installed yet.')}</p>}
    </section>
    <section aria-label={t('MCP registry')}>
      <div className="mcp-section-heading"><h2>{t('Registry')}</h2>{registryUrl && <Button type="button" disabled={!!request} onClick={() => setRequest({})}>{t('Refresh registry')}</Button>}</div>
      {!registryUrl ? <p>{t('No MCP registry is configured. You can still add servers by URL.')}</p> : <>
        <div className="catalog-filters"><input type="search" aria-label={t('Search MCP servers')} placeholder={t('Search MCP servers')} value={query}
          onChange={event => setQuery(event.target.value)} /></div>
        {request && <p role="status">{t('Loading MCP servers…')}</p>}
        {registryError && <p role="alert" className="chat-error">{t('Could not load the MCP registry.')}</p>}
        {results.length ? <div className="catalog-grid">{results.map(item => <CatalogCard key={item.name} item={item} installed={installed} disabled={disabled} install={install} />)}</div>
          : !request && !registryError && <p>{t(term ? 'No matching MCP servers.' : 'No MCP servers found in the registry.')}</p>}
        {cursor && <Button type="button" className="catalog-more" disabled={!!request} onClick={() => setRequest({ cursor })}>{t('Load more servers')}</Button>}
      </>}
    </section>
  </div>;
}
