import { useState } from 'react';
import { providerLogo } from './AssistantSpeaker';

export function CatalogMark({ provider, name, icons = [] }: { provider: string; name: string; icons?: readonly string[] }) {
  const [failed, setFailed] = useState<ReadonlySet<string>>(() => new Set());
  const src = [...icons, providerLogo(provider)].find((url) => url && !failed.has(url));
  return <span className="catalog-mark" aria-hidden="true">{src
    ? <img key={src} loading="lazy" alt="" src={src} referrerPolicy="no-referrer" onError={() => setFailed((old) => new Set(old).add(src))} />
    : name.slice(0, 2).toUpperCase()}
  </span>;
}
