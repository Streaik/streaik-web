const formats = ['audio/pcm', 'audio/pcma', 'audio/pcmu'] as const;
const efforts = ['minimal', 'low', 'medium', 'high'] as const;
const hostedTools = ['web_search', 'code_interpreter', 'file_search'] as const;
export type RealtimeSettings = {
  realtime?: {
    instructions?: string; voice?: string; speed?: number; reasoning?: typeof efforts[number] | null;
    truncation?: 'auto' | 'disabled'; tokenTtl?: number; output?: 'audio' | 'text'; maxTokens?: number | 'inf'; tracing?: 'auto' | null;
    inputFormat?: typeof formats[number]; outputFormat?: typeof formats[number]; noise?: 'near_field' | 'far_field' | null;
    transcription?: { model?: string; language?: string; prompt?: string } | null;
    vad?: {
      type: 'semantic_vad' | 'server_vad'; create_response?: boolean; interrupt_response?: boolean;
      eagerness?: 'auto' | 'low' | 'medium' | 'high'; threshold?: number; prefix_padding_ms?: number;
      silence_duration_ms?: number; idle_timeout_ms?: number;
    } | null;
  };
  live?: {
    instructions?: string; voice?: string; customVoice?: string; acknowledgement?: number; mode?: 'responses' | 'client';
    clientModel?: string; clientAgent?: string; model?: string; backendInstructions?: string; maxTokens?: number; parallel?: boolean;
    toolChoice?: 'auto' | 'none' | 'required'; tools?: typeof hostedTools[number][]; vectorStores?: string;
    effort?: 'none' | typeof efforts[number] | 'xhigh'; verbosity?: 'low' | 'medium' | 'high';
  };
};

const object = (value: unknown) => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const text = (v: unknown) => typeof v === 'string' && v.trim() ? v.slice(0, 16000) : undefined;
const bool = (v: unknown) => typeof v === 'boolean' ? v : undefined;
const choice = <T extends string>(v: unknown, values: readonly T[]) => values.includes(v as T) ? v as T : undefined;
const num = (v: unknown, min: number, max: number, integer = true) => typeof v === 'number' && Number.isFinite(v) &&
  v >= min && v <= max && (!integer || Number.isInteger(v)) ? v : undefined;
const maybeNull = <T>(v: unknown, value: T) => v === null ? null : value;

export function normalizeRealtimeSettings(value: unknown): RealtimeSettings {
  const { realtime, live } = object(value);
  const r = object(realtime), l = object(live), tr = object(r.transcription), vad = object(r.vad);
  const type = choice(vad.type, ['server_vad', 'semantic_vad']);
  return {
    ...(realtime != null && { realtime: {
      instructions: text(r.instructions), voice: text(r.voice), speed: num(r.speed, 0.25, 4, false),
      reasoning: maybeNull(r.reasoning, choice(r.reasoning, efforts)), truncation: choice(r.truncation, ['auto', 'disabled']),
      tokenTtl: num(r.tokenTtl, 1, 7200), output: choice(r.output, ['audio', 'text']),
      maxTokens: r.maxTokens === 'inf' ? 'inf' : num(r.maxTokens, 1, 4096), tracing: maybeNull(r.tracing, choice(r.tracing, ['auto'])),
      inputFormat: choice(r.inputFormat, formats), outputFormat: choice(r.outputFormat, formats),
      noise: maybeNull(r.noise, choice(r.noise, ['near_field', 'far_field'])),
      transcription: maybeNull(r.transcription, r.transcription && typeof r.transcription === 'object' ? {
        model: text(tr.model), language: text(tr.language), prompt: text(tr.prompt),
      } : undefined),
      vad: maybeNull(r.vad, type ? { type, create_response: bool(vad.create_response), interrupt_response: bool(vad.interrupt_response),
        ...(type === 'semantic_vad' ? { eagerness: choice(vad.eagerness, ['auto', 'low', 'medium', 'high']) } : {
          threshold: num(vad.threshold, 0, 1, false), prefix_padding_ms: num(vad.prefix_padding_ms, 0, 10000),
          silence_duration_ms: num(vad.silence_duration_ms, 0, 10000), idle_timeout_ms: num(vad.idle_timeout_ms, 5000, 30000),
        }) } : undefined),
    } }),
    ...(live != null && { live: {
      instructions: text(l.instructions), voice: text(l.voice), customVoice: text(l.customVoice), acknowledgement: num(l.acknowledgement, 0, 3600000, false),
      mode: choice(l.mode, ['client', 'responses']), clientModel: text(l.clientModel), clientAgent: text(l.clientAgent), model: text(l.model),
      backendInstructions: text(l.backendInstructions), maxTokens: num(l.maxTokens, 16, 1000000), parallel: bool(l.parallel),
      toolChoice: choice(l.toolChoice, ['auto', 'none', 'required']),
      tools: Array.isArray(l.tools) ? hostedTools.filter(tool => (l.tools as unknown[]).includes(tool)) : undefined,
      vectorStores: text(l.vectorStores), effort: choice(l.effort, ['none', ...efforts, 'xhigh']), verbosity: choice(l.verbosity, ['low', 'medium', 'high']),
    } }),
  };
}

export const defaultRealtimeTranscription = { model: 'gpt-4o-mini-transcribe' };
export const defaultRealtimeVad = { type: 'semantic_vad', eagerness: 'auto', create_response: true, interrupt_response: true } as const;

export function realtimeSession(settings: RealtimeSettings['realtime'], instructions: string | undefined, tools: readonly object[], toolChoice?: string) {
  const r = settings ?? {};
  const format = (type: string | undefined) => type ? { type, ...(type === 'audio/pcm' && { rate: 24000 }) } : undefined;
  const tr = r.transcription === undefined ? defaultRealtimeTranscription : r.transcription;
  return { type: 'realtime', instructions: [instructions, r.instructions].filter(Boolean).join('\n\n') || undefined,
    output_modalities: [r.output ?? 'audio'], max_output_tokens: r.maxTokens, tracing: r.tracing, truncation: r.truncation,
    reasoning: r.reasoning ? { effort: r.reasoning } : r.reasoning,
    audio: { input: { format: format(r.inputFormat), noise_reduction: r.noise ? { type: r.noise } : r.noise,
      transcription: tr && { ...tr, model: tr.model ? nativeOpenAiModel(tr.model) : defaultRealtimeTranscription.model },
      turn_detection: r.vad === undefined ? defaultRealtimeVad : r.vad },
    output: { format: format(r.outputFormat), voice: r.voice, speed: r.speed } },
    ...(tools.length && toolChoice !== 'none' ? { tools, tool_choice: toolChoice ?? 'auto' } : { tool_choice: 'none' }),
  };
}

const nativeOpenAiModel = (model: string) => model.trim().replace(/^openai\//, '');
export type VoiceHistoryItem = { role: 'user' | 'assistant'; text: string };

export function liveSession(settings: RealtimeSettings['live'], history: VoiceHistoryItem[], instructions: string | undefined,
  functions: readonly object[], choice?: string) {
  const l = settings ?? {};
  const mode = l.mode ?? 'responses';
  const model = l.model && nativeOpenAiModel(l.model);
  if (mode === 'responses' && (!model || !/^[\w.-]+$/.test(model))) throw new Error('Choose a Responses model in OpenAI settings.');
  const vectorIds = l.vectorStores?.split(/[\s,]+/).filter(Boolean) ?? [];
  const toolChoice = choice === 'none' ? 'none' : l.toolChoice ?? choice;
  if (mode === 'responses' && toolChoice !== 'none' && l.tools?.includes('file_search') && !vectorIds.length)
    throw new Error('Choose at least one vector store for GPT Live file search.');
  const tools = toolChoice === 'none' ? [] : [...functions, ...(l.tools ?? []).map(type => type === 'code_interpreter'
    ? { type, container: { type: 'auto' } } : type === 'file_search' ? { type, vector_store_ids: vectorIds } : { type })];
  return { store: false, instructions: [instructions, l.instructions].filter(Boolean).join('\n\n') || undefined,
    audio: l.voice || l.customVoice ? { output: { voice: l.customVoice ? { id: l.customVoice } : l.voice } } : undefined,
    input: history.map(({ role, text }) => ({ type: 'message', role, content: [{ type: role === 'assistant' ? 'output_text' : 'input_text', text }] })),
    client: { data_channel: { allowed_client_events: ['session.close', 'session.input_audio.mute', 'session.input_audio.unmute',
      ...(mode === 'client' ? ['session.thinking.append', 'session.commentary.append'] : ['response.item.create', 'response.create'])],
    allowed_server_events: [...['session.started', 'session.closed', 'session.input_transcript.delta', 'session.output_transcript.delta',
      'session.delegation.created', 'error'].map(type => ({ type })), ...(mode === 'responses' ?
        ['response.created', 'response.output_item.done', 'response.completed', 'response.failed', 'response.incomplete'].map(response_event => ({ type: 'response.event', response_event })) : [])] } },
    delegation: { type: mode, acknowledgement_delay_ms: l.acknowledgement, ...(mode === 'responses' && { responses: {
      model, instructions: l.backendInstructions, max_output_tokens: l.maxTokens, parallel_tool_calls: l.parallel,
      tool_choice: tools.length ? toolChoice : 'none', tools: tools.length ? tools : undefined,
      reasoning: l.effort && { effort: l.effort }, text: l.verbosity && { verbosity: l.verbosity },
    } }) },
  };
}
