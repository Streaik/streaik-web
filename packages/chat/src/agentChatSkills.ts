import type { RemoteSkill } from '@streaik/gateway';
import type { JsonValue } from './agentDefinition.ts';
import { agentSkillEntries, downloadAgentSkill, inlineAgentSkillZip, isAgentSkillReference, isCentralSkillId, isInlineAgentSkill } from './agentSkills.ts';
import type { CentralSkillGateway, InlineAgentSkill } from './agentSkills.ts';
import type { LocalSkill } from './skillBundles.ts';
import type { SkillArchive } from './skillTools.ts';

const inlineIds = new WeakMap<InlineAgentSkill, string>();

function inlineId(skill: InlineAgentSkill) {
  let id = inlineIds.get(skill);
  // Never replay instructions from a different snapshot, even if its name is the same.
  if (!id) { id = `agent-skill:${crypto.randomUUID()}`; inlineIds.set(skill, id); }
  return id;
}

export function browserChatSkills({ mode, skills, local, catalog, selectedIds, gateway }: {
  mode: 'gateway' | 'direct' | 'agents'; skills?: JsonValue; local: readonly LocalSkill[];
  catalog: readonly RemoteSkill[]; selectedIds: readonly string[]; gateway?: CentralSkillGateway;
}) {
  const archives = new Map<string, SkillArchive>();
  const linkedIds = new Set<string>();
  const remote = new Map(catalog.map(item => [item.id, item]));
  if (mode !== 'agents') for (const skill of agentSkillEntries(skills)) {
    if (isInlineAgentSkill(skill)) {
      const id = inlineId(skill);
      archives.set(id, { id, name: skill.name, description: skill.description, load: () => inlineAgentSkillZip(skill) });
    } else if (gateway && isAgentSkillReference(skill) && isCentralSkillId(skill.skill_id)) {
      const item = remote.get(skill.skill_id);
      const id = `agent-link:${skill.skill_id}:${encodeURIComponent(skill.version ?? '')}`;
      linkedIds.add(skill.skill_id);
      // A versioned link may still be downloadable when the provider no longer lists it.
      archives.set(id, { id, name: item?.name ?? skill.skill_id, description: item?.description ?? '',
        load: signal => downloadAgentSkill(gateway, skill.skill_id, skill.version, item, signal) });
    }
  }
  const preferenceSkills = mode === 'gateway' && gateway ? catalog.filter(item => selectedIds.includes(item.id) && !linkedIds.has(item.id)) : [];
  if (gateway) for (const item of preferenceSkills) {
    archives.set(item.id, { id: item.id, name: item.name, description: item.description, load: signal => gateway.downloadSkill(item.id, undefined, signal) });
  }
  return { local: mode === 'gateway' ? local : [], archives: [...archives.values()], preferenceSkills,
    missingCatalog: !!gateway && (mode === 'gateway' && selectedIds.some(id => !remote.has(id)) || [...linkedIds].some(id => !remote.has(id))) };
}
