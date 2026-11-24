import type { ChatMessage, RemoteSkill } from '@streaik/gateway';
import { skillSystemBlock } from './skillTools.ts';
import type { LocalSkill } from './skillBundles';
import type { mcpResourceCatalog } from './mcpChatContext';

export type RequestContext = {
  system?: { systemInformation: { appName: string; timezone: string } };
  user?: { preferredLanguage: string; darkMode: boolean };
  skills?: ReturnType<typeof skillSystemBlock>;
  mcp?: ReturnType<typeof mcpResourceCatalog>;
};

export function buildRequestContext(appName: string, preferredLanguage: string, darkMode: boolean,
  skills: readonly LocalSkill[] = [], remoteSkills: readonly RemoteSkill[] = []): RequestContext {
  const catalog = skillSystemBlock(skills, remoteSkills);
  return { system: { systemInformation: { appName, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone } },
    user: { preferredLanguage, darkMode }, ...(catalog && { skills: catalog }) };
}

export function requestContextText(context: RequestContext) {
  return [...(context.skills ? [JSON.stringify(context.skills)] : []), ...(context.mcp ? [JSON.stringify(context.mcp)] : []),
    ...(context.system ? [JSON.stringify(context.system)] : []), ...(context.user ? [JSON.stringify(context.user)] : [])];
}

export function withRequestContext(messages: ChatMessage[], context: RequestContext | undefined): ChatMessage[] {
  if (!context) return messages;
  return [{ id: 'streaik-request-context', role: 'system', parts: requestContextText(context).map(text => ({ type: 'text', text })) }, ...messages];
}
