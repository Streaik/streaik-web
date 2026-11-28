import { Switch } from '@streaik/themes';
import { useAppTranslation } from './i18n';
import { defaultGoogleVoiceSetup, googleVoices, xaiPcmRates, xaiVoices } from './socketVoiceSettings';
import type { GoogleVoiceSettings, VoiceFormat, XaiVoiceSettings } from './socketVoiceSettings';

function useFields() {
  const { t } = useAppTranslation();
  return {
    t,
    select: <T extends string | number>(label: string, value: T | undefined, options: readonly T[], change: (v: T | undefined) => void) =>
      <label>{t(label)}<select value={value ?? ''} onChange={e => change(options.find(v => String(v) === e.currentTarget.value))}>
        <option value="">{t('Provider default')}</option>{options.map(option => <option key={option} value={option}>{option}</option>)}
      </select></label>,
    number: (label: string, value: number | undefined, change: (v: number | undefined) => void, min: number, max: number, step = 1) =>
      <label>{t(label)}<input type="number" value={value ?? ''} min={min} max={max} step={step}
        onChange={e => change(Number.isFinite(e.currentTarget.valueAsNumber) ? e.currentTarget.valueAsNumber : undefined)} /></label>,
    toggle: (label: string, checked: boolean, change: (checked: boolean) => void) =>
      <Switch label={t(label)} checked={checked} onCheckedChange={change} />,
    text: (label: string, value: string | undefined, change: (v: string) => void, multi = false) => <label>{t(label)}
      {multi ? <textarea rows={3} value={value ?? ''} onChange={e => change(e.currentTarget.value)} />
        : <input value={value ?? ''} onChange={e => change(e.currentTarget.value)} />}</label>,
  };
}

export function GoogleRealtimeConfigForm({ value, onChange }: { value: GoogleVoiceSettings; onChange: (value: GoogleVoiceSettings) => void }) {
  const { t, select, number, toggle, text } = useFields();
  const setup = value.bidiGenerateContentSetup ?? defaultGoogleVoiceSetup;
  const vad = setup.realtimeInputConfig?.automaticActivityDetection ?? {};
  const compression = setup.contextWindowCompression;
  const update = (patch: Partial<typeof setup>) => onChange({ ...value, bidiGenerateContentSetup: { ...setup, ...patch } });
  const updateVad = (patch: Partial<typeof vad>) => update({ realtimeInputConfig: { automaticActivityDetection: { ...vad, ...patch } } });
  return <div className="chat-preference-cards">
    <section className="chat-tool-card" aria-label="Gemini Live">
      <h3>Gemini Live</h3>
      {select('Voice', setup.generationConfig?.speechConfig?.voiceConfig.prebuiltVoiceConfig.voiceName, googleVoices, voiceName =>
        update({ generationConfig: voiceName ? { speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName } } } } : undefined }))}
      {toggle('Input audio transcription', setup.inputAudioTranscription !== undefined, value => update({ inputAudioTranscription: value ? {} : undefined }))}
      {toggle('Output audio transcription', setup.outputAudioTranscription !== undefined, value => update({ outputAudioTranscription: value ? {} : undefined }))}
      {toggle('Google Search', !!setup.tools?.length, value => update({ tools: value ? [{ googleSearch: {} }] : undefined }))}
    </section>
    <section className="chat-tool-card" aria-label={t('Activity detection')}>
      <h3>{t('Activity detection')}</h3>
      {toggle('Automatic activity detection', vad.disabled !== true, enabled => updateVad({ disabled: !enabled }))}
      {vad.disabled !== true && <>
        {number('Prefix padding (ms)', vad.prefixPaddingMs, prefixPaddingMs => updateVad({ prefixPaddingMs }), 0, 10000)}
        {number('Silence duration (ms)', vad.silenceDurationMs, silenceDurationMs => updateVad({ silenceDurationMs }), 0, 10000)}
      </>}
    </section>
    <section className="chat-tool-card" aria-label={t('Session management')}>
      <h3>{t('Session management')}</h3>
      {toggle('Context window compression', !!compression, enabled => update({ contextWindowCompression: enabled ? { slidingWindow: {} } : undefined }))}
      {compression && <>
        {number('Compression trigger tokens', compression.triggerTokens, triggerTokens => update({ contextWindowCompression: { ...compression, triggerTokens } }), 1, 2_000_000)}
        {number('Sliding window target tokens', compression.slidingWindow.targetTokens, targetTokens => update({ contextWindowCompression: { ...compression, slidingWindow: { targetTokens } } }), 1, 2_000_000)}
      </>}
      {number('Token uses', value.uses, uses => onChange({ ...value, uses }), 1, 100)}
      {text('Token expiry (RFC 3339)', value.expireTime, expireTime => onChange({ ...value, expireTime }))}
      {text('New session expiry (RFC 3339)', value.newSessionExpireTime, newSessionExpireTime => onChange({ ...value, newSessionExpireTime }))}
    </section>
  </div>;
}

export function XaiRealtimeConfigForm({ value, onChange }: { value: XaiVoiceSettings; onChange: (value: XaiVoiceSettings) => void }) {
  const { t, select, number, toggle, text } = useFields();
  const session = value.session ?? {}, vad = session.turn_detection;
  const update = (patch: Partial<typeof session>) => onChange({ ...value, session: { ...session, ...patch } });
  const updateVad = (patch: Partial<NonNullable<typeof vad>>) => update({ turn_detection: { type: 'server_vad', ...vad, ...patch } });
  const format = (direction: 'input' | 'output') => {
    const input = direction === 'input', current = session.audio?.[direction]?.format;
    const setFormat = (format?: VoiceFormat) => update({ audio: { ...session.audio, [direction]: { format } } });
    return <>
      {select(input ? 'Input format' : 'Output format', current?.type, ['audio/pcm', 'audio/pcma', 'audio/pcmu'] as const,
        type => setFormat(type === 'audio/pcm' ? { type, rate: 24000 } : type ? { type } : undefined))}
      {current?.type === 'audio/pcm' && select(input ? 'Input sample rate' : 'Output sample rate', current.rate, xaiPcmRates,
        rate => setFormat({ type: 'audio/pcm', rate: rate ?? 24000 }))}
    </>;
  };
  return <div className="chat-preference-cards">
    <section className="chat-tool-card" aria-label="Grok Voice">
      <h3>Grok Voice</h3>
      {select('Voice', session.voice, xaiVoices, voice => update({ voice }))}
      {text('Instructions', session.instructions, instructions => update({ instructions }), true)}
      {number('Token TTL seconds', value.expires_after?.seconds, seconds => onChange({ ...value, expires_after: seconds === undefined ? undefined : { seconds } }), 1, 3600)}
    </section>
    <section className="chat-tool-card" aria-label={t('Audio')}>
      <h3>{t('Audio')}</h3>
      {format('input')}{format('output')}
    </section>
    <section className="chat-tool-card" aria-label={t('Turn detection')}>
      <h3>{t('Turn detection')}</h3>
      {toggle('Server voice activity detection', vad !== null, enabled => update({ turn_detection: enabled ? { type: 'server_vad' } : null }))}
      {vad !== null && number('Idle timeout (ms)', vad?.idle_timeout_ms, idle_timeout_ms => updateVad({ idle_timeout_ms }), 1, 600000)}
    </section>
  </div>;
}
