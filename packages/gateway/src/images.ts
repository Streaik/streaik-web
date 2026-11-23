import { GatewayError } from './index.ts';

export const gatewayImageEndpoints = ['/api/images', '/v1/images/generations', '/v1/images/edits'] as const;
export type GatewayImageEndpoint = typeof gatewayImageEndpoints[number];
export type ImageInput = { file: File; mediaType: string } | { url: string };
export type ImageFileInput = Extract<ImageInput, { file: File }>;
export type ImageProviderOptions = {
  quality?: string; background?: string; moderation?: string; output_format?: string; output_compression?: number;
  complexity?: string; frame_count?: number; frame_duration_ms?: number; input_fidelity?: string; style?: string;
  svg?: { model?: string; reasoning?: { effort: string } };
};
export type ImageOptions = { n?: number; size?: string; aspectRatio?: string; seed?: number; providerOptions?: ImageProviderOptions };
export type ImageRequest = ImageOptions & { model: string; prompt: string; inputs: readonly ImageInput[]; mask?: ImageFileInput; markup?: ImageFileInput };

export const maxImageCount = 20;

export function imageBatchSizes(model: string, n: number, maxPerCall: number) {
  if (![n, maxPerCall].every(value => Number.isInteger(value) && value >= 1 && value <= maxImageCount)) {
    throw new GatewayError('Use an image count between 1 and 20.');
  }
  const limit = /^google\/imagen-/.test(model) ? 4 : /^openai\/(?!dall-e-3$)/.test(model) ? 10 : 1;
  const perCall = Math.min(maxPerCall, limit);
  const batches: number[] = [];
  for (let remaining = n; remaining > 0; remaining -= perCall) batches.push(Math.min(perCall, remaining));
  return batches;
}

// AIHappey's Vercel image response, not a chat UIMessage.
export type ImageResponse = {
  images: string[];
  warnings: unknown[];
  response: { modelId: string; timestamp: string; headers?: Record<string, string> };
  providerMetadata?: Record<string, unknown>;
  usage?: { inputTokens?: number; outputTokens?: number; totalTokens?: number };
};

export function isImageEndpoint(value: unknown): value is GatewayImageEndpoint {
  return gatewayImageEndpoints.some(endpoint => endpoint === value);
}

function imageLink(value: string) {
  let url: URL | undefined;
  try { url = new URL(value); } catch { /* Report the same error as invalid schemes. */ }
  if (!url || !['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw new GatewayError('Enter an HTTP or HTTPS URL without credentials.');
  }
  return url.href;
}

const base64 = /^[A-Za-z0-9+/]+={0,2}$/;
const dataImage = /^data:(image\/[\w.+-]+);base64,/i;

export function imageSource(image: string) {
  if (dataImage.test(image)) return image;
  const mediaType = image.startsWith('/9j/') ? 'jpeg' : image.startsWith('UklGR') ? 'webp' : image.startsWith('R0lGOD') ? 'gif'
    : image.startsWith('Qk') ? 'bmp' : /ftypavif/.test(decodeImagePrefix(image)) ? 'avif'
      : /^(?:\s|\uFEFF)*(?:<\?xml\b[^>]*>\s*)?<svg\b/i.test(decodeImagePrefix(image)) ? 'svg+xml' : 'png';
  return `data:image/${mediaType};base64,${image}`;
}

function decodeImagePrefix(image: string) {
  try { return atob(image.slice(0, 256)); } catch { return ''; }
}

async function imageFile(input: ImageFileInput) {
  // Avoid spreading an entire multi-megabyte file into a function call.
  const bytes = new Uint8Array(await input.file.arrayBuffer());
  const chunks: string[] = [];
  // Multiples of three let the encoded chunks concatenate without internal padding.
  for (let offset = 0; offset < bytes.length; offset += 0x6000) {
    chunks.push(btoa(String.fromCharCode(...bytes.subarray(offset, offset + 0x6000))));
  }
  return { type: 'file', mediaType: input.mediaType, data: chunks.join('') };
}

async function imageReference(input: ImageInput) {
  if ('url' in input) return { image_url: imageLink(input.url) };
  const { data, mediaType } = await imageFile(input);
  return { image_url: `data:${mediaType};base64,${data}` };
}

export async function imageRequestBody(endpoint: GatewayImageEndpoint, request: ImageRequest): Promise<RequestInit> {
  const { model, inputs, mask, markup, size, aspectRatio, seed, n = 1 } = request;
  const prompt = request.prompt.trim();
  if (!prompt) throw new GatewayError('Enter an image prompt.');
  if (endpoint === '/v1/images/generations' && inputs.length) throw new GatewayError('Remove attachments or choose an image edit route.');
  if (endpoint === '/v1/images/edits' && !inputs.length) throw new GatewayError('Add a reference image to edit.');
  if (mask && !inputs.length) throw new GatewayError('A mask requires a reference image.');
  if (!Number.isInteger(n) || n < 1 || n > maxImageCount) throw new GatewayError('Use an image count between 1 and 20.');
  if (size && !/^(?:auto|[1-9]\d{0,4}x[1-9]\d{0,4})$/.test(size) || aspectRatio && !/^[1-9]\d{0,3}:[1-9]\d{0,3}$/.test(aspectRatio) ||
    seed !== undefined && (!Number.isInteger(seed) || seed < -2147483648 || seed > 2147483647)) throw new GatewayError('Check the image size, aspect ratio, or seed.');
  if ([...inputs, ...(mask ? [mask] : []), ...(markup ? [markup] : [])].some(input => 'file' in input && (!/^image\/[\w.+-]+$/.test(input.mediaType) || !input.file.size))) {
    throw new GatewayError('Choose an image file.');
  }
  const edit = inputs.length > 0;
  const allowed = ['quality', 'background', 'moderation', 'output_format', 'output_compression', 'complexity', 'frame_count', 'frame_duration_ms', 'svg', edit ? 'input_fidelity' : 'style'] as const;
  const providerOptions: Record<string, unknown> = {};
  for (const key of allowed) {
    const value = request.providerOptions?.[key];
    if (value !== undefined) providerOptions[key] = value;
  }
  if (edit && markup) providerOptions.markup = await imageReference(markup);
  const options = {
    model, prompt, n, size,
    ...providerOptions,
    aspect_ratio: aspectRatio, seed,
  };
  if (endpoint === '/v1/images/edits' && !markup && inputs.every(input => 'file' in input)) {
    const body = new FormData();
    for (const [key, value] of Object.entries(options))
      if (value !== undefined) body.set(key, typeof value === 'object' ? JSON.stringify(value) : String(value));
    for (const { file, mediaType } of inputs) body.append('image[]', file.type === mediaType ? file : file.slice(0, file.size, mediaType), file.name);
    if (mask) body.set('mask', mask.file.slice(0, mask.file.size, mask.mediaType), mask.file.name);
    return { body, headers: { accept: 'application/json' } };
  }

  let body: object;
  if (endpoint === '/api/images') {
    body = { model, prompt, n, size, aspectRatio, seed,
      ...(edit && { files: await Promise.all(inputs.map(input => 'url' in input ? { type: 'url', url: imageLink(input.url) } : imageFile(input))) }),
      ...(mask && { mask: await imageFile(mask) }),
      ...(Object.keys(providerOptions).length && { providerOptions: { [model.split('/')[0]]: providerOptions } }),
    };
  } else if (endpoint === '/v1/images/edits') {
    body = { ...options, images: await Promise.all(inputs.map(imageReference)), ...(mask && { mask: await imageReference(mask) }) };
  } else {
    // GPT Image models already return base64 and do not support response_format.
    body = { ...options, ...(/^openai\/dall-e-(?:2|3)$/.test(model) && { response_format: 'b64_json' }) };
  }
  return { body: JSON.stringify(body), headers: { 'content-type': 'application/json', accept: 'application/json' } };
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function inlineImage(value: unknown): value is string {
  return typeof value === 'string' && base64.test(value.replace(dataImage, ''));
}

function tokenCount(value: unknown) {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}

export function readImageResponse(endpoint: GatewayImageEndpoint, payload: unknown, model: string): ImageResponse {
  const result = record(payload);
  const invalid = () => new GatewayError('The gateway did not return a valid image response.');
  if (!result) throw invalid();
  if (endpoint === '/api/images') {
    const { images, warnings, response } = result;
    const metadata = record(response);
    if (!Array.isArray(images) || !images.length || !images.every(inlineImage) || !Array.isArray(warnings) ||
      typeof metadata?.modelId !== 'string' || typeof metadata.timestamp !== 'string' || !Number.isFinite(Date.parse(metadata.timestamp))) throw invalid();
    return { ...result, images, warnings, response: metadata as ImageResponse['response'] };
  }

  if (!Array.isArray(result.data) || !result.data.length) throw invalid();
  const outputFormat = typeof result.output_format === 'string' ? result.output_format.toLowerCase() : '';
  const subtype = outputFormat === 'jpg' ? 'jpeg' : outputFormat === 'svg' ? 'svg+xml' : outputFormat;
  const images = result.data.map(item => {
    const image = record(item)?.b64_json;
    if (!inlineImage(image)) throw invalid();
    return !dataImage.test(image) && /^(png|jpeg|webp|gif|avif|svg\+xml)$/.test(subtype) ? `data:image/${subtype};base64,${image}` : image;
  });
  const created = typeof result.created === 'number' && result.created > 0 ? new Date(result.created * 1000) : new Date();
  if (!Number.isFinite(created.getTime())) throw invalid();
  const usage = record(result.usage);
  const cost = result.cost;
  return {
    images, warnings: [], response: { modelId: model, timestamp: created.toISOString(), headers: undefined },
    ...(usage && { usage: { inputTokens: tokenCount(usage.input_tokens), outputTokens: tokenCount(usage.output_tokens), totalTokens: tokenCount(usage.total_tokens) } }),
    ...(typeof cost === 'number' && Number.isFinite(cost) && { providerMetadata: { gateway: { cost } } }),
  };
}
