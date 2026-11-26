export const transcriptionSettingsKey = (scope: string) => `streaik.transcriptions.settings.v1:${scope}`;
export const transcriptionSplitLimits = { overlap: { min: 0, max: 60 }, maxChunkSizeMb: { min: 1, max: 100 } } as const;
export const defaultTranscriptionSplit = { enabled: true, overlap: 5, maxChunkSizeMb: 15 };
export type TranscriptionSplitPreferences = typeof defaultTranscriptionSplit;

export function normalizeTranscriptionSplit(value?: Partial<TranscriptionSplitPreferences> | null): TranscriptionSplitPreferences {
  const bounded = (key: 'overlap' | 'maxChunkSizeMb') => {
    const input = value?.[key];
    const { min, max } = transcriptionSplitLimits[key];
    return typeof input === 'number' && Number.isFinite(input) ? Math.round(Math.min(max, Math.max(min, input))) : defaultTranscriptionSplit[key];
  };
  return { enabled: typeof value?.enabled === 'boolean' ? value.enabled : defaultTranscriptionSplit.enabled,
    overlap: bounded('overlap'), maxChunkSizeMb: bounded('maxChunkSizeMb') };
}

export function legacyTranscriptionSplit(scope: string): TranscriptionSplitPreferences {
  try {
    const value = JSON.parse(localStorage.getItem(transcriptionSettingsKey(scope)) ?? '{}');
    return normalizeTranscriptionSplit({ enabled: value.split, overlap: value.overlap });
  } catch { return defaultTranscriptionSplit; }
}
