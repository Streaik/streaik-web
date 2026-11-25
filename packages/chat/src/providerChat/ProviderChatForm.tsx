import type { ChatModel } from '@streaik/gateway';
import { useId, useState } from 'react';
import type { ComponentType, ReactNode } from 'react';
import { useAppTranslation } from '../i18n';
import { nativeObject, supportsGptOssEffort, supportsOpenAIReasoning } from './settings';
import type { ChatProviderId, NativeOptions, NativeValue } from './settings';

type ProviderFormProps = { value: NativeOptions; onChange: (next: NativeOptions) => void; models: readonly ChatModel[] };

const efforts = ['low', 'medium', 'high'] as const;
const boolOptions = { true: 'Enabled', false: 'Disabled' };
const choice = (value: NativeValue | undefined) => typeof value === 'string' || typeof value === 'boolean' ? String(value) : '';
const setField = (config: NativeOptions, key: string, value: NativeValue | undefined): NativeOptions => {
  const { [key]: _old, ...rest } = config;
  return value === undefined ? rest : { ...rest, [key]: value };
};

function Card({ title, children }: { title: string; children: ReactNode }) {
  const { t } = useAppTranslation();
  return <section className="chat-tool-card"><h3>{t(title)}</h3>{children}</section>;
}

function Select({ label, value, choices, onChange }: {
  label: string; value: NativeValue | undefined; choices: readonly string[] | Readonly<Record<string, string>>;
  onChange: (value: string | undefined) => void;
}) {
  const { t } = useAppTranslation();
  const id = useId();
  const pairs = Array.isArray(choices) ? choices.map(value => [value, value]) : Object.entries(choices);
  return <div className="chat-provider-select"><label htmlFor={id}>{t(label)}</label>
    <select id={id} value={choice(value)} onChange={event => onChange(event.currentTarget.value || undefined)}>
      <option value="">{t('Provider default')}</option>
      {pairs.map(([id, label]) => <option value={id} key={id}>{t(label)}</option>)}
    </select></div>;
}

function Integer({ label, value, min, onChange }: { label: string; value?: NativeValue; min?: number; onChange: (value?: number) => void }) {
  const { t } = useAppTranslation();
  const [input, setInput] = useState<string>();
  return <label>{t(label)}<input type="number" step={1} min={min} value={input ?? (typeof value === 'number' ? value : '')}
    onBlur={() => setInput(undefined)}
    onChange={event => {
      const { value, valueAsNumber, validity } = event.currentTarget;
      setInput(value);
      if (!value && !validity.badInput) onChange();
      else if (Number.isSafeInteger(valueAsNumber) && (min === undefined || valueAsNumber >= min)) onChange(valueAsNumber);
    }} /></label>;
}

function ParallelCalls({ value, onChange }: Pick<ProviderFormProps, 'value' | 'onChange'>) {
  return <Select label="Parallel tool calls" value={value.parallel_tool_calls} choices={boolOptions}
    onChange={next => onChange(setField(value, 'parallel_tool_calls', next === undefined ? undefined : next === 'true'))} />;
}

function ChatCompletionsReasoning({ value, onChange, models, allowNone }: ProviderFormProps & { allowNone?: boolean }) {
  const { t } = useAppTranslation();
  return <Card title="Reasoning">{models.some(model => supportsGptOssEffort(model.id))
    ? <Select label="Reasoning effort" value={value.reasoning_effort} choices={allowNone ? ['none', ...efforts] : efforts}
      onChange={effort => onChange(setField(value, 'reasoning_effort', effort))} />
    : <p>{t('Reasoning effort is not available for the selected models.')}</p>}</Card>;
}

function CerebrasForm(props: ProviderFormProps) {
  const { value, onChange } = props;
  return <>
    <ChatCompletionsReasoning {...props} allowNone />
    <Card title="Other">
      <Integer label="Seed" value={value.seed} onChange={seed => onChange(setField(value, 'seed', seed))} />
      <ParallelCalls {...props} />
    </Card>
  </>;
}

function TogetherForm(props: ProviderFormProps) {
  return <ChatCompletionsReasoning {...props} />;
}

const hostedTools = [
  ['web_search', 'Web search'], ['image_generation', 'Image generation'], ['code_interpreter', 'Code interpreter'],
] as const;

function OpenAIForm({ value, onChange, models }: ProviderFormProps) {
  const { t } = useAppTranslation();
  const patch = (key: string, next: NativeValue | undefined) => onChange(setField(value, key, next));
  const reasoning = nativeObject(value.reasoning) ?? {};
  const patchReasoning = (key: string, next: string | undefined) => {
    const changed = setField(reasoning, key, next);
    patch('reasoning', Object.keys(changed).length ? changed : undefined);
  };
  const tools: readonly NativeValue[] = Array.isArray(value.tools) ? value.tools : [];
  const tool = (name: string) => tools.map(nativeObject).find(item => item?.type === name);
  const updateTool = (name: string, next?: NativeOptions) => {
    const rest = tools.filter(item => nativeObject(item)?.type !== name);
    patch('tools', next ? [...rest, { ...next, type: name }] : rest.length ? rest : undefined);
  };
  const vectorStores = tool('file_search')?.vector_store_ids;
  const context: readonly NativeValue[] = Array.isArray(value.context_management) ? value.context_management : [];
  const compaction = context.map(nativeObject).find(entry => entry?.type === 'compaction');
  const updateCompaction = (threshold?: number) => {
    const rest = context.filter(item => nativeObject(item)?.type !== 'compaction');
    patch('context_management', threshold !== undefined ? [...rest, { ...compaction, type: 'compaction', compact_threshold: threshold }]
      : rest.length ? rest : undefined);
  };
  const cache = nativeObject(value.prompt_cache_options) ?? {};
  const patchCache = (key: string, next: string | undefined) => {
    const changed = setField(cache, key, next);
    patch('prompt_cache_options', Object.keys(changed).length ? changed : undefined);
  };
  const moderation = nativeObject(value.moderation);
  const policy = nativeObject(moderation?.policy) ?? {};
  return <>
    {models.some(model => supportsOpenAIReasoning(model.id)) && <Card title="Reasoning">
      <Select label="Reasoning effort" value={reasoning.effort} choices={efforts} onChange={next => patchReasoning('effort', next)} />
      <Select label="Reasoning summary" value={reasoning.summary} choices={['auto', 'concise', 'detailed']}
        onChange={next => patchReasoning('summary', next)} />
    </Card>}
    <Card title="Other">
      <Select label="Service tier" value={value.service_tier} choices={['auto', 'default', 'flex', 'scale', 'priority']}
        onChange={next => patch('service_tier', next)} />
      <ParallelCalls value={value} onChange={onChange} />
      <Integer label="Compaction threshold" min={1000} value={compaction?.compact_threshold} onChange={updateCompaction} />
    </Card>
    <Card title="Prompt caching">
      <Select label="Cache mode" value={cache.mode} choices={['implicit', 'explicit']} onChange={next => patchCache('mode', next)} />
      <Select label="Cache lifetime" value={cache.ttl} choices={['30m', '12h']} onChange={next => patchCache('ttl', next)} />
    </Card>
    <Card title="Moderation">
      <label className="chat-provider-switch"><input type="checkbox" role="switch" checked={!!moderation}
        onChange={event => patch('moderation', event.currentTarget.checked ? {
          model: 'omni-moderation-latest', policy: { input: { mode: 'score' }, output: { mode: 'score' } },
        } : undefined)} />{t('Enable moderation')}</label>
      {moderation && (['input', 'output'] as const).map(direction => <Select key={direction}
        label={direction === 'input' ? 'Input moderation' : 'Output moderation'} value={nativeObject(policy[direction])?.mode}
        choices={['score', 'block']}
        onChange={next => patch('moderation', { ...moderation, policy: setField(policy, direction, next && { mode: next }) })} />)}
    </Card>
    <Card title="Hosted tools">
      <p>{t('Hosted tool availability depends on the model and your provider account.')}</p>
      {hostedTools.map(([id, label]) => <label key={id} className="chat-provider-switch">
        <input type="checkbox" role="switch" checked={!!tool(id)} onChange={event => updateTool(id, event.currentTarget.checked
          ? id === 'code_interpreter' ? { container: { type: 'auto' } } : {} : undefined)} />{t(label)}
      </label>)}
      {tool('web_search') && <Select label="Search context size" value={tool('web_search')?.search_context_size} choices={efforts}
        onChange={next => updateTool('web_search', setField(tool('web_search') ?? {}, 'search_context_size', next))} />}
      {tool('image_generation') && <Select label="Image quality" value={tool('image_generation')?.quality} choices={['auto', ...efforts]}
        onChange={next => updateTool('image_generation', setField(tool('image_generation') ?? {}, 'quality', next))} />}
      <label>{t('File search vector store IDs (one per line)')}
        <textarea rows={3} defaultValue={Array.isArray(vectorStores) ? vectorStores.join('\n') : ''} onChange={event => {
          const ids = [...new Set(event.currentTarget.value.split(/\s+/).filter(Boolean))];
          updateTool('file_search', ids.length ? { ...tool('file_search'), vector_store_ids: ids } : undefined);
        }} />
      </label>
    </Card>
  </>;
}

const forms: Record<ChatProviderId, ComponentType<ProviderFormProps>> = {
  openai: OpenAIForm, cerebras: CerebrasForm, together: TogetherForm,
};

export function ProviderChatForm({ provider, ...props }: ProviderFormProps & { provider: ChatProviderId }) {
  const Form = forms[provider];
  return <Form {...props} />;
}
