import { gatewayTranscriptionEndpoints, isTranscriptionEndpoint } from '@streaik/gateway';
import type { GatewayTranscriptionEndpoint, GoogleLiveTranscriptionConfig, TranscriptionConfig } from '@streaik/gateway';
import { useState } from 'react';
import { transcriptionSettingsKey } from './transcriptionSplitPreferences.ts';

export type TranscriptionRouteSetting = { selected: GatewayTranscriptionEndpoint; onSelect: (route: GatewayTranscriptionEndpoint) => void };
export type TranscriptionProviderPreferences = {
  providerOptions: Record<string, TranscriptionConfig>;
  googleLive: GoogleLiveTranscriptionConfig;
  liveLanguages: Record<string, string | undefined>;
};
export const defaultTranscriptionProviders: TranscriptionProviderPreferences = { providerOptions: {}, googleLive: {}, liveLanguages: {} };
type TranscriptionPreferences = TranscriptionProviderPreferences & { model?: string | null; skipDictateWarning?: boolean; split?: boolean; overlap?: number };

function read(key: string | undefined) {
  try { return key ? localStorage.getItem(key) : null; } catch { return null; }
}

function write(key: string | undefined, value: string) {
  if (key) try { localStorage.setItem(key, value); } catch { /* Retain the in-session value. */ }
}

export function useTranscriptionRoute(scope?: string): TranscriptionRouteSetting {
  const key = scope && `streaik.transcriptions.route.v1:${scope}`;
  const load = () => {
    const value = read(key);
    return isTranscriptionEndpoint(value) ? value : gatewayTranscriptionEndpoints[0];
  };
  const [state, setState] = useState(() => ({ key, selected: load() }));
  const current = state.key === key ? state : { key, selected: load() };
  if (current !== state) setState(current);
  return { selected: current.selected, onSelect(selected) { setState({ key, selected }); write(key, selected); } };
}

export function useTranscriptionPreferences(scope?: string) {
  const key = scope && transcriptionSettingsKey(scope);
  const load = (): TranscriptionPreferences => {
    try {
      const data = JSON.parse(read(key) ?? '{}');
      const model = data.model === null || typeof data.model === 'string' ? data.model : typeof data.fileModel === 'string' ? data.fileModel : undefined;
      const provider = typeof model === 'string' ? model.split('/')[0] : 'openai';
      const language = typeof data.language === 'string' ? data.language.trim().slice(0, 35) : undefined;
      const prompt = typeof data.prompt === 'string' ? data.prompt.slice(0, 1000) : undefined;
      const legacyOptions = {
        openai: { language: provider === 'openai' ? language : undefined, prompt },
        ...(data.diarization === true || provider === 'gladia' && language ? { gladia: { diarization: data.diarization === true || undefined,
          language_config: provider === 'gladia' && language ? { languages: [language] } : undefined } } : {}),
        ...(provider === 'deepgram' && language ? { deepgram: { language } } : {}),
      };
      return { model, providerOptions: data.providerOptions ?? legacyOptions,
        googleLive: data.googleLive ?? (provider === 'google' && language ? { languageCodes: [language] } : {}),
        liveLanguages: data.liveLanguages ?? (provider !== 'google' && language ? { [provider]: language } : {}),
        // Keep the old split values until the user preferences have persisted the migration.
        split: typeof data.split === 'boolean' ? data.split : undefined, overlap: typeof data.overlap === 'number' ? data.overlap : undefined,
        skipDictateWarning: data.skipDictateWarning === true };
    } catch { return defaultTranscriptionProviders; }
  };
  const [state, setState] = useState(() => ({ key, value: load() }));
  const current = state.key === key ? state : { key, value: load() };
  if (current !== state) setState(current);
  return [current.value, (patch: Partial<TranscriptionPreferences>) => {
    const updated = { ...current.value, ...patch };
    setState({ key, value: updated });
    write(key, JSON.stringify(updated));
  }] as const;
}
