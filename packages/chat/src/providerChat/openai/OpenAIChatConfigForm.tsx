import { Button } from '@streaik/themes';
import { useAppTranslation } from '../../i18n';
import { Card, Choice, FieldGrid, Integer, ParallelCalls, Text, Toggle, setOption } from '../fields';
import type { OptionsEditor, ProviderFormProps } from '../fields';
import type { NativeValue } from '../settings';
import { efforts, list, object, summaries, tiers } from './options';
import { HostedTools } from './HostedTools';
import { ExecutionTools } from './ExecutionTools';
import { ManagedSessions } from './ManagedSessions';

const defaultReasoning = { effort: 'medium', context: 'auto', mode: 'standard', summary: 'auto' };
const defaultModeration = { model: 'omni-moderation-latest', policy: { input: { mode: 'score' }, output: { mode: 'score' } } };
const defaultCache = { mode: 'implicit', ttl: '30m' };

function ContextManagement({ value, onChange }: OptionsEditor) {
  const { t } = useAppTranslation();
  const rows = list(value.context_management);
  const save = (rows: readonly NativeValue[]) => onChange(setOption(value, 'context_management', rows.length ? rows : undefined));
  const move = (from: number, to: number) => {
    const next = [...rows];
    [next[from], next[to]] = [next[to], next[from]];
    save(next);
  };
  return <Card title="Context management">
    {rows.map((value, index) => {
      const entry = object(value);
      return <fieldset key={index}><legend>{t('Context rule {{index}}', { index: index + 1 })}</legend>
        <FieldGrid>
          <Choice label="Context rule type" value={entry.type} choices={['compaction']}
            onChange={type => type && save(rows.map((row, i) => i === index ? { ...entry, type } : row))} />
          {entry.type === 'compaction' && <Integer label="Compaction threshold" min={1000} value={entry.compact_threshold}
            onChange={compact_threshold => compact_threshold !== undefined && save(rows.map((row, i) => i === index
              ? { ...entry, compact_threshold } : row))} />}
        </FieldGrid>
        <div className="chat-provider-actions">
          <Button variant="subtle" disabled={index === 0} onClick={() => move(index, index - 1)}>{t('Move up')}</Button>
          <Button variant="subtle" disabled={index === rows.length - 1} onClick={() => move(index, index + 1)}>{t('Move down')}</Button>
          <Button variant="subtle" onClick={() => save(rows.filter((_, i) => i !== index))}>{t('Remove rule')}</Button>
        </div>
      </fieldset>;
    })}
    <div><Button variant="subtle" onClick={() => save([...rows, { type: 'compaction', compact_threshold: 1000 }])}>{t('Add compaction rule')}</Button></div>
  </Card>;
}

function ResponseOptions({ value, onChange }: OptionsEditor) {
  const set = (key: string, next?: NativeValue) => onChange(setOption(value, key, next));
  const merge = (key: string, field: string, next?: NativeValue) => set(key, setOption(object(value[key]), field, next));
  const reasoning = object(value.reasoning);
  const moderation = object(value.moderation);
  const policy = object(moderation.policy);
  const cache = object(value.prompt_cache_options);
  const multi = object(value.multi_agent);
  return <>
    <Card title="Reasoning">
      <Toggle label="Configure reasoning" checked={!!value.reasoning} onChange={on => set('reasoning', on ? defaultReasoning : undefined)} />
      {!!value.reasoning && <FieldGrid>
        <Choice label="Reasoning effort" value={reasoning.effort} choices={efforts} onChange={next => merge('reasoning', 'effort', next)} />
        <Choice label="Reasoning summary" value={reasoning.summary} choices={summaries} onChange={next => merge('reasoning', 'summary', next)} />
        <Choice label="Reasoning context" value={reasoning.context} choices={['auto', 'current_turn', 'all_turns']}
          onChange={next => merge('reasoning', 'context', next)} />
        <Choice label="Reasoning mode" value={reasoning.mode} choices={['standard', 'pro']} onChange={next => merge('reasoning', 'mode', next)} />
      </FieldGrid>}
      <Toggle label="Include encrypted reasoning" checked={value.includeEncryptedReasoning !== false}
        onChange={on => set('includeEncryptedReasoning', on ? undefined : false)} />
    </Card>
    <ContextManagement value={value} onChange={onChange} />
    <Card title="Prompt caching">
      <Toggle label="Configure prompt caching" checked={!!value.prompt_cache_options}
        onChange={on => set('prompt_cache_options', on ? defaultCache : undefined)} />
      {!!value.prompt_cache_options && <FieldGrid>
        <Choice label="Cache mode" value={cache.mode} choices={['implicit', 'explicit']} onChange={next => merge('prompt_cache_options', 'mode', next)} />
        <Choice label="Cache lifetime" value={cache.ttl} choices={['30m', '12h']} onChange={next => merge('prompt_cache_options', 'ttl', next)} />
      </FieldGrid>}
    </Card>
    <Card title="Moderation">
      <Toggle label="Enable moderation" checked={!!value.moderation} onChange={on => set('moderation', on ? defaultModeration : undefined)} />
      {!!value.moderation && <>
        <Text label="Moderation model" value={moderation.model} onChange={next => merge('moderation', 'model', next)} />
        <FieldGrid>
          {(['input', 'output'] as const).map(direction => <Choice key={direction} label={direction === 'input' ? 'Input moderation' : 'Output moderation'}
            value={object(policy[direction]).mode} choices={['score', 'block']}
            onChange={mode => merge('moderation', 'policy', setOption(policy, direction, mode ? { ...object(policy[direction]), mode } : undefined))} />)}
        </FieldGrid>
      </>}
    </Card>
    <Card title="Multi-agent">
      <Toggle label="Enable multi-agent responses" checked={multi.enabled === true}
        onChange={on => set('multi_agent', on ? { ...multi, enabled: true, max_concurrent_subagents: multi.max_concurrent_subagents ?? 3 } : undefined)} />
      {multi.enabled === true && <Integer label="Maximum concurrent subagents" min={1} value={multi.max_concurrent_subagents}
        onChange={next => merge('multi_agent', 'max_concurrent_subagents', next)} />}
    </Card>
  </>;
}

export function OpenAIChatConfigForm({ value, onChange }: ProviderFormProps) {
  const props = { value, onChange };
  const text = object(value.text);
  return <>
    <ResponseOptions {...props} />
    <HostedTools {...props} />
    <ExecutionTools {...props} />
    <ManagedSessions {...props} />
    <Card title="Other">
      <FieldGrid>
        <Choice label="Service tier" value={value.service_tier} choices={tiers} onChange={next => onChange(setOption(value, 'service_tier', next))} />
        <Choice label="Text verbosity" value={text.verbosity} choices={['low', 'medium', 'high']} onChange={next => {
          const patch = setOption(text, 'verbosity', next);
          onChange(setOption(value, 'text', Object.keys(patch).length ? patch : undefined));
        }} />
        <ParallelCalls {...props} />
      </FieldGrid>
    </Card>
  </>;
}
