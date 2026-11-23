import type { Gateway, RemoteSkill } from '@streaik/gateway';
import type { ToolDefinition } from './localPlugins';
import { defaultSkillVersion, importSkillZip, skillRelativePath } from './skillBundles.ts';
import type { LocalSkill, SkillBundle } from './skillBundles.ts';

export const activateSkill = 'activate_skill';
export const readSkillResource = 'read_skill_resource';

export const skillTools: readonly ToolDefinition[] = [{
  name: activateSkill,
  description: 'Loads the body instructions for an enabled agent skill. Use this when one of the available skills matches the current task. After activation, use read_skill_resource to load referenced bundled files by relative path.',
  inputSchema: { type: 'object', properties: {
    skill_id: { type: 'string', description: 'Exact enabled skill ID string to activate. Use the id/skill_id shown in the system context or returned by search_skills; do not invent IDs.' },
  }, required: ['skill_id'] },
}, {
  name: readSkillResource,
  description: 'Reads a bundled file from an enabled skill by relative path. Use this after activate_skill when the skill instructions reference scripts, references, or assets. Paths are relative to the skill root.',
  inputSchema: { type: 'object', properties: {
    skill_id: { type: 'string', description: 'Exact enabled skill ID string that owns the resource. Reuse the same id/skill_id passed to activate_skill.' },
    path: { type: 'string', description: 'Relative path within the skill directory, for example references/REFERENCE.md or scripts/run.py.' },
  }, required: ['skill_id', 'path'] },
}];

export function skillSystemBlock(skills: readonly LocalSkill[], remote: readonly RemoteSkill[] = []) {
  const items = [
    ...skills.filter(skill => skill.enabled).map(skill => ({ skillId: skill.id, ...defaultSkillVersion(skill).metadata })),
    ...remote.map(({ id, name, description }) => ({ skillId: id, name, description })),
  ];
  if (!items.length) return undefined;
  return { availableSkills: {
    activationTool: activateSkill,
    resourceTool: readSkillResource,
    instructions: 'The following skills provide specialized instructions for specific tasks. When a task matches a skill description, call activate_skill with the exact skill_id shown below to load its instructions. Do not use the skill name as skill_id unless it exactly matches the listed skill_id. After activation, use read_skill_resource with the same skill_id and a relative path when the instructions reference bundled files.',
    skillIdRequired: true,
    activationExamples: items.map(skill => `- skill_id=${skill.skillId}; name=${skill.name}: ${skill.description}`),
    skills: items.map(skill => ({ id: skill.skillId, skill_id: skill.skillId, exact_skill_id_to_activate: skill.skillId,
      name: skill.name, description: skill.description, activation: `Call activate_skill with skill_id "${skill.skillId}".` })),
  } };
}

function escapeXml(value: string) {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
}

const textMime: Record<string, string> = { md: 'text/markdown', txt: 'text/plain', csv: 'text/csv', tsv: 'text/tab-separated-values',
  json: 'application/json', xml: 'application/xml', svg: 'image/svg+xml', yaml: 'application/yaml', yml: 'application/yaml',
  html: 'text/html', css: 'text/css', js: 'text/javascript', ts: 'text/typescript', py: 'text/x-python', sh: 'text/x-shellscript' };
const binaryMime: Record<string, string> = { pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif' };

export type TurnRemoteSkills = {
  skills: readonly RemoteSkill[];
  download: Gateway['downloadSkill'];
  bundles: Map<string, SkillBundle>;
};

async function loadRemoteSkill(remote: TurnRemoteSkills | undefined, id: string, name: string, signal?: AbortSignal) {
  if (!remote || !remote.skills.some(skill => skill.id === id)) return undefined;
  const bundle = remote.bundles.get(id);
  if (bundle) return bundle;
  if (name !== activateSkill) throw new Error(`Call activate_skill with skill_id "${id}" in this turn before reading its resources.`);
  try {
    const zip = await remote.download(id, undefined, signal);
    signal?.throwIfAborted();
    const imported = await importSkillZip(zip);
    signal?.throwIfAborted();
    remote.bundles.set(id, imported);
    return imported;
  } catch {
    signal?.throwIfAborted();
    throw new Error(`Could not download or open remote skill "${id}".`);
  }
}

export async function resolveSkillTool(name: string, input: unknown, skills: readonly LocalSkill[], remote?: TurnRemoteSkills, signal?: AbortSignal) {
  try {
    signal?.throwIfAborted();
    const args = input && typeof input === 'object' ? input as { skill_id?: unknown; path?: unknown } : {};
    if (typeof args.skill_id !== 'string' || !args.skill_id.trim()) throw new Error('Missing skill_id. Pass the exact enabled skill ID.');
    const id = args.skill_id;
    const record = skills.find(skill => skill.enabled && skill.id === id);
    const skill = record ? defaultSkillVersion(record) : await loadRemoteSkill(remote, id, name, signal);
    if (!skill) throw new Error(`Skill "${id.slice(0, 256)}" is not enabled.`);
    const { name: skillName, description } = skill.metadata;
    if (name === activateSkill) {
      const resourcePaths = skill.files.map(({ path }) => path).sort((a, b) => a.localeCompare(b));
      const resourcesXml = resourcePaths.length ? ['<skill_resources>', ...resourcePaths.map(path => `  <file>${escapeXml(path)}</file>`), '</skill_resources>'].join('\n')
        : '<skill_resources />';
      return { isError: false, structuredContent: { skill: { id, skill_id: id, name: skillName, description, resourcePaths, instructions: skill.instructions } },
        content: [{ type: 'text', text: [
          `<skill_content skill_id="${escapeXml(id)}" name="${escapeXml(skillName)}">`, skill.instructions, '',
          'Use read_skill_resource with this skill_id and a relative path from the resource list when you need bundled files referenced by the instructions.',
          resourcesXml, '</skill_content>',
        ].join('\n') }] };
    }
    if (name !== readSkillResource) throw new Error('Unknown skill tool.');
    if (typeof args.path !== 'string' || !args.path.trim()) throw new Error('Missing path. Provide a relative path inside the skill directory.');
    const path = skillRelativePath(args.path);
    const file = skill.files.find(file => file.path === path);
    if (!file) throw new Error(`Resource "${path}" was not found in skill "${skillName}".`);
    if (file.data.size > 128 * 1024) throw new Error('This resource exceeds the chat tool limit (128 KiB). It is available in the skill ZIP.');
    const ext = path.split('.').at(-1)?.toLowerCase() ?? '';
    let mimeType = file.data.type || (Object.hasOwn(textMime, ext) ? textMime[ext] : Object.hasOwn(binaryMime, ext) ? binaryMime[ext] : 'application/octet-stream');
    let text: string | undefined;
    if (mimeType.startsWith('text/') || Object.hasOwn(textMime, ext)) text = await file.data.text();
    else if (mimeType === 'application/octet-stream') {
      try {
        const decoded = new TextDecoder('utf-8', { fatal: true }).decode(await file.data.arrayBuffer());
        if (!decoded.includes('\u0000')) { text = decoded; mimeType = 'text/plain'; }
      } catch { /* Keep binary data as a resource. */ }
    }
    if (text !== undefined) return { isError: false, structuredContent: { skillResource: { skillName, path, mimeType, text } },
      content: [{ type: 'text', text: `<skill_resource skill_id="${escapeXml(id)}" name="${escapeXml(skillName)}" path="${escapeXml(path)}" mimeType="${escapeXml(mimeType)}">\n${text}\n</skill_resource>` }] };
    const bytes = new Uint8Array(await file.data.arrayBuffer());
    const blob = btoa(Array.from(bytes, byte => String.fromCharCode(byte)).join(''));
    return { isError: false, structuredContent: { skillResource: { skillName, path, mimeType, encoding: 'base64' } },
      content: [{ type: 'text', text: `Binary skill resource ${path} from skill ${skillName}. mimeType=${mimeType}.` },
        { type: 'resource', resource: { uri: `skill://${encodeURIComponent(id)}/${path.split('/').map(encodeURIComponent).join('/')}`, mimeType, blob } }] };
  } catch (error) {
    signal?.throwIfAborted();
    return { isError: true, content: [{ type: 'text', text: error instanceof Error ? error.message : 'This skill could not be read.' }] };
  }
}
