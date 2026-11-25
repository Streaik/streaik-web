import { useState } from 'react';
import type { ReactNode } from 'react';
import { providerFavicon } from './favicons';

export function CatalogMark({ provider, name, icons = [], fallback }: {
  provider?: string; name: string; icons?: readonly string[]; fallback?: ReactNode;
}) {
  const [failed, setFailed] = useState<ReadonlySet<string>>(() => new Set());
  const src = [...icons, provider && providerFavicon(provider)].find((url) => url && !failed.has(url));
  return <span className="catalog-mark" aria-hidden="true">{src
    ? <img key={src} loading="lazy" alt="" referrerPolicy="no-referrer" src={src} onError={() => setFailed((old) => new Set(old).add(src))} />
    : fallback ?? name.slice(0, 2).toUpperCase()}
  </span>;
}
