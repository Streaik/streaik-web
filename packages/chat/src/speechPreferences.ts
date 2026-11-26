import { gatewaySpeechEndpoints, isSpeechEndpoint, speechFormats } from '@streaik/gateway';
import type { GatewaySpeechEndpoint, SpeechOptions, SpeechProviderConfig, SpeechRequest } from '@streaik/gateway';
import { useState } from 'react';

export type SpeechRouteSetting = { selected: GatewaySpeechEndpoint; onSelect: (value: GatewaySpeechEndpoint) => void };
export type NativeSpeechOptions = Omit<SpeechOptions, 'language'> & Pick<SpeechRequest, 'streamFormat'>;
type Option = string | number | boolean | undefined;
type ProviderPreferences = Record<string, Option>;
export type SpeechPreferences = {
  general: SpeechOptions; native: NativeSpeechOptions;
  providers: Record<string, ProviderPreferences>;
};
export const defaultSpeechPreferences: SpeechPreferences = { general: {}, native: {}, providers: {} };

type ProviderField = { key: string; label: string } & (
  { kind: 'number'; min: number; max: number; step: number } | { kind: 'checkbox' }
);
export const speechProviderFields: Readonly<Record<string, readonly ProviderField[]>> = {
  google: [{ key: 'temperature', label: 'Temperature', kind: 'number', min: 0, max: 2, step: 0.01 }],
  deepgram: [
    { key: 'sample_rate', label: 'Sample rate', kind: 'number', min: 8000, max: 48000, step: 1 },
    { key: 'bit_rate', label: 'Bit rate', kind: 'number', min: 8000, max: 320000, step: 1 },
    { key: 'mip_opt_out', label: 'Opt out of model improvement', kind: 'checkbox' },
  ],
  elevenlabs: [
    { key: 'stability', label: 'Stability', kind: 'number', min: 0, max: 1, step: 0.01 },
    { key: 'similarity_boost', label: 'Similarity boost', kind: 'number', min: 0, max: 1, step: 0.01 },
    { key: 'style', label: 'Style', kind: 'number', min: 0, max: 1, step: 0.01 },
    { key: 'use_speaker_boost', label: 'Speaker boost', kind: 'checkbox' },
  ],
};

function read(key?: string) {
  try { return key ? localStorage.getItem(key) : null; } catch { return null; }
}
function write(key: string | undefined, value: string) {
  if (key) try { localStorage.setItem(key, value); } catch { /* Retain the in-session value. */ }
}

export function useSpeechRoute(scope?: string): SpeechRouteSetting {
  const key = scope && `streaik.speech.route.v1:${scope}`;
  function load() {
    const value = read(key);
    return { key, selected: isSpeechEndpoint(value) ? value : gatewaySpeechEndpoints[0] };
  }
  const [state, setState] = useState(load);
  const current = state.key === key ? state : load();
  if (current !== state) setState(current);
  return { selected: current.selected, onSelect(selected) { setState({ key, selected }); write(key, selected); } };
}

const object = (value: unknown) => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const text = (value: unknown, max: number) => typeof value === 'string' ? value.trim().slice(0, max) || undefined : undefined;
const number = (value: unknown, min: number, max: number) => typeof value === 'number' && value >= min && value <= max ? value : undefined;
function speechOptions(raw: unknown, min: number, max: number): SpeechOptions {
  const { voice, instructions, speed, language, outputFormat } = object(raw);
  return { voice: text(voice, 200), instructions: text(instructions, 4096), language: text(language, 35), speed: number(speed, min, max),
    outputFormat: speechFormats.find(value => value === outputFormat) };
}

export function normalizeSpeechPreferences(raw: unknown): SpeechPreferences {
  const { general, native, providers } = object(raw);
  const { streamFormat } = object(native);
  const nativeSettings = speechOptions(native, 0.25, 4);
  delete nativeSettings.language;
  return {
    general: speechOptions(general, 0.5, 2),
    native: { ...nativeSettings, streamFormat: streamFormat === 'audio' || streamFormat === 'sse' ? streamFormat : undefined },
    providers: Object.fromEntries(Object.entries(speechProviderFields).map(([provider, fields]) => {
      const values = object(object(providers)[provider]);
      const valid = fields.flatMap(({ key, ...field }): [string, Option][] => {
        const value = values[key];
        const normalized = field.kind === 'checkbox' ? typeof value === 'boolean' ? value : undefined : number(value, field.min, field.max);
        return normalized === undefined ? [] : [[key, normalized]];
      });
      return [provider, Object.fromEntries(valid)];
    })),
  };
}

const settingsKey = (scope?: string) => scope && `streaik.speech.settings.v1:${scope}`;
export function readSpeechPreferences(scope?: string) {
  try { return normalizeSpeechPreferences(JSON.parse(read(settingsKey(scope)) ?? '{}')); }
  catch { return defaultSpeechPreferences; }
}
export function writeSpeechPreferences(scope: string | undefined, value: SpeechPreferences) {
  write(settingsKey(scope), JSON.stringify(value));
}

export function speechOptionsForModel(route: GatewaySpeechEndpoint, model: string, settings: SpeechPreferences): Omit<SpeechRequest, 'model' | 'text'> {
  const provider = model.split('/', 1)[0];
  const native = route === '/v1/audio/speech';
  const options: NativeSpeechOptions & { language?: string } = native ? { ...settings.native } : { ...settings.general };
  if (provider === 'openai' && !native) {
    const { voice, speed, instructions, outputFormat } = settings.native;
    options.voice = voice ?? options.voice;
    options.speed = speed ?? options.speed;
    options.instructions = instructions ?? options.instructions;
    options.outputFormat = outputFormat ?? options.outputFormat;
  }
  if (provider === 'openai') options.voice ??= 'alloy';
  // Gemini returns raw PCM by default; request a playable container when no format was chosen.
  if (provider === 'google') options.outputFormat ??= 'wav';

  const preferences = Object.hasOwn(speechProviderFields, provider) ? settings.providers[provider] : undefined;
  if (!preferences || !Object.keys(preferences).length) return options;
  const config: SpeechProviderConfig = provider === 'google' ? { generation_config: preferences }
    : provider === 'elevenlabs' ? { voice_settings: preferences } : preferences;
  return { ...options, providerOptions: { [provider]: config } };
}
