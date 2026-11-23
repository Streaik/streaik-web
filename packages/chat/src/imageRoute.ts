import { gatewayImageEndpoints, isImageEndpoint } from '@streaik/gateway';
import type { ChatModel, GatewayImageEndpoint } from '@streaik/gateway';
import { useState } from 'react';

export type ImageRouteSetting = { selected: GatewayImageEndpoint; onSelect: (value: GatewayImageEndpoint) => void };

export function canEditImage(route: GatewayImageEndpoint, model?: string) {
  return route !== '/v1/images/generations' && model !== 'openai/dall-e-3' && !/^google\/imagen-/.test(model ?? '');
}

export function canMaskImage(route: GatewayImageEndpoint, { id, provider }: ChatModel) {
  return canEditImage(route, id) && provider !== 'google';
}

export function imageMaskIssue(route: GatewayImageEndpoint, models: readonly ChatModel[], references: number) {
  if (route === '/v1/images/generations') return 'Remove the mask or choose an image edit route.';
  if (models.length && !models.some(model => canMaskImage(route, model))) return 'None of the selected models support image masks.';
  if (!references) return 'A mask requires a reference image.';
  return '';
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
