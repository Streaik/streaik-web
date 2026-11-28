import { isSpeechCatalogModel, isRealtimeOnlySpeechModel } from '@streaik/gateway';
import type { CatalogModel, LiveTranscriptionOptions, SpeechOptions } from '@streaik/gateway';
import { agentModels, isModel, isObject } from './agentDefinition.ts';
import type { AgentDefinition, AgentModel } from './agentDefinition.ts';
import { canTranscribeLive } from './composerDictation.ts';

const object = (value: unknown) => isObject(value) ? value : {};
const text = (value: unknown) => typeof value === 'string' ? value.trim() || undefined : undefined;
const strings = (value: unknown) => Array.isArray(value) ? value.flatMap(item => text(item) ?? []) : undefined;

export function transcriptionVoiceOptions(model: AgentModel): LiveTranscriptionOptions {
  const metadata = object(model.providerMetadata);
  const provider = model.id.split('/', 1)[0];
  const config = object(metadata[provider]);
  const input = object(object(object(config.session).audio).input);
  const transcription = object(input.transcription);
  const language = text(transcription.language) ?? strings(transcription.languages)?.[0] ?? text(config.language);
  if (provider !== 'google') return { language };
  const google = object(object(config.bidiGenerateContentSetup).inputAudioTranscription ??
    object(object(config.liveConnectConstraints).config).inputAudioTranscription);
  return { language, google: { languageCodes: strings(google.languageCodes) ?? (language ? [language] : undefined),
    customVocabulary: strings(google.customVocabulary), mode: google.mode === 'SMART' ? 'SMART' : undefined } };
}

export function chatVoiceTranscription(catalog: readonly CatalogModel[], capture: Parameters<typeof canTranscribeLive>[1],
  agent: AgentDefinition | undefined, fallback?: AgentDefinition) {
  const primary = agent?.transcription;
  const configured = [...(isModel(primary) ? [primary] : []), ...agentModels(fallback)];
  return configured.find(model => (model.type == null || model.type === 'transcription') &&
    catalog.some(item => item.id === model.id && canTranscribeLive(item, capture)));
}

export type ChatVoiceSpeech = { model: CatalogModel; options: SpeechOptions; rate?: number };

export function chatVoiceSpeech(catalog: readonly CatalogModel[], agent: AgentDefinition | undefined, fallback?: AgentDefinition): ChatVoiceSpeech | undefined {
  const speech = object(agent?.speech);
  const configured = speech.model;
  const find = ({ id, type }: AgentModel) => {
    if (type != null && type !== 'speech' && !(type === 'audio' && isRealtimeOnlySpeechModel(id))) return;
    return catalog.find(item => item.id === id && isSpeechCatalogModel(item));
  };
  const model = isModel(configured) ? find(configured) : undefined;
  if (model) {
    const format = object(speech.outputFormat);
    const speed = typeof speech.speed === 'number' && Number.isFinite(speech.speed) && speech.speed > 0 ? speech.speed : undefined;
    const rate = typeof format.rate === 'number' && Number.isInteger(format.rate) && format.rate >= 8000 && format.rate <= 192000 ? format.rate : undefined;
    return { model, rate, options: { voice: text(speech.voice), instructions: text(speech.instructions), language: text(speech.language),
      outputFormat: text(format.type), speed } };
  }
  if (isModel(configured) && isRealtimeOnlySpeechModel(configured.id)) return;
  for (const entry of agentModels(fallback)) {
    const available = find(entry);
    if (available) return { model: available, options: {} };
  }
}
