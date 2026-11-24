import { useEffect, useRef, useState } from 'react';
import { discoverMcpTools, isMcpRuntime, mcpAppAuth } from './mcp';
import type { McpOptions, McpServer, McpTool } from './mcp';
import { maxMcpServers, parseMcpServer, resolveMcpHeaders } from './mcpConfiguration';
import type { McpHeaderRow, McpServerRecord } from './mcpConfiguration';

export type McpCredentials = { fields: ReadonlyMap<string, string>; rows: readonly McpHeaderRow[] };
const emptyCredentials: McpCredentials = { fields: new Map(), rows: [] };

function load(key?: string): McpServerRecord[] {
  if (!key) return [];
  try {
    const data: unknown = JSON.parse(localStorage.getItem(key) ?? '[]');
    if (!Array.isArray(data)) return [];
    const records: McpServerRecord[] = [];
    for (const value of data.slice(0, maxMcpServers)) {
      const record = parseMcpServer(value);
      if (record && !records.some(item => item.id === record.id || item.endpoint === record.endpoint)) records.push(record);
    }
    return records;
  } catch { return []; }
}

type Library = { key?: string; available: boolean; records: McpServerRecord[]; session: Map<string, McpCredentials> };

export function useMcpServers(scope: string | undefined, options: McpOptions | undefined, available: boolean) {
  const key = scope ? `streaik.mcp.servers:${JSON.stringify([scope, options?.base?.href, options?.registryUrl?.href])}` : undefined;
  const initial = (): Library => ({ key, available, records: available ? load(key) : [], session: new Map() });
  const [library, setLibrary] = useState(initial);
  const current = library.key === key && library.available === available ? library : initial();
  if (current !== library) setLibrary(current);

  function commit(records: McpServerRecord[], session: Library['session']) {
    if (!available) throw new Error('Sign in or unlock this profile to manage MCP servers.');
    if (key) {
      try { localStorage.setItem(key, JSON.stringify(records)); }
      catch { throw new Error('Could not save MCP servers in this browser.'); }
    }
    setLibrary({ key, available, records, session });
  }

  function save(draft: McpServerRecord, credentials?: McpCredentials) {
    const record = parseMcpServer(draft);
    if (!record) throw new Error('Enter a server name and a valid MCP URL.');
    if (current.records.some(item => item.id !== record.id && item.endpoint === record.endpoint)) throw new Error('This MCP URL is already installed.');
    const existing = current.records.some(item => item.id === record.id);
    if (!existing && current.records.length >= maxMcpServers) throw new Error('Remove a server before installing another.');
    const session = new Map(current.session);
    if (credentials) session.set(record.id, credentials);
    else session.delete(record.id);
    commit(existing ? current.records.map(item => item.id === record.id ? record : item) : [...current.records, record], session);
  }

  function remove(id: string) {
    const session = new Map(current.session);
    session.delete(id);
    commit(current.records.filter(item => item.id !== id), session);
  }

  function connection(record: McpServerRecord): McpServer | undefined {
    if (!available) return;
    const pinned = isMcpRuntime(record.endpoint, options?.base);
    const server = { id: record.id, title: record.title, endpoint: record.endpoint, pinned, reviewExecution: record.source === 'manual' || !pinned };
    if (record.auth === 'app') {
      const auth = mcpAppAuth(options, record);
      if (auth?.ready) return { ...server, requestHeaders: auth.headers };
      return;
    }
    const credentials = current.session.get(record.id);
    if ((record.needsSession || record.extraNames.length) && !credentials) return;
    try {
      const { fields, rows } = credentials ?? emptyCredentials;
      const headers = resolveMcpHeaders(record.declarations, fields, rows);
      return { ...server, requestHeaders: () => headers };
    } catch { return; }
  }

  return { available, records: current.records, credentials: (id: string) => current.session.get(id), save, remove, connection };
}

export type McpServers = ReturnType<typeof useMcpServers>;
type Selection = { record: McpServerRecord; state: 'loading' | 'ready' | 'error'; tools?: McpTool[] };

/** Selection belongs to the conversation, not the installed-server library. */
export function useMcpSelection(store: McpServers) {
  const [selected, setSelected] = useState<ReadonlyMap<string, Selection>>(() => new Map());
  const requests = useRef(new Map<string, AbortController>());
  useEffect(() => {
    const active = requests.current;
    return () => { active.forEach(controller => controller.abort()); active.clear(); };
  }, []);

  const readyRecords = store.records.filter(record => !!store.connection(record));
  const current = readyRecords.flatMap(record => {
    const entry = selected.get(record.id);
    return entry?.record === record ? [entry] : [];
  });
  const invalid = [...selected.values()].filter(entry => !readyRecords.includes(entry.record));
  useEffect(() => {
    for (const { record } of invalid) clear(record.id);
  });

  function clear(id: string) {
    requests.current.get(id)?.abort();
    requests.current.delete(id);
    setSelected(previous => {
      if (!previous.has(id)) return previous;
      const next = new Map(previous);
      next.delete(id);
      return next;
    });
  }

  function set(record: McpServerRecord, enabled: boolean) {
    if (!enabled) { clear(record.id); return; }
    const server = store.connection(record);
    if (!server || requests.current.has(record.id)) return;
    const controller = new AbortController();
    requests.current.set(record.id, controller);
    function update(entry: Selection) { setSelected(previous => new Map(previous).set(record.id, entry)); }
    update({ record, state: 'loading' });
    void discoverMcpTools(server, controller.signal).then(
      tools => { if (!controller.signal.aborted) update({ record, state: 'ready', tools }); },
      () => { if (!controller.signal.aborted) update({ record, state: 'error' }); },
    ).finally(() => {
      if (requests.current.get(record.id) === controller) requests.current.delete(record.id);
    });
  }

  return { entries: current, loading: current.some(entry => entry.state === 'loading'),
    tools: current.flatMap(entry => entry.tools ?? []).filter((tool, index, tools) => tools.findIndex(other => other.name === tool.name) === index), set };
}

export type McpSelection = ReturnType<typeof useMcpSelection>;
