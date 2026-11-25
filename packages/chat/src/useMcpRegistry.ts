import { useEffect, useMemo, useState } from 'react';
import { fetchMcpCatalog, filterMcpCatalog } from './mcp';
import type { McpCatalogServer, McpOptions } from './mcp';
import type { McpServerRecord } from './mcpConfiguration';

type RegistryPage = Awaited<ReturnType<typeof fetchMcpCatalog>>;
type RegistryState = { url?: string; pages: RegistryPage[]; failed: boolean };

function emptyRegistry(url?: string): RegistryState {
  return { url, pages: [], failed: false };
}

export function useMcpRegistry(options: McpOptions | undefined, opened: boolean, lookingUp?: readonly McpServerRecord[]) {
  const url = options?.registryUrl?.href;
  const [registry, setRegistry] = useState(() => emptyRegistry(url));
  const [requestedPages, setRequestedPages] = useState(1);
  const current = registry.url === url ? registry : emptyRegistry(url);
  if (current !== registry) {
    setRegistry(current);
    setRequestedPages(1);
  }

  const { pages, failed } = current;
  const filter = options?.filterRegistryRemote;
  const byEndpoint = useMemo(() => {
    const matches = new Map<string, McpCatalogServer>();
    for (const page of pages) for (const server of filterMcpCatalog(page.servers, filter)) {
      for (const { endpoint } of server.remotes) if (!matches.has(endpoint)) matches.set(endpoint, server);
    }
    return matches;
  }, [pages, filter]);

  const cursor = pages.at(-1)?.cursor;
  const exhausted = pages.length > 0 && (!cursor || pages.findIndex(page => page.cursor === cursor) < pages.length - 1);
  const needsRegistryPage = opened && requestedPages > pages.length && !exhausted;
  const needsMatch = lookingUp?.some(record => !byEndpoint.has(record.endpoint));
  const fetching = !!url && !failed && !exhausted && (needsRegistryPage || !!needsMatch);

  useEffect(() => {
    if (!fetching || !url) return;
    const controller = new AbortController();
    void fetchMcpCatalog(new URL(url), controller.signal, cursor).then(page => {
      if (!controller.signal.aborted) setRegistry({ url, pages: [...pages, page], failed: false });
    }, () => {
      if (!controller.signal.aborted) setRegistry({ url, pages, failed: true });
    });
    return () => controller.abort();
  }, [url, pages, cursor, fetching]);

  // Background lookup can go further than the pages the user has opened in the Registry tab.
  const visiblePages = Math.min(requestedPages, pages.length);
  const servers = useMemo(() => {
    const items = pages.slice(0, visiblePages).flatMap(page => page.servers);
    return filterMcpCatalog([...new Map(items.map(item => [item.name, item])).values()], filter);
  }, [pages, visiblePages, filter]);

  return {
    servers, byEndpoint,
    loading: needsRegistryPage && fetching,
    error: needsRegistryPage && failed,
    hasMore: visiblePages < pages.length || (pages.length > 0 && !exhausted),
    loadMore() {
      setRequestedPages(visiblePages + 1);
      if (failed && visiblePages === pages.length) setRegistry({ ...current, failed: false });
    },
    refresh() {
      setRegistry(emptyRegistry(url));
      setRequestedPages(1);
    },
  };
}
