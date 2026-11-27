import type { ChatReasoning } from '@streaik/gateway';
import { localPlugins } from './localPlugins.ts';
import type { LocalPluginId } from './localPlugins.ts';
import { defaultMcpPreferences, mcpTimeoutRange } from './mcpPreferences.ts';
import type { McpPreferences } from './mcpPreferences.ts';
import { persistentProviderChatSettings } from './providerChat/settings.ts';
import type { ProviderChatSettings } from './providerChat/settings.ts';
import { normalizeToolConfiguration } from './toolConfiguration.ts';
import type { ToolConfiguration } from './toolConfiguration.ts';
import { normalizeToolPolicy } from './chatToolPolicy.ts';
import type { ChatToolPolicy } from './chatToolPolicy.ts';
import { normalizeRealtimeSettings } from './realtimeSettings.ts';
import type { RealtimeSettings } from './realtimeSettings.ts';
import { defaultTranscriptionSplit, legacyTranscriptionSplit, normalizeTranscriptionSplit } from './transcriptionSplitPreferences.ts';
import type { TranscriptionSplitPreferences } from './transcriptionSplitPreferences.ts';

export const pinnableViews = ['models', 'providers'] as const;
export type PinnableView = (typeof pinnableViews)[number];
export const reasoningLevels = ['none', 'low', 'medium', 'high'] as const satisfies readonly ('none' | ChatReasoning)[];
export type ReasoningLevel = (typeof reasoningLevels)[number];

const toolOutputDefaults = { text: true, links: true, images: false, audio: false, video: false, documents: false };
export type ToolOutputPreferences = typeof toolOutputDefaults;
export type SkillExecution = 'hosted' | 'client';

export type ChatPreferences = {
  delay: number;
  plugins: LocalPluginId[];
  remoteSkillIds: string[];
  skillExecution?: SkillExecution;
  convertAttachmentsToText: boolean;
  pinnedViews: PinnableView[];
  dictate: boolean;
  showContextSize: boolean;
  showMessageTokens: boolean;
  showProviderLogo: boolean;
  showMetrics: boolean;
  showDecisions: boolean;
  toolOutput: ToolOutputPreferences;
  mcp: McpPreferences;
  transcriptionSplit: TranscriptionSplitPreferences;
  providerSettings: ProviderChatSettings;
  realtimeSettings?: RealtimeSettings;
  reasoning: ReasoningLevel;
  toolRequestConfig: ToolConfiguration;
  useToolNamespaces: boolean;
  toolPolicy: ChatToolPolicy;
};
export const toolConfigurationDefaults: Pick<ChatPreferences, 'toolRequestConfig' | 'useToolNamespaces'> = {
  toolRequestConfig: {}, useToolNamespaces: false,
};
export const composerToolDefaults: Pick<ChatPreferences, 'delay' | 'plugins' | 'remoteSkillIds' | 'toolPolicy'> = {
  delay: 40, plugins: [], remoteSkillIds: [], toolPolicy: { stopTools: [] },
};
export const defaultChatPreferences: ChatPreferences = { ...composerToolDefaults, ...toolConfigurationDefaults, convertAttachmentsToText: false, pinnedViews: [],
  dictate: true, showContextSize: true, showMessageTokens: true, showProviderLogo: true, showMetrics: false, showDecisions: false,
  toolOutput: toolOutputDefaults, mcp: defaultMcpPreferences, transcriptionSplit: defaultTranscriptionSplit, providerSettings: {}, reasoning: 'medium' };

type StoredPreferences = Partial<Omit<ChatPreferences, 'toolOutput' | 'mcp' | 'providerSettings'> & {
  toolOutput: Partial<ToolOutputPreferences>; mcp: Partial<McpPreferences>; providerSettings: unknown;
}>;

const booleanPreference = (value: unknown, fallback: boolean) => typeof value === 'boolean' ? value : fallback;

export function normalizeChatPreferences(value: StoredPreferences | null | undefined): ChatPreferences {
  const delay = value?.delay;
  const plugins = value?.plugins;
  const pinned = value?.pinnedViews;
  const timeout = value?.mcp?.toolTimeoutMinutes;
  const toolOutput = { ...toolOutputDefaults };
  for (const key of Object.keys(toolOutput) as (keyof ToolOutputPreferences)[]) {
    toolOutput[key] = booleanPreference(value?.toolOutput?.[key], toolOutputDefaults[key]);
  }
  return {
    delay: typeof delay === 'number' && Number.isFinite(delay) ? Math.round(Math.max(0, Math.min(1000, delay)) / 10) * 10 : composerToolDefaults.delay,
    plugins: localPlugins.filter(({ id }) => Array.isArray(plugins) && plugins.includes(id)).map(({ id }) => id),
    remoteSkillIds: Array.isArray(value?.remoteSkillIds) ? [...new Set(value.remoteSkillIds.filter(id => typeof id === 'string' && id.trim()))] : [],
    ...(value?.skillExecution === 'hosted' || value?.skillExecution === 'client' ? { skillExecution: value.skillExecution } : {}),
    convertAttachmentsToText: value?.convertAttachmentsToText === true,
    pinnedViews: pinnableViews.filter(view => Array.isArray(pinned) && pinned.includes(view)),
    dictate: booleanPreference(value?.dictate, defaultChatPreferences.dictate),
    showContextSize: booleanPreference(value?.showContextSize, defaultChatPreferences.showContextSize),
    showMessageTokens: booleanPreference(value?.showMessageTokens, defaultChatPreferences.showMessageTokens),
    showProviderLogo: booleanPreference(value?.showProviderLogo, defaultChatPreferences.showProviderLogo),
    showMetrics: booleanPreference(value?.showMetrics, defaultChatPreferences.showMetrics),
    showDecisions: booleanPreference(value?.showDecisions, defaultChatPreferences.showDecisions),
    toolOutput,
    transcriptionSplit: normalizeTranscriptionSplit(value?.transcriptionSplit),
    providerSettings: persistentProviderChatSettings(value?.providerSettings),
    ...(value?.realtimeSettings && { realtimeSettings: normalizeRealtimeSettings(value.realtimeSettings) }),
    reasoning: reasoningLevels.find(level => level === value?.reasoning) ?? defaultChatPreferences.reasoning,
    toolRequestConfig: normalizeToolConfiguration(value?.toolRequestConfig),
    useToolNamespaces: value?.useToolNamespaces === true,
    toolPolicy: normalizeToolPolicy(value?.toolPolicy),
    mcp: {
      formElicitation: booleanPreference(value?.mcp?.formElicitation, defaultMcpPreferences.formElicitation),
      toolTimeoutMinutes: typeof timeout === 'number' && Number.isFinite(timeout)
        ? Math.round(Math.max(mcpTimeoutRange.min, Math.min(mcpTimeoutRange.max, timeout))) : defaultMcpPreferences.toolTimeoutMinutes,
      resetTimeoutOnProgress: booleanPreference(value?.mcp?.resetTimeoutOnProgress, defaultMcpPreferences.resetTimeoutOnProgress),
    },
  };
}

const preferencesKey = (scope: string) => `streaik-chat-preferences:${scope}`;

export function loadChatPreferences(scope?: string): ChatPreferences {
  if (scope) {
    try {
      const stored = JSON.parse(localStorage.getItem(preferencesKey(scope)) ?? 'null');
      return normalizeChatPreferences({ ...stored, transcriptionSplit: stored?.transcriptionSplit ?? legacyTranscriptionSplit(scope) });
    }
    catch { /* Preferences still work for this session when storage is unavailable. */ }
  }
  return defaultChatPreferences;
}

export function saveChatPreferences(scope: string | undefined, preferences: ChatPreferences) {
  if (!scope) return;
  try { localStorage.setItem(preferencesKey(scope), JSON.stringify({ ...preferences,
    providerSettings: persistentProviderChatSettings(preferences.providerSettings) })); }
  catch { /* Preferences still work for this session when storage is unavailable. */ }
}
