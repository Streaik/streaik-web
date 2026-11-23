import { localPlugins } from './localPlugins.ts';
import type { LocalPluginId } from './localPlugins.ts';

export type ChatPreferences = { delay: number; plugins: LocalPluginId[]; remoteSkillIds: string[]; convertAttachmentsToText: boolean };
export const defaultChatPreferences: ChatPreferences = { delay: 40, plugins: [], remoteSkillIds: [], convertAttachmentsToText: false };

export function normalizeChatPreferences(value: Partial<ChatPreferences> | null | undefined): ChatPreferences {
  const delay = value?.delay;
  const plugins = value?.plugins;
  return {
    delay: typeof delay === 'number' && Number.isFinite(delay) ? Math.round(Math.max(0, Math.min(1000, delay)) / 10) * 10 : 40,
    plugins: localPlugins.filter(({ id }) => Array.isArray(plugins) && plugins.includes(id)).map(({ id }) => id),
    remoteSkillIds: Array.isArray(value?.remoteSkillIds) ? [...new Set(value.remoteSkillIds.filter(id => typeof id === 'string' && id.trim()))] : [],
    convertAttachmentsToText: value?.convertAttachmentsToText === true,
  };
}

const preferencesKey = (scope: string) => `streaik-chat-preferences:${scope}`;

export function loadChatPreferences(scope?: string): ChatPreferences {
  if (scope) {
    try { return normalizeChatPreferences(JSON.parse(localStorage.getItem(preferencesKey(scope)) ?? 'null')); }
    catch { /* Preferences still work for this session when storage is unavailable. */ }
  }
  return defaultChatPreferences;
}

export function saveChatPreferences(scope: string | undefined, preferences: ChatPreferences) {
  if (!scope) return;
  try { localStorage.setItem(preferencesKey(scope), JSON.stringify(preferences)); }
  catch { /* Preferences still work for this session when storage is unavailable. */ }
}
