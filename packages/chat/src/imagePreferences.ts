import { maxImageCount } from '@streaik/gateway';
import type { ChatModel, GatewayImageEndpoint, ImageFileInput, ImageJsonObject, ImageOptions, ImageProviderOptions } from '@streaik/gateway';

export type ImagePreferences = ImageOptions & {
  maxImagesPerCall?: number;
  byProvider: ImageProviderOptions;
  dallE3Quality?: string;
  mask?: ImageFileInput;
  markup?: ImageFileInput;
};
export const defaultImagePreferences: ImagePreferences = { n: 1, byProvider: {} };

export function readImagePreferences(scope?: string): ImagePreferences {
  if (scope) try {
    const saved = JSON.parse(localStorage.getItem(`streaik.images.settings.v1:${scope}`) ?? 'null');
    if (saved && Number.isInteger(saved.n) && saved.n >= 1 && saved.n <= maxImageCount && saved.byProvider && typeof saved.byProvider === 'object') {
      const { n, maxImagesPerCall, size, aspectRatio, seed, byProvider, dallE3Quality } = saved as ImagePreferences;
      const quality = byProvider.openai?.quality;
      // Older preferences used one quality field for both GPT Image and DALL-E 3.
      if (quality === 'standard' || quality === 'hd') {
        return { n, maxImagesPerCall, size, aspectRatio, seed, dallE3Quality: dallE3Quality ?? quality,
          byProvider: { ...byProvider, openai: { ...byProvider.openai, quality: undefined } } };
      }
      return { n, maxImagesPerCall, size, aspectRatio, seed, byProvider, dallE3Quality };
    }
  } catch { /* Fall back to defaults. */ }
  return defaultImagePreferences;
}

export function writeImagePreferences(scope: string | undefined, { mask, markup, ...options }: ImagePreferences) {
  if (scope) try { localStorage.setItem(`streaik.images.settings.v1:${scope}`, JSON.stringify(options)); } catch { /* Keep session settings. */ }
}

export const isDallE = (model: string) => /^openai\/dall-e-[23]$/.test(model);
export const supportsImageAspectRatio = (provider: string) => provider !== 'openai';
export const supportsImageSeed = (provider: string) => provider !== 'openai' && provider !== 'google';

export function imageOptionsForModel(route: GatewayImageEndpoint, model: ChatModel, settings: ImagePreferences, edit: boolean) {
  const { id, provider } = model;
  const saved = settings.byProvider[provider] ?? {};
  const { style, input_fidelity, output_compression, ...rest } = saved;
  let fields: ImageJsonObject = { ...saved };
  if (provider === 'openai' && isDallE(id)) {
    const { quality, background, moderation, output_format, complexity, frame_count, frame_duration_ms, svg, ...extensions } = rest;
    fields = id === 'openai/dall-e-3' ? { ...extensions, quality: settings.dallE3Quality, style } : extensions;
  } else if (provider === 'openai' || provider === 'imagerouter' || provider === 'openrouter') {
    fields = { ...rest, input_fidelity: edit ? input_fidelity : undefined,
      output_compression: saved.output_format === 'jpeg' || saved.output_format === 'webp' ? output_compression : undefined };
  }
  return {
    size: settings.size,
    aspectRatio: supportsImageAspectRatio(provider) ? settings.aspectRatio : undefined,
    seed: supportsImageSeed(provider) ? settings.seed : undefined,
    markup: edit && provider === 'openai' && !isDallE(id) ? settings.markup : undefined,
    ...(Object.values(fields).some(field => field !== undefined) && (route === '/api/images'
      ? { providerOptions: { [provider]: fields } } : { body: fields })),
  };
}
