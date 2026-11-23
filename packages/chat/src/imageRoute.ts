import { gatewayImageEndpoints, isImageEndpoint } from '@streaik/gateway';
import type { GatewayImageEndpoint } from '@streaik/gateway';
import { useState } from 'react';

export type ImageRouteSetting = { selected: GatewayImageEndpoint; onSelect: (value: GatewayImageEndpoint) => void };

export function canEditImage(route: GatewayImageEndpoint, model?: string) {
  return route !== '/v1/images/generations' && model !== 'openai/dall-e-3' && !/^google\/imagen-/.test(model ?? '');
}

export function useImageRoute(scope?: string): ImageRouteSetting {
  const key = scope && `streaik.images.route.v1:${scope}`;
  const load = () => {
    if (key) try {
      const value = localStorage.getItem(key);
      if (isImageEndpoint(value)) return value;
    } catch { /* Keep the default if storage is unavailable. */ }
    return gatewayImageEndpoints[0];
  };
  const [stored, setStored] = useState(() => ({ key, value: load() }));
  const current = stored.key === key ? stored : { key, value: load() };
  if (current !== stored) setStored(current);
  return { selected: current.value, onSelect(value) {
    setStored({ key, value });
    if (key) try { localStorage.setItem(key, value); } catch { /* Keep the session preference. */ }
  } };
}
