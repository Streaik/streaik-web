import { useId, useState } from 'react';
import { useAppTranslation } from '../../i18n';
import { Card, Choice, Integer, ListField, Text, Toggle, setOption } from '../fields';
import type { OptionsEditor } from '../fields';
import type { NativeOptions, NativeValue } from '../settings';
import { efforts, object, summaries, tiers, typedItem, updateTypedItem } from './options';

function JsonSchema({ value, onChange }: { value?: NativeValue; onChange: (schema: NativeOptions) => void }) {
  const { t } = useAppTranslation();
  const id = useId();
  const [draft, setDraft] = useState<string>();
  const input = draft ?? JSON.stringify(object(value), null, 2);
  const parse = (text: string) => {
    try {
      const value: unknown = JSON.parse(text);
      return value && typeof value === 'object' && !Array.isArray(value) ? value as NativeOptions : undefined;
    } catch { return undefined; }
  };
  const invalid = !parse(input);
  return <>
    <label>{t('Session response JSON schema')}<textarea rows={5} value={input} aria-invalid={invalid}
      aria-describedby={invalid ? id : undefined} onChange={event => {
        const text = event.currentTarget.value;
        setDraft(text);
        const schema = parse(text);
        if (schema) onChange(schema);
      }} /></label>
    {invalid && <p id={id} role="status">{t('Enter a valid JSON object. Invalid schema changes will not be saved.')}</p>}
  </>;
}

export function ManagedSessions({ value, onChange }: OptionsEditor) {
  const { t } = useAppTranslation();
  const agent = object(value.agent);
  const environment = object(value.environment);
  const setAgent = (key: string, next?: NativeValue) => onChange(setOption(value, 'agent', setOption(agent, key, next)));
  const setEnvironment = (key: string, next?: NativeValue) => onChange(setOption(value, 'environment', setOption(environment, key, next)));
  const reasoning = object(agent.reasoning);
  const text = object(agent.text);
  const format = object(text.format);
  const multi = object(agent.multi_agent);
  const network = object(environment.network);
  const desktop = object(environment.desktop);
  const tool = (type: string) => typedItem(agent.tools, type);
  const saveTool = (type: string, next?: NativeOptions) => setAgent('tools', updateTypedItem(agent.tools, type, next));
  const updateTool = (type: string, key: string, next?: NativeValue) => saveTool(type, setOption(tool(type) ?? {}, key, next));
  const search = tool('web_search');
  const searchLocation = object(search?.location);
  const computer = tool('computer_use');
  const programmatic = tool('programmatic_tool_calling');
  return <>
    <Card title="Managed agent session">
      <p>{t('Saved for managed sessions. These settings are not sent to the default Responses route.')}</p>
      <Toggle label="Configure managed agent" checked={!!value.agent} onChange={on => onChange(setOption(value, 'agent', on ? {} : undefined))} />
      {!!value.agent && <>
        <Text label="Session agent model" value={agent.model} onChange={next => setAgent('model', next)} />
        <Text label="Session agent instructions" multiline value={agent.instructions} onChange={next => setAgent('instructions', next)} />
        <Choice label="Session reasoning effort" value={reasoning.effort} choices={efforts}
          onChange={next => setAgent('reasoning', setOption(reasoning, 'effort', next))} />
        <Choice label="Session reasoning summary" value={reasoning.summary} choices={summaries}
          onChange={next => setAgent('reasoning', setOption(reasoning, 'summary', next))} />
        <Choice label="Session service tier" value={agent.service_tier} choices={tiers} onChange={next => setAgent('service_tier', next)} />
        <Choice label="Session text verbosity" value={text.verbosity} choices={['low', 'medium', 'high']}
          onChange={next => setAgent('text', setOption(text, 'verbosity', next))} />
        <Choice label="Session response format" value={format.type} choices={['text', 'json_schema']}
          onChange={type => setAgent('text', setOption(text, 'format', type === 'json_schema' ? { type, schema: format.schema ?? {} } : type ? { type } : undefined))} />
        {format.type === 'json_schema' && <JsonSchema value={format.schema} onChange={schema => setAgent('text', { ...text, format: { ...format, schema } })} />}
        <Toggle label="Enable session subagents" checked={multi.enabled === true}
          onChange={on => setAgent('multi_agent', on ? { ...multi, enabled: true } : undefined)} />
        {multi.enabled === true && <Integer label="Session maximum subagents" value={multi.max_concurrent_subagents} min={1}
          onChange={next => setAgent('multi_agent', setOption(multi, 'max_concurrent_subagents', next))} />}
        {([['computer_use', 'Session computer use'], ['web_search', 'Session web search'],
          ['programmatic_tool_calling', 'Session programmatic tool calling'], ['tool_search', 'Session tool search']] as const).map(([type, label]) =>
          <Toggle key={type} label={label} checked={!!tool(type)} onChange={on => saveTool(type, on ? {} : undefined)} />)}
        {computer && <Toggle label="Include session screenshots" checked={computer.include_screenshots === true}
          onChange={on => updateTool('computer_use', 'include_screenshots', on)} />}
        {programmatic && <Toggle label="Enable session programmatic execution" checked={programmatic.enabled !== false}
          onChange={on => updateTool('programmatic_tool_calling', 'enabled', on)} />}
        {search && <>
          <Choice label="Session web search mode" value={search.mode} choices={['disabled', 'cached', 'live']}
            onChange={next => updateTool('web_search', 'mode', next)} />
          <Choice label="Session search context size" value={search.context_size} choices={['low', 'medium', 'high']}
            onChange={next => updateTool('web_search', 'context_size', next)} />
          <ListField label="Session allowed web domains" value={search.allowed_domains}
            onChange={next => updateTool('web_search', 'allowed_domains', next)} />
          {([['country', 'Session country'], ['region', 'Session region'], ['city', 'Session city'], ['timezone', 'Session time zone']] as const)
            .map(([key, label]) => <Text key={key} label={label} value={searchLocation[key]}
              onChange={next => updateTool('web_search', 'location', setOption(searchLocation, key, next))} />)}
        </>}
      </>}
    </Card>
    <Card title="Managed environment session">
      <p>{t('Saved for managed sessions. These settings are not sent to the default Responses route.')}</p>
      <Toggle label="Configure managed environment" checked={!!value.environment}
        onChange={on => onChange(setOption(value, 'environment', on ? { type: 'openai_hosted' } : undefined))} />
      {!!value.environment && <>
        <Choice label="Session environment type" value={environment.type} choices={{ none: 'None', openai_hosted: 'OpenAI hosted' }}
          onChange={type => onChange(setOption(value, 'environment', { type: type ?? 'openai_hosted' }))} />
        {environment.type === 'openai_hosted' && <>
          <Text label="Environment template ID" value={environment.environment_template_id}
            onChange={next => setEnvironment('environment_template_id', next)} />
          <Choice label="Environment container size" value={environment.container_size} choices={['small', 'medium', 'large']}
            onChange={next => setEnvironment('container_size', next)} />
          <Toggle label="Enable environment desktop" checked={desktop.enabled === true}
            onChange={on => setEnvironment('desktop', { ...desktop, enabled: on })} />
          <Choice label="Environment network access" value={network.access} choices={['enabled', 'disabled', 'restricted']}
            onChange={access => setEnvironment('network', access === 'restricted' ? { ...network, access } : access ? { access } : undefined)} />
          {network.access === 'restricted' && <>
            <ListField label="Environment allowed domains" value={network.allowed_domains}
              onChange={next => setEnvironment('network', setOption(network, 'allowed_domains', next))} />
            <ListField label="Environment blocked domains" value={network.blocked_domains}
              onChange={next => setEnvironment('network', setOption(network, 'blocked_domains', next))} />
          </>}
        </>}
      </>}
    </Card>
  </>;
}
