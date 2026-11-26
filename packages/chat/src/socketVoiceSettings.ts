import type { SocketVoiceProvider } from '@streaik/gateway';
import type { VoiceHistoryItem } from './realtimeSettings';

export const googleVoices = ['Achernar', 'Aoede', 'Charon', 'Fenrir', 'Kore', 'Leda', 'Orus', 'Puck', 'Zephyr'] as const;
export const xaiVoices = ['eve', 'ara', 'rex', 'sal', 'leo'] as const;
export const xaiPcmRates = [8000, 16000, 22050, 24000, 32000, 44100, 48000] as const;
export type VoiceFormat = { type: 'audio/pcm'; rate: number } | { type: 'audio/pcma' | 'audio/pcmu' };
export type GoogleVoiceSettings = {
  uses?: number; expireTime?: string; newSessionExpireTime?: string;
  bidiGenerateContentSetup?: {
    generationConfig?: { speechConfig?: { voiceConfig: { prebuiltVoiceConfig: { voiceName: typeof googleVoices[number] } } } };
    inputAudioTranscription?: Record<string, never>; outputAudioTranscription?: Record<string, never>;
    realtimeInputConfig?: { automaticActivityDetection?: { disabled?: boolean; prefixPaddingMs?: number; silenceDurationMs?: number } };
    contextWindowCompression?: { triggerTokens?: number; slidingWindow: { targetTokens?: number } };
    tools?: { googleSearch: Record<string, never> }[];
  };
};
export type XaiVoiceSettings = {
  expires_after?: { anchor: 'created_at'; seconds: number };
  session?: {
    voice?: typeof xaiVoices[number]; instructions?: string;
    turn_detection?: { type: 'server_vad'; threshold?: number; silence_duration_ms?: number; prefix_padding_ms?: number } | null;
    audio?: { input?: { format?: VoiceFormat }; output?: { format?: VoiceFormat } };
  };
};

export const defaultGoogleVoiceSetup: NonNullable<GoogleVoiceSettings['bidiGenerateContentSetup']> = { inputAudioTranscription: {}, outputAudioTranscription: {} };
const pcm24 = { type: 'audio/pcm', rate: 24000 } as const;
const pcm16 = { type: 'audio/pcm', rate: 16000 } as const;
const obj = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const choice = <T>(value: unknown, values: readonly T[]) => values.includes(value as T) ? value as T : undefined;
const number = (value: unknown, min: number, max: number, integer = true) => typeof value === 'number' && Number.isFinite(value) &&
  value >= min && value <= max && (!integer || Number.isInteger(value)) ? value : undefined;
const optionalDate = (value: unknown) => typeof value === 'string' && value.trim() ? value.trim().slice(0, 64) : undefined;

export function normalizeGoogleVoice(value: unknown): GoogleVoiceSettings {
  const v = obj(value), setup = obj(v.bidiGenerateContentSetup);
  const voiceName = choice(obj(obj(obj(obj(setup.generationConfig).speechConfig).voiceConfig).prebuiltVoiceConfig).voiceName, googleVoices);
  const vad = obj(obj(setup.realtimeInputConfig).automaticActivityDetection), compression = obj(setup.contextWindowCompression);
  return {
    uses: number(v.uses, 1, 100), expireTime: optionalDate(v.expireTime), newSessionExpireTime: optionalDate(v.newSessionExpireTime),
    ...(v.bidiGenerateContentSetup != null && { bidiGenerateContentSetup: {
      generationConfig: voiceName ? { speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName } } } } : undefined,
      ...(setup.inputAudioTranscription != null && { inputAudioTranscription: {} }),
      ...(setup.outputAudioTranscription != null && { outputAudioTranscription: {} }),
      realtimeInputConfig: Object.keys(vad).length ? { automaticActivityDetection: { disabled: vad.disabled === true ? true : undefined,
        prefixPaddingMs: number(vad.prefixPaddingMs, 0, 10000), silenceDurationMs: number(vad.silenceDurationMs, 0, 10000) } } : undefined,
      contextWindowCompression: setup.contextWindowCompression != null ? { triggerTokens: number(compression.triggerTokens, 1, 2_000_000),
        slidingWindow: { targetTokens: number(obj(compression.slidingWindow).targetTokens, 1, 2_000_000) } } : undefined,
      tools: Array.isArray(setup.tools) && setup.tools.some(tool => obj(tool).googleSearch != null) ? [{ googleSearch: {} }] : undefined,
    } }),
  };
}

function format(value: unknown): VoiceFormat | undefined {
  const f = obj(value);
  if (f.type === 'audio/pcm') return { type: f.type, rate: choice(f.rate, xaiPcmRates) ?? 24000 };
  if (f.type === 'audio/pcma' || f.type === 'audio/pcmu') return { type: f.type };
}

export function normalizeXaiVoice(value: unknown): XaiVoiceSettings {
  const v = obj(value), s = obj(v.session), a = obj(s.audio), t = obj(s.turn_detection);
  const ttl = number(obj(v.expires_after).seconds, 1, 7200);
  return { expires_after: ttl ? { anchor: 'created_at', seconds: ttl } : undefined, session: {
    voice: choice(s.voice, xaiVoices), instructions: typeof s.instructions === 'string' && s.instructions.trim() ? s.instructions.slice(0, 16000) : undefined,
    turn_detection: s.turn_detection === null ? null : t.type === 'server_vad' ? { type: 'server_vad', threshold: number(t.threshold, 0, 1, false),
      silence_duration_ms: number(t.silence_duration_ms, 0, 10000), prefix_padding_ms: number(t.prefix_padding_ms, 0, 10000) } : undefined,
    audio: { input: { format: format(obj(a.input).format) }, output: { format: format(obj(a.output).format) } },
  } };
}

type FunctionTool = { type: string; name: string; description?: string; parameters: object };
export type SocketVoiceSetup = { provider: SocketVoiceProvider; tokenOptions: object; session: object; input: VoiceFormat;
  output: VoiceFormat; manual: boolean; history: readonly VoiceHistoryItem[]; toolNames: ReadonlySet<string> };

export function socketVoiceSetup(provider: SocketVoiceProvider, model: string, settings: { google?: GoogleVoiceSettings; xai?: XaiVoiceSettings } | undefined,
  history: readonly VoiceHistoryItem[], instructions: string | undefined, tools: readonly FunctionTool[], allowBuiltIns: boolean): SocketVoiceSetup {
  const common = { provider, history, toolNames: new Set(tools.map(tool => tool.name)) };
  if (provider === 'google') {
    const config = normalizeGoogleVoice(settings?.google);
    const setup = config.bidiGenerateContentSetup ?? defaultGoogleVoiceSetup;
    const nativeTools = [...(allowBuiltIns ? setup.tools ?? [] : []), ...(tools.length ? [{ functionDeclarations:
      tools.map(({ name, description, parameters }) => ({ name, description, parametersJsonSchema: parameters })) }] : [])];
    const session = { ...setup, model: `models/${model.slice('google/'.length)}`,
      generationConfig: { ...setup.generationConfig, responseModalities: ['AUDIO'] },
      systemInstruction: instructions ? { parts: [{ text: instructions }] } : undefined, tools: nativeTools.length ? nativeTools : undefined };
    // The constrained connection receives the same native setup that was locked into the token.
    return { ...common, tokenOptions: { ...config, bidiGenerateContentSetup: session }, session, input: pcm16, output: pcm24,
      manual: setup.realtimeInputConfig?.automaticActivityDetection?.disabled === true };
  }
  const config = normalizeXaiVoice(settings?.xai), s = config.session;
  const input = s?.audio?.input?.format ?? pcm24, output = s?.audio?.output?.format ?? pcm24;
  return { ...common, tokenOptions: { expires_after: config.expires_after }, input, output, manual: s?.turn_detection === null,
    session: { voice: s?.voice, instructions: [instructions, s?.instructions].filter(Boolean).join('\n\n') || undefined,
      turn_detection: s?.turn_detection === undefined ? { type: 'server_vad' } : s.turn_detection,
      audio: { input: { format: input }, output: { format: output } }, tools: tools.length ? tools : undefined } };
}
