import { isLiveTranscriptionModel, supportsFileTranscription, usesTranscriptionWebSocket } from '@streaik/gateway';
import type { CatalogModel, Gateway } from '@streaik/gateway';

export const composerDictationRoute = '/api/transcriptions/stream';
type DictationTarget = { mode: 'realtime' | 'recorded'; model: string };
// Undefined hides the control (preference off); null shows it disabled (no available target).
export type ComposerDictation = (DictationTarget & { gateway: Gateway }) | null | undefined;

export function canTranscribeLive(model: CatalogModel, capture: { socket: boolean; peer: boolean }) {
  return model.type === 'transcription' && model.tags.includes('realtime') && isLiveTranscriptionModel(model.id) &&
    (usesTranscriptionWebSocket(model.id) ? capture.socket : capture.peer);
}

export function selectDictationTarget(catalog: readonly CatalogModel[], modelIds: readonly string[],
  capture: { socket: boolean; peer: boolean; recorder: boolean }): DictationTarget | undefined {
  const byId = new Map(catalog.filter(({ type }) => type === 'transcription').map(model => [model.id, model]));
  const models = modelIds.flatMap(id => byId.get(id) ?? []);
  const live = models.find(model => canTranscribeLive(model, capture));
  if (live) return { mode: 'realtime', model: live.id };
  const recorded = capture.recorder && models.find(({ id }) => supportsFileTranscription(composerDictationRoute, id));
  if (recorded) return { mode: 'recorded', model: recorded.id };
}

export function appendDictation(prompt: string, transcript: string) {
  const text = transcript.trim();
  return text ? prompt + (prompt && !/\s$/.test(prompt) ? ' ' : '') + text : prompt;
}
