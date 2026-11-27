import { asRecord } from './directMetrics.ts';
import { validSkillProvider } from './skills.ts';
import type { NativeChatEndpoint } from './index.ts';

export type HostedSkillReference = { type: 'skill_reference'; skill_id: string; version?: string };
export type HostedInlineSkill = { type: 'inline'; name: string; description: string;
  source: { type: 'base64'; media_type: 'application/zip'; data: string } };
export type HostedSkill = HostedSkillReference | HostedInlineSkill;

export function apiChatHostedSkills(skills: readonly HostedSkill[]) {
  return { name: 'skills', inputSchema: { type: 'object', skills: { skills } } };
}

export function withNativeHostedSkills(body: RequestInit['body'], endpoint: NativeChatEndpoint, skills: readonly HostedSkill[], toolChoice: unknown) {
  if (!skills.length || typeof body !== 'string') return body;
  const request = asRecord(JSON.parse(body));
  if (!request) return body;
  const tools = Array.isArray(request.tools) ? request.tools : [];
  return JSON.stringify({ ...request, tools: [...tools, { type: 'skills', name: 'skills', skills }],
    // With only hosted tools, the SDK may omit tool_choice because it had no client functions to serialize.
    ...(toolChoice === 'none' && { tool_choice: endpoint === '/v1/messages' ? { type: 'none' } : 'none' }) });
}

export function hostedSkillProviders(skills: unknown): string[] {
  return Array.isArray(skills) ? [...new Set(skills.flatMap(value => {
    const skill = asRecord(value);
    if (skill?.type !== 'skill_reference' || typeof skill.skill_id !== 'string') return [];
    const [provider, id, extra] = skill.skill_id.split('/');
    return id && extra === undefined && validSkillProvider(provider) ? [provider] : [];
  }))] : [];
}

export function apiChatHostedSkillProviders(tools: unknown) {
  if (!Array.isArray(tools)) return [];
  const tool = tools.map(asRecord).find(value => value?.name === 'skills' && asRecord(value.inputSchema)?.type === 'object');
  return hostedSkillProviders(asRecord(asRecord(tool?.inputSchema)?.skills)?.skills);
}
