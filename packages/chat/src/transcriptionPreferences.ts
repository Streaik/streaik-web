import { gatewayTranscriptionEndpoints, isTranscriptionEndpoint } from '@streaik/gateway';
import type { GatewayTranscriptionEndpoint, TranscriptionOptions } from '@streaik/gateway';
import { useState } from 'react';

export type TranscriptionRouteSetting = { selected: GatewayTranscriptionEndpoint; onSelect: (route: GatewayTranscriptionEndpoint) => void };
export type TranscriptionPreferences = TranscriptionOptions & { model?: string | null; split?: boolean; overlap?: number; skipDictateWarning?: boolean };

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
  const key = scope && `streaik.transcriptions.settings.v1:${scope}`;
  const [value, setValue] = useState<TranscriptionPreferences>(() => {
    try {
      const data = JSON.parse(read(key) ?? '{}');
      return { model: data.model === null || typeof data.model === 'string' ? data.model : typeof data.fileModel === 'string' ? data.fileModel : undefined,
        language: typeof data.language === 'string' ? data.language.slice(0, 35) : undefined,
        prompt: typeof data.prompt === 'string' ? data.prompt.slice(0, 1000) : undefined,
        split: data.split === true, diarization: data.diarization === true, skipDictateWarning: data.skipDictateWarning === true,
        overlap: typeof data.overlap === 'number' && data.overlap >= 0 && data.overlap <= 10 ? data.overlap : 5 };
    } catch { return {}; }
  });
  return [value, (patch: Partial<TranscriptionPreferences>) => {
    const updated = { ...value, ...patch };
    setValue(updated);
    write(key, JSON.stringify(updated));
  }] as const;
}
