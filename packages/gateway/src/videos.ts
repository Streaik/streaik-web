import { GatewayError } from './index.ts';

export type VideoRequest = { model: string; prompt: string };
export type VideoAsset = { type: 'url'; url: string } | { type: 'file'; blob: Blob };
export type VideoStatus = { status: 'pending' } | { status: 'completed'; videos: VideoAsset[] } | { status: 'error'; error: string };

export function videoOperationParts(value: unknown) {
  // The gateway returns a provider prefix and a Data Protection base64url token,
  // not a URL or a provider-local operation name.
  const match = typeof value === 'string' && /^([a-z0-9-]+)\/([\w-]{1,8192})$/.exec(value);
  if (!match || match[0] !== value) throw new GatewayError('The video job has an invalid operation reference.');
  return { provider: match[1], token: match[2] };
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' ? value as Record<string, unknown> : undefined;
}

export function readVideoOperation(payload: unknown, provider: string): string {
  const operation = record(payload)?.operation;
  if (typeof operation !== 'string' || videoOperationParts(operation).provider !== provider) {
    throw new GatewayError('The gateway returned an invalid video job.');
  }
  return operation;
}

function readAsset(value: unknown): VideoAsset | undefined {
  const file = record(value);
  if (!file) return;
  if (file.type === 'url' && typeof file.url === 'string') {
    try {
      const url = new URL(file.url);
      if (['https:', 'http:'].includes(url.protocol) && !url.username && !url.password) return { type: 'url', url: url.href };
    } catch { /* An invalid asset is not playable. */ }
  }
  if ((file.type === 'base64' || file.type === 'binary') && typeof file.mediaType === 'string' && /^video\/[\w.+-]+$/i.test(file.mediaType)) {
    let bytes: Uint8Array<ArrayBuffer>;
    if (typeof file.data === 'string') {
      // System.Text.Json also writes binary byte arrays as base64 strings.
      try {
        const decoded = atob(file.data);
        bytes = new Uint8Array(decoded.length);
        for (let i = 0; i < decoded.length; i++) bytes[i] = decoded.charCodeAt(i);
      } catch { return; }
    } else if (file.type === 'binary' && Array.isArray(file.data) && file.data.every(byte => Number.isInteger(byte) && byte >= 0 && byte <= 255)) {
      bytes = Uint8Array.from(file.data);
    } else return;
    if (bytes.length) return { type: 'file', blob: new Blob([bytes], { type: file.mediaType }) };
  }
}

export function readVideoStatus(payload: unknown): VideoStatus {
  const result = record(payload);
  switch (result?.status) {
    case 'pending': return { status: 'pending' };
    case 'error': return { status: 'error', error: typeof result.error === 'string' && result.error.trim() || 'Video generation failed.' };
    case 'completed': {
      const videos = (Array.isArray(result.videos) ? result.videos : []).map(readAsset).filter(video => video !== undefined);
      return videos.length ? { status: 'completed', videos } : { status: 'error', error: 'The gateway returned no playable video.' };
    }
    default: throw new GatewayError('The gateway returned an invalid video status.');
  }
}
