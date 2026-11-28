import { GatewayError, supportsRealtimeSpeech } from '@streaik/gateway';
import type { CatalogModel, Gateway } from '@streaik/gateway';
import { speechOptionsForModel } from './speechPreferences';
import type { SpeechPreferences, SpeechRoute } from './speechPreferences';

export function synthesizeSpeech(gateway: Gateway, route: SpeechRoute, model: CatalogModel, text: string,
  settings: SpeechPreferences, signal: AbortSignal, callbacks?: {
    audio?: Parameters<Gateway['generateSpeech']>[3];
    pcm?: Parameters<Gateway['generateRealtimeSpeech']>[2];
  }) {
  const request = { ...speechOptionsForModel(route, model.id, settings), model: model.id, text };
  if (route !== 'websocket') return gateway.generateSpeech(route, request, signal, callbacks?.audio);
  if (!supportsRealtimeSpeech(model)) throw new GatewayError('This speech model does not support Direct WebSocket. Choose a Gateway route or a compatible model.');
  return gateway.generateRealtimeSpeech(request, signal, callbacks?.pcm);
}
