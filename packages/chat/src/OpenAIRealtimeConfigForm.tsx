import { Switch } from '@streaik/themes';
import { useId } from 'react';
import type { ChatModel } from '@streaik/gateway';
import { useAppTranslation } from './i18n';
import { defaultRealtimeTranscription, defaultRealtimeVad } from './realtimeSettings';
import type { RealtimeSettings } from './realtimeSettings';

const voices = ['alloy', 'ash', 'ballad', 'coral', 'echo', 'fable', 'onyx', 'nova', 'sage', 'shimmer', 'verse', 'marin', 'cedar'];
const liveTools = [['web_search', 'Web search'], ['code_interpreter', 'Code interpreter'], ['file_search', 'File search']] as const;
type Realtime = NonNullable<RealtimeSettings['realtime']>;
type Live = NonNullable<RealtimeSettings['live']>;
type Vad = NonNullable<Realtime['vad']>;
export type LiveClientAgent = { id: string; name: string };

export function OpenAIRealtimeConfigForm({ value, onChange, models, agents, protocol }: {
  value: RealtimeSettings; onChange: (settings: RealtimeSettings) => void; models: readonly ChatModel[];
  agents: readonly LiveClientAgent[]; protocol: 'live' | 'realtime';
}) {
  const { t } = useAppTranslation();
  const id = useId();
  const live = value.live ?? {}, realtime = value.realtime ?? {};
  const vad = realtime.vad === undefined ? defaultRealtimeVad : realtime.vad;
  const transcription: Realtime['transcription'] = realtime.transcription === undefined ? defaultRealtimeTranscription : realtime.transcription;
  const r = (update: Partial<Realtime>) => onChange({ ...value, realtime: { ...realtime, ...update } });
  const l = (update: Partial<Live>) => onChange({ ...value, live: { ...live, ...update } });
  const updateVad = (update: Partial<Vad>) => r({ vad: { ...(vad ?? defaultRealtimeVad), ...update } });
  const select = <T extends string>(label: string, current: T | undefined, options: ReadonlyArray<T>, change: (v: T | undefined) => void,
    names?: Record<string, string>, placeholder = 'Provider default') => <label>{t(label)}
      <select value={current ?? ''} onChange={e => change((e.currentTarget.value || undefined) as T | undefined)}>
        <option value="">{t(placeholder)}</option>
        {current && !options.includes(current) && <option value={current}>{current}</option>}
        {options.map(v => <option key={v} value={v}>{t(names?.[v] ?? v)}</option>)}
      </select>
    </label>;
  const number = (label: string, value: number | undefined, change: (v: number | undefined) => void, min: number, max?: number, step = 1) =>
    <label>{t(label)}<input type="number" value={value ?? ''} min={min} max={max} step={step}
      onChange={e => change(Number.isFinite(e.currentTarget.valueAsNumber) ? e.currentTarget.valueAsNumber : undefined)} /></label>;
  const toggle = (label: string, value: boolean, change: (v: boolean) => void) =>
    <Switch key={label} label={t(label)} checked={value} onCheckedChange={change} />;
  const text = (label: string, value: string | undefined, change: (v: string) => void, multi = false) => <label>{t(label)}
    {multi ? <textarea rows={3} value={value ?? ''} onChange={e => change(e.currentTarget.value)} />
      : <input value={value ?? ''} onChange={e => change(e.currentTarget.value)} />}</label>;
  const formats = ['audio/pcm', 'audio/pcma', 'audio/pcmu'] as const;
  const openAi = models.filter(({ provider }) => provider === 'openai');
  return <div className="chat-preference-cards">
    {protocol === 'live' && <section className="chat-tool-card" aria-labelledby={`${id}-live`}>
      <h3 id={`${id}-live`}>GPT Live</h3>
      {text('Instructions', live.instructions, instructions => l({ instructions }), true)}
      {select('Voice', live.voice, voices, voice => l({ voice }))}
      {text('Custom voice ID', live.customVoice, customVoice => l({ customVoice }))}
      {select('Delegation', live.mode ?? 'responses', ['responses', 'client'], mode => l({ mode }), { responses: 'Responses', client: 'Client' })}
      {number('Acknowledgement delay (ms)', live.acknowledgement, acknowledgement => l({ acknowledgement }), 0)}
      {live.mode === 'client' ? <>
        {select('Client model', live.clientModel, models.map(m => m.id), clientModel => l({ clientModel, clientAgent: undefined }), undefined, 'Choose a model')}
        {agents.length > 0 && select('Client agent', live.clientAgent, agents.map(a => a.id), clientAgent => l({ clientAgent, clientModel: undefined }),
          Object.fromEntries(agents.map(a => [a.id, a.name])), 'Choose an agent')}
      </> : <>
        <label>{t('Responses model')}<input list={`${id}-responses`} value={live.model ?? ''} onChange={e => l({ model: e.currentTarget.value })} />
          <datalist id={`${id}-responses`}>{openAi.map(({ id }) => <option key={id} value={id} />)}</datalist></label>
        {text('Backend instructions', live.backendInstructions, backendInstructions => l({ backendInstructions }), true)}
        {number('Backend maximum output tokens', live.maxTokens, maxTokens => l({ maxTokens }), 16)}
        {toggle('Parallel backend tool calls', live.parallel ?? true, parallel => l({ parallel }))}
        {select('Backend tool choice', live.toolChoice, ['auto', 'none', 'required'], toolChoice => l({ toolChoice }))}
        {select('Backend reasoning effort', live.effort, ['none', 'minimal', 'low', 'medium', 'high', 'xhigh'], effort => l({ effort }))}
        {select('Backend verbosity', live.verbosity, ['low', 'medium', 'high'], verbosity => l({ verbosity }))}
        <div className="chat-tool-switches">
          {liveTools.map(([tool, label]) => toggle(label, !!live.tools?.includes(tool), enabled => l({
            tools: enabled ? [...(live.tools ?? []), tool] : live.tools?.filter(item => item !== tool),
          })))}
        </div>
        {live.tools?.includes('file_search') && text('Vector store IDs (comma-separated)', live.vectorStores, vectorStores => l({ vectorStores }))}
      </>}
    </section>}
    {protocol === 'realtime' && <>
      <section className="chat-tool-card" aria-labelledby={`${id}-realtime`}>
        <h3 id={`${id}-realtime`}>GPT Realtime</h3>
        {text('Instructions', realtime.instructions, instructions => r({ instructions }), true)}
        {select('Voice', realtime.voice, voices, voice => r({ voice }))}
        {number('Speed', realtime.speed, speed => r({ speed }), 0.25, 4, 0.05)}
        {select('Output modality', realtime.output ?? 'audio', ['audio', 'text'], output => r({ output }))}
        {select('Reasoning effort', realtime.reasoning === null ? 'off' : realtime.reasoning, ['off', 'minimal', 'low', 'medium', 'high'],
          effort => r({ reasoning: effort === 'off' ? null : effort }), { off: 'Off' })}
        {select('Truncation', realtime.truncation, ['auto', 'disabled'], truncation => r({ truncation }))}
        {select('Tracing', realtime.tracing === null ? 'off' : realtime.tracing, ['auto', 'off'], tracing => r({ tracing: tracing === 'off' ? null : tracing }), { off: 'Off' })}
        {toggle('Unlimited output tokens', realtime.maxTokens === 'inf', enabled => r({ maxTokens: enabled ? 'inf' : undefined }))}
        {realtime.maxTokens !== 'inf' && number('Maximum output tokens', realtime.maxTokens, maxTokens => r({ maxTokens }), 1, 4096)}
        {number('Client-secret lifetime (seconds)', realtime.tokenTtl, tokenTtl => r({ tokenTtl }), 1, 7200)}
        <p>{t('Leave lifetime empty to negotiate through the gateway without a browser client secret.')}</p>
      </section>
      <section className="chat-tool-card"><h3>{t('Audio')}</h3>
        {select('Input format', realtime.inputFormat, formats, inputFormat => r({ inputFormat }))}
        {select('Output format', realtime.outputFormat, formats, outputFormat => r({ outputFormat }))}
        {select('Noise reduction', realtime.noise === null ? 'off' : realtime.noise, ['off', 'near_field', 'far_field'],
          noise => r({ noise: noise === 'off' ? null : noise }), { off: 'Off' })}
        {toggle('Input transcription', !!transcription, enabled => r({ transcription: enabled ? defaultRealtimeTranscription : null }))}
        {transcription && <>
          {text('Transcription model', transcription.model, model => r({ transcription: { ...transcription, model } }))}
          {text('Transcription language', transcription.language, language => r({ transcription: { ...transcription, language } }))}
          {text('Transcription prompt', transcription.prompt, prompt => r({ transcription: { ...transcription, prompt } }), true)}
        </>}
      </section>
      <section className="chat-tool-card"><h3>{t('Turn detection')}</h3>
        {toggle('Turn detection', !!vad, enabled => r({ vad: enabled ? defaultRealtimeVad : null }))}
        {vad && <>
          {select('Turn detection type', vad.type, ['semantic_vad', 'server_vad'], type => updateVad({ type: type ?? 'semantic_vad' }))}
          {toggle('Create response automatically', vad.create_response !== false, create_response => updateVad({ create_response }))}
          {toggle('Interrupt response', vad.interrupt_response !== false, interrupt_response => updateVad({ interrupt_response }))}
          {vad.type === 'semantic_vad' ? select('Semantic VAD eagerness', vad.eagerness, ['auto', 'low', 'medium', 'high'], eagerness => updateVad({ eagerness })) : <>
            {number('VAD threshold', vad.threshold, threshold => updateVad({ threshold }), 0, 1, 0.05)}
            {number('Prefix padding (ms)', vad.prefix_padding_ms, prefix_padding_ms => updateVad({ prefix_padding_ms }), 0)}
            {number('Silence duration (ms)', vad.silence_duration_ms, silence_duration_ms => updateVad({ silence_duration_ms }), 0)}
            {number('Idle timeout (ms)', vad.idle_timeout_ms, idle_timeout_ms => updateVad({ idle_timeout_ms }), 5000, 30000)}
          </>}
        </>}
        {(!vad || vad.create_response === false) && <p>{t('Press Enter in the empty composer to finish a manual voice turn. The voice button still ends the session.')}</p>}
      </section>
    </>}
  </div>;
}
