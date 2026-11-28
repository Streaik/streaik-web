import { maxImageCount, maxNativeImageCount } from '@streaik/gateway';
import type { ChatModel, GatewayImageEndpoint, ImageFileInput, ImageJsonObject, ImageOptions, ImageProviderOptions } from '@streaik/gateway';

type NativeImagePreferences = Pick<ImageOptions, 'n' | 'size'>;

export type ImagePreferences = ImageOptions & {
  native: NativeImagePreferences;
  maxImagesPerCall?: number;
  byProvider: ImageProviderOptions;
  dallE3Quality?: string;
  mask?: ImageFileInput;
  markup?: ImageFileInput;
};
export const defaultImagePreferences: ImagePreferences = { n: 1, native: { n: 1 }, byProvider: {} };

export function readImagePreferences(scope?: string): ImagePreferences {
  if (scope) try {
    const saved = JSON.parse(localStorage.getItem(`streaik.images.settings.v1:${scope}`) ?? 'null');
    if (saved && Number.isInteger(saved.n) && saved.n >= 1 && saved.n <= maxImageCount && saved.byProvider && typeof saved.byProvider === 'object') {
      const { n, maxImagesPerCall, size, aspectRatio, seed, native, byProvider, dallE3Quality } = saved as ImagePreferences;
      // Older settings shared size and count. Seed the v1 form once, without carrying over Vercel batching.
      const nativeCount = (native ? native.n : n) ?? 1;
      const shared = { n, maxImagesPerCall, size, aspectRatio, seed, native: {
        n: Number.isInteger(nativeCount) && nativeCount >= 1 && nativeCount <= maxNativeImageCount ? nativeCount : 1,
        size: native ? native.size : size,
      } };
      const quality = byProvider.openai?.quality;
      // Older preferences used one quality field for both GPT Image and DALL-E 3.
      if (quality === 'standard' || quality === 'hd') {
        return { ...shared, dallE3Quality: dallE3Quality ?? quality,
          byProvider: { ...byProvider, openai: { ...byProvider.openai, quality: undefined } } };
      }
      return { ...shared, byProvider, dallE3Quality };
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

export function openAIInputFidelities(model: string): string[] {
  if (isDallE(model) || /^openai\/gpt-image-2(?:[.-]|$)/.test(model)) return [];
  if (model === 'openai/gpt-image-1-mini') return ['low'];
  return ['low', 'high'];
}

function openAIFields(model: ChatModel, settings: ImagePreferences, edit: boolean): ImageJsonObject {
  // Don't send identifiers left by older drafts of the settings form now that it has no identifier controls.
  const { style, input_fidelity, safety_identifier, user, ...fields } = settings.byProvider.openai ?? {};
  if (isDallE(model.id)) {
    const { quality, background, moderation, output_format, output_compression, complexity, frame_count, frame_duration_ms, svg, ...extensions } = fields;
    return model.id === 'openai/dall-e-3' && !edit ? { ...extensions, quality: settings.dallE3Quality, style } : extensions;
  }
  const fidelities = openAIInputFidelities(model.id);
  return { ...fields,
    input_fidelity: edit && fidelities.length > 0 && (input_fidelity === null || typeof input_fidelity === 'string' && fidelities.includes(input_fidelity))
      ? input_fidelity : undefined,
  };
}

const compressible = (format: ImageJsonObject[string]) => format === 'jpeg' || format === 'webp';

function outputFields(fields: ImageJsonObject): ImageJsonObject {
  const { output_format, output_compression, frame_count, frame_duration_ms, svg, ...rest } = fields;
  return { ...rest, output_format,
    output_compression: compressible(output_format) ? output_compression : undefined,
    frame_count: output_format === 'gif' ? frame_count : undefined,
    frame_duration_ms: output_format === 'gif' ? frame_duration_ms : undefined,
    svg: output_format === 'svg' && svg && Object.values(svg).some(field => field !== undefined) ? svg : undefined,
  };
}

const definedFields = (fields: ImageJsonObject): ImageJsonObject => Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== undefined));

export function imageOptionsForModel(route: GatewayImageEndpoint, model: ChatModel, settings: ImagePreferences, edit: boolean) {
  const { id, provider } = model;
  let fields = settings.byProvider[provider] ?? {};
  if (provider === 'google') {
    // Older image settings could override Google's default even after the form was removed.
    const { output_format, ...extensions } = fields;
    fields = extensions;
  } else if (provider === 'imagerouter' || provider === 'openrouter') {
    // The router forms only expose this setting for their JPEG and WebP outputs.
    const { output_compression, ...extensions } = fields;
    fields = { ...extensions, output_compression: compressible(fields.output_format) ? output_compression : undefined };
  }

  if (route !== '/api/images') {
    const editing = route === '/v1/images/edits';
    const general = openAIFields(model, settings, editing);
    // Only explicit values from the chosen provider override General. Leave JSON types intact.
    const providerFields = provider === 'openai' ? {} : definedFields(fields);
    const format = providerFields.output_format === undefined ? general.output_format : providerFields.output_format;
    const body = { ...definedFields(outputFields({ ...general, output_format: format })), ...providerFields };
    return { size: settings.native.size, markup: editing && !isDallE(id) ? settings.markup : undefined, body };
  }

  if (provider === 'openai') fields = outputFields(openAIFields(model, settings, edit));
  const options = definedFields(fields);
  return {
    size: settings.size,
    aspectRatio: supportsImageAspectRatio(provider) ? settings.aspectRatio : undefined,
    seed: supportsImageSeed(provider) ? settings.seed : undefined,
    markup: edit && provider === 'openai' && !isDallE(id) ? settings.markup : undefined,
    ...(Object.keys(options).length > 0 && { providerOptions: { [provider]: options } }),
  };
}
