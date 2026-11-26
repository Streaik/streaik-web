import { agentModels, isAgentDefinition, isModel, isObject } from './agentDefinition.ts';
import type { AgentDefinition, AgentModel, JsonObject, JsonValue } from './agentDefinition.ts';
import { agentMcpServers } from './agentTools.ts';

export type AgentTab = 'general' | 'details' | 'realtime' | 'skills' | 'tools' | 'tool-configuration';
type IconScheme = 'light' | 'dark';
export type IconDraft = { key: number; original?: JsonValue; src: string; theme: string };
const speechTextFields = ['voice', 'instructions', 'language'] as const;
type SpeechDraft = Record<typeof speechTextFields[number] | 'speed' | 'mime' | 'rate', string> & { model?: AgentModel };
export type AgentDraft = {
  name: string; description: string; instructions: string; argumentHint: string; models: readonly AgentModel[];
  owner: string; tags: readonly string[]; icons: readonly IconDraft[];
  transcription?: AgentModel; speech: SpeechDraft;
  tools?: JsonValue; mcpServers?: JsonValue; skills?: JsonValue;
};

export class AgentDraftError extends Error {
  readonly tab: AgentTab;
  constructor(tab: AgentTab, message: string) { super(message); this.tab = tab; }
}

const object = (value?: JsonValue) => isObject(value) ? value as JsonObject : undefined;
const text = (value?: JsonValue) => typeof value === 'string' ? value : '';
const numberText = (value?: JsonValue) => typeof value === 'number' ? String(value) : '';
const readModel = (value?: JsonValue) => isModel(value) ? value : undefined;
const sameList = <T>(a: readonly T[], b: readonly T[]) => a.length === b.length && a.every((value, i) => value === b[i]);

export function readIconDrafts(icons?: JsonValue): IconDraft[] {
  if (!Array.isArray(icons)) return [];
  return (icons as readonly JsonValue[]).map((original, key) => ({
    key, original, src: text(object(original)?.src), theme: text(object(original)?.theme),
  }));
}

// Only render public web image URLs, local static paths, or embedded image data.
export function agentIconUrl(value: string) {
  const src = value.trim();
  if (/^\/(?![\\/])[^\\\s]*$/.test(src) || /^data:image\/[\w.+-]+(?:;[\w=.+-]+)*,/i.test(src)) return src;
  try {
    const url = new URL(src);
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    if (!url.username && !url.password && (url.protocol === 'https:' || (url.protocol === 'http:' && local))) return src;
  } catch { /* Not a supported image URL. */ }
  return undefined;
}

export function agentIconSources(icons: JsonValue | undefined, scheme: IconScheme) {
  const entries = readIconDrafts(icons);
  return [...entries.filter(({ theme }) => theme === scheme), ...entries.filter(({ theme }) => !theme)]
    .flatMap(({ src }) => agentIconUrl(src) ?? []);
}

export function createAgentDraft(agent?: AgentDefinition): AgentDraft {
  const speech = object(agent?.speech);
  const format = object(speech?.outputFormat);
  return {
    name: agent?.name ?? '', description: agent?.description ?? '', instructions: agent?.instructions ?? '',
    argumentHint: text(agent?.argumentHint), models: agentModels(agent), owner: text(agent?.owned_by),
    tags: agent?.tags ?? [], icons: readIconDrafts(agent?.icons), transcription: readModel(agent?.transcription),
    tools: agent?.tools, mcpServers: agent?.mcpServers, skills: agent?.skills,
    speech: { model: readModel(speech?.model), voice: text(speech?.voice), instructions: text(speech?.instructions),
      language: text(speech?.language), speed: numberText(speech?.speed), mime: text(format?.type), rate: numberText(format?.rate) },
  };
}

function assign(target: Record<string, JsonValue>, key: string, value?: JsonValue) {
  if (value === undefined) delete target[key];
  else target[key] = value;
}

function patchSpeech(draft: SpeechDraft, initial: SpeechDraft, source?: JsonValue) {
  const speech = { ...object(source) };
  if (draft.model !== initial.model) assign(speech, 'model', draft.model);
  for (const key of speechTextFields) {
    if (draft[key] !== initial[key]) assign(speech, key, draft[key].trim() ? draft[key] : undefined);
  }
  if (draft.speed !== initial.speed) {
    const speed = draft.speed.trim() ? Number(draft.speed) : undefined;
    if (speed !== undefined && (!Number.isFinite(speed) || speed <= 0)) {
      throw new AgentDraftError('realtime', 'Speech speed must be a positive number.');
    }
    assign(speech, 'speed', speed);
  }
  if (draft.mime !== initial.mime || draft.rate !== initial.rate) {
    const format = { ...object(speech.outputFormat) };
    const mime = draft.mime.trim();
    if (mime && draft.mime !== initial.mime && !/^audio\/[\w.+-]+$/i.test(mime)) {
      throw new AgentDraftError('realtime', 'Enter an audio MIME type, such as audio/mpeg.');
    }
    if (!mime && draft.rate !== initial.rate && draft.rate.trim()) {
      throw new AgentDraftError('realtime', 'Set an audio MIME type before specifying a sample rate.');
    }
    if (draft.mime !== initial.mime) assign(format, 'type', mime || undefined);
    if (mime && draft.rate !== initial.rate) {
      const rate = draft.rate.trim() ? Number(draft.rate) : undefined;
      if (rate !== undefined && (!Number.isSafeInteger(rate) || rate < 1)) {
        throw new AgentDraftError('realtime', 'Sample rate must be a positive whole number.');
      }
      assign(format, 'rate', rate);
    } else if (!mime) delete format.rate;
    assign(speech, 'outputFormat', Object.keys(format).length ? format : undefined);
  }
  return Object.keys(speech).length ? speech : undefined;
}

export function saveAgentDraft(draft: AgentDraft, agent?: AgentDefinition) {
  const initial = createAgentDraft(agent);
  const definition: Record<string, JsonValue> = { ...agent, name: draft.name === initial.name && agent ? agent.name : draft.name.trim(),
    description: draft.description, instructions: draft.instructions };
  if (!draft.name.trim() || !draft.description.trim() || !draft.instructions.trim()) {
    throw new AgentDraftError('general', 'Name, description, and instructions are required.');
  }
  if (draft.argumentHint !== initial.argumentHint) assign(definition, 'argumentHint', draft.argumentHint.trim() || undefined);
  if (draft.skills !== initial.skills) assign(definition, 'skills', draft.skills);
  if (draft.tools !== initial.tools) assign(definition, 'tools', draft.tools);
  if (draft.mcpServers !== initial.mcpServers) {
    const original = object(initial.mcpServers);
    if (agentMcpServers(draft.mcpServers).some(({ key, server, endpoint }) => !endpoint && object(original?.[key])?.url !== server.url)) {
      throw new AgentDraftError('tools', 'Enter a valid MCP URL for each new or changed server.');
    }
    assign(definition, 'mcpServers', draft.mcpServers);
  }
  if (!sameList(draft.models, initial.models)) {
    const primary = draft.models.find((model) => model.type !== 'decision') ?? draft.models[0];
    // Keep the legacy configuration separate: it may have different metadata
    // than the entry with the same ID in the collection.
    if (agent?.models?.length || (Array.isArray(agent?.models) && !agent.model) || draft.models.length > 1) {
      definition.models = draft.models;
      const legacy = agent?.model;
      if (legacy && (!draft.models.length || (initial.models.some(({ id }) => id === legacy.id) && !draft.models.some(({ id }) => id === legacy.id)))) {
        assign(definition, 'model', primary);
      }
    } else {
      assign(definition, 'model', primary);
    }
  }
  if (draft.owner !== initial.owner) assign(definition, 'owned_by', draft.owner.trim() || undefined);
  if (!sameList(draft.tags, initial.tags)) definition.tags = draft.tags;
  const unchangedIcon = (icon: IconDraft) => icon.original !== undefined && icon.src === text(object(icon.original)?.src) &&
    icon.theme === text(object(icon.original)?.theme);
  if (draft.icons.length !== initial.icons.length || draft.icons.some((icon, index) =>
    !unchangedIcon(icon) || icon.original !== initial.icons[index].original)) {
    definition.icons = draft.icons.map((icon) => {
      if (unchangedIcon(icon)) return icon.original!;
      const src = icon.src.trim();
      if (!src || (src !== text(object(icon.original)?.src) && !agentIconUrl(src))) {
        throw new AgentDraftError('details', 'Enter a valid icon URL, such as an HTTPS image URL, or remove the icon.');
      }
      const next: Record<string, JsonValue> = { ...object(icon.original), src };
      if (icon.theme !== text(object(icon.original)?.theme)) assign(next, 'theme', icon.theme || undefined);
      return next;
    });
  }
  if (draft.transcription !== initial.transcription) assign(definition, 'transcription', draft.transcription);
  if (Object.keys(initial.speech).some((key) => draft.speech[key as keyof SpeechDraft] !== initial.speech[key as keyof SpeechDraft])) {
    assign(definition, 'speech', patchSpeech(draft.speech, initial.speech, agent?.speech));
  }
  if (!isAgentDefinition(definition)) throw new AgentDraftError('general', 'Every selected model needs a model ID.');
  return definition;
}
