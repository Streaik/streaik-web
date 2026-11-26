import { maxSkillZipBytes } from '@streaik/gateway';
import type { Gateway, RemoteSkill } from '@streaik/gateway';
import { isObject } from './agentDefinition.ts';
import type { JsonObject, JsonValue } from './agentDefinition.ts';
import { exportSkillZip, importSkillZip } from './skillBundles.ts';
import type { SkillBundle } from './skillBundles.ts';

export const latestSkillVersion = 'latest';
export type AgentSkillReference = JsonObject & { type: 'skill_reference'; skill_id: string; version?: string };
export type InlineAgentSkill = JsonObject & { type: 'inline'; name: string; description: string;
  source: { type: 'base64'; media_type: 'application/zip'; data: string } };
export type SkillOrigin = { id: string; version?: string };

export function agentSkillEntries(value?: JsonValue): readonly JsonValue[] {
  return Array.isArray(value) ? value : [];
}

export function isCentralSkillId(id: string) {
  const [provider, skill, extra] = id.split('/');
  return extra === undefined && /^[a-z0-9_-]+$/.test(provider) && !!skill?.trim() && skill.length <= 512 &&
    skill !== '.' && skill !== '..' && !/[\\\u0000-\u001f\u007f]/.test(skill);
}

export function isAgentSkillReference(skill: unknown): skill is AgentSkillReference {
  return isObject(skill) && skill.type === 'skill_reference' && typeof skill.skill_id === 'string' && !!skill.skill_id.trim() &&
    (skill.version === undefined || typeof skill.version === 'string');
}

export function isInlineAgentSkill(skill: unknown): skill is InlineAgentSkill {
  return isObject(skill) && skill.type === 'inline' && typeof skill.name === 'string' && typeof skill.description === 'string' &&
    isObject(skill.source) && skill.source.type === 'base64' && skill.source.media_type === 'application/zip' &&
    typeof skill.source.data === 'string' && !!skill.source.data;
}

export function linkAgentSkill(id: string, version: string | undefined = latestSkillVersion): AgentSkillReference {
  return { type: 'skill_reference', skill_id: id, ...(version && { version }) };
}

// Keep provenance in standard SKILL.md metadata, not in the portable agent JSON schema.
const originKey = 'streaik-agent-skill-id';
const versionKey = 'streaik-agent-skill-version';

export async function embedAgentSkill(bundle: SkillBundle, origin: SkillOrigin): Promise<InlineAgentSkill> {
  const metadata: Record<string, string> = { ...bundle.metadata.metadata, [originKey]: origin.id };
  if (origin.version) metadata[versionKey] = origin.version;
  else delete metadata[versionKey];
  const zip = await exportSkillZip({ ...bundle, metadata: { ...bundle.metadata, metadata } });
  const bytes = new Uint8Array(await zip.arrayBuffer());
  const raw: string[] = [];
  for (let i = 0; i < bytes.length; i += 0x8000) raw.push(String.fromCharCode(...bytes.subarray(i, i + 0x8000)));
  return { type: 'inline', name: bundle.metadata.name, description: bundle.metadata.description,
    source: { type: 'base64', media_type: 'application/zip', data: btoa(raw.join('')) } };
}

export function inlineAgentSkillZip(skill: InlineAgentSkill) {
  if (skill.source.data.length > Math.ceil(maxSkillZipBytes / 3) * 4) throw new Error('The skill ZIP exceeds 16 MiB.');
  const raw = atob(skill.source.data);
  return new Blob([Uint8Array.from(raw, ch => ch.charCodeAt(0))], { type: 'application/zip' });
}

export async function embeddedSkillOrigin(skill: InlineAgentSkill): Promise<SkillOrigin | undefined> {
  try {
    const { metadata } = (await importSkillZip(inlineAgentSkillZip(skill))).metadata;
    const id = metadata?.[originKey];
    if (id && (id.startsWith('local:') || isCentralSkillId(id))) return { id, version: metadata?.[versionKey] };
  } catch { /* Keep unreadable or legacy attachments visible and removable. */ }
  return undefined;
}

export type CentralSkillGateway = Pick<Gateway, 'downloadSkill' | 'listSkillVersions'>;

export async function downloadAgentSkill(gateway: CentralSkillGateway, id: string, version: string | undefined,
  skill?: RemoteSkill, signal?: AbortSignal) {
  let concrete = version || undefined;
  if (concrete === latestSkillVersion) {
    concrete = skill?.latest_version || (await gateway.listSkillVersions(id, { limit: 1, order: 'desc' }, signal)).data[0]?.version;
  }
  signal?.throwIfAborted();
  return gateway.downloadSkill(id, concrete, signal);
}
