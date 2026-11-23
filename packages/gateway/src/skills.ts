export type RemoteSkill = {
  id: string; name: string; description: string; created_at: number | null;
  default_version: string | null; latest_version: string | null;
};
export type RemoteSkillVersion = {
  id: string; skill_id: string; name: string; description: string; version: string; created_at: number | null;
};
export type SkillPage<T> = { data: T[]; first_id: string; last_id: string; has_more: boolean };
export type SkillPageOptions = { after?: string; limit?: number; order?: 'asc' | 'desc' };
export type SkillUploadTargets = { auth: 'provider-key' | 'provider-header'; providers: string[] };

export const maxSkillZipBytes = 16 * 1024 * 1024;
export const validSkillProvider = (id: string) => /^[a-z0-9_-]+$/.test(id);
const validSegment = (s: string) => s.trim().length > 0 && s.length <= 512 && s !== '.' && s !== '..' && !/[\\/\u0000-\u001f\u007f]/.test(s);

export function qualifiedSkill(id: string) {
  const [provider, skill, extra] = id.split('/');
  if (extra !== undefined || !validSkillProvider(provider) || !skill || !validSegment(skill)) throw new Error('Invalid provider skill ID.');
  return { provider, path: `v1/skills/${provider}/${encodeURIComponent(skill)}` };
}

export function skillVersionPath(path: string, version: string) {
  if (!validSegment(version)) throw new Error('Invalid skill version.');
  return `${path}/versions/${encodeURIComponent(version)}`;
}

export function skillListPath(path: string, { after, limit, order }: SkillPageOptions = {}) {
  const query = new URLSearchParams();
  if (after) query.set('after', after);
  if (limit) query.set('limit', String(limit));
  if (order) query.set('order', order);
  return query.size ? `${path}?${query}` : path;
}

export async function readSkillZip(response: Response): Promise<Blob> {
  if (response.headers.get('content-type')?.split(';')[0] !== 'application/zip' || !response.body) {
    throw new Error('The gateway did not return a skill ZIP.');
  }
  const reader = response.body.getReader();
  const chunks: BlobPart[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxSkillZipBytes) { await reader.cancel(); throw new Error('The skill ZIP exceeds 16 MiB.'); }
      chunks.push(new Uint8Array(value));
    }
  } finally { reader.releaseLock(); }
  return new Blob(chunks, { type: 'application/zip' });
}
