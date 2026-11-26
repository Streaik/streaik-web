import { Button } from '@streaik/themes';
import { useState } from 'react';
import { asDataUrl } from '../../chatAttachments';
import { useAppTranslation } from '../../i18n';
import { importSkillZip } from '../../skillBundles';
import { Card, Choice, FieldGrid, ListField, Text, Toggle, setOption } from '../fields';
import type { OptionsEditor } from '../fields';
import type { NativeOptions, NativeValue } from '../settings';
import { list, object, toggleInclude, typedItem, updateTypedItem } from './options';

function ContainerOptions({ value, onChange }: OptionsEditor) {
  const { t } = useAppTranslation();
  const network = object(value.network_policy);
  const secrets = list(network.domain_secrets);
  const setNetwork = (next?: NativeOptions) => onChange(setOption(value, 'network_policy', next));
  const setSecrets = (rows: readonly NativeValue[]) => setNetwork(setOption(network, 'domain_secrets', rows.length ? rows : undefined));
  return <>
    <FieldGrid>
      <Choice label="Container memory limit" value={value.memory_limit} choices={['1g', '4g', '16g', '64g']}
        onChange={next => onChange(setOption(value, 'memory_limit', next))} />
      <Choice label="Container network policy" value={network.type} choices={['disabled', 'allowlist']}
        onChange={type => setNetwork(type === 'allowlist' ? { ...network, type } : type ? { type } : undefined)} />
    </FieldGrid>
    {network.type === 'allowlist' && <>
      <ListField label="Allowed container domains" value={network.allowed_domains} onChange={next => setNetwork(setOption(network, 'allowed_domains', next))} />
      <p>{t('Domain secret values are sent to OpenAI for the configured domains and are never saved to browser storage.')}</p>
      {secrets.map((item, index) => {
        const secret = object(item);
        const edit = (key: string, next?: string) => setSecrets(secrets.map((row, i) => i === index ? setOption(secret, key, next) : row));
        return <fieldset key={index}><legend>{t('Domain secret {{index}}', { index: index + 1 })}</legend>
          <FieldGrid>
            <Text label="Secret domain" value={secret.domain} onChange={next => edit('domain', next)} />
            <Text label="Secret name" value={secret.name} onChange={next => edit('name', next)} />
          </FieldGrid>
          <label>{t('Secret value')}<input type="password" autoComplete="off" value={typeof secret.value === 'string' ? secret.value : ''}
            onChange={event => edit('value', event.currentTarget.value || undefined)} /></label>
          <div><Button variant="subtle" onClick={() => setSecrets(secrets.filter((_, i) => i !== index))}>{t('Remove secret')}</Button></div>
        </fieldset>;
      })}
      <div><Button variant="subtle" onClick={() => setSecrets([...secrets, {}])}>{t('Add domain secret')}</Button></div>
    </>}
  </>;
}

function SkillReferences({ value, onChange }: OptionsEditor) {
  const { t } = useAppTranslation();
  const [inline, setInline] = useState<NativeOptions>();
  const [reading, setReading] = useState(false);
  const [invalid, setInvalid] = useState(false);
  const skills = list(value.skills);
  const save = (next: readonly NativeValue[]) => onChange(setOption(value, 'skills', next.length ? next : undefined));
  async function read(file: File) {
    setReading(true); setInvalid(false); setInline(undefined);
    try {
      const { metadata: { name, description } } = await importSkillZip(file);
      const url = await asDataUrl(file, 'application/zip');
      setInline({ type: 'inline', name, description, source: { type: 'base64', media_type: 'application/zip', data: url.split(',')[1] } });
    } catch { setInvalid(true); }
    finally { setReading(false); }
  }
  return <fieldset><legend>{t('Shell skills')}</legend>
    <p>{t('Attach uploaded OpenAI skills by ID. Leave the version empty to use the provider default.')}</p>
    {skills.map((item, index) => {
      const skill = object(item);
      const edit = (key: string, next?: string) => save(skills.map((row, i) => i === index ? setOption(skill, key, next) : row));
      return <fieldset key={index}><legend>{t('Shell skill {{index}}', { index: index + 1 })}</legend>
        {skill.type === 'inline' ? <p>{typeof skill.name === 'string' ? skill.name : t('Inline skill')}</p> : <FieldGrid>
          <Text label="OpenAI skill ID" value={skill.skill_id} onChange={next => edit('skill_id', next)} />
          <Text label="Skill version" value={skill.version} onChange={next => edit('version', next)} />
        </FieldGrid>}
        <div><Button variant="subtle" onClick={() => save(skills.filter((_, i) => i !== index))}>{t('Remove skill')}</Button></div>
      </fieldset>;
    })}
    <div><Button variant="subtle" onClick={() => save([...skills, { type: 'skill_reference' }])}>{t('Add skill reference')}</Button></div>
    <label>{t('Inline Shell skill ZIP')}<input type="file" accept=".zip,application/zip" disabled={reading}
      onChange={event => {
        const file = event.currentTarget.files?.item(0);
        event.currentTarget.value = '';
        if (file) void read(file);
      }} /></label>
    <p>{t('An attached ZIP is sent to OpenAI with Shell requests during this session. The archive is not saved with preferences.')}</p>
    {invalid && <p role="status">{t('Choose a valid skill ZIP with a SKILL.md manifest.')}</p>}
    {inline && <div>
      <Button variant="subtle" onClick={() => { save([...skills, inline]); setInline(undefined); }}>
        {t('Attach inline skill {{name}}', { name: inline.name })}
      </Button>
    </div>}
  </fieldset>;
}

const clientSearch = {
  execution: 'client', description: 'Search the available tool catalog for tools that satisfy a goal.',
  parameters: { type: 'object', properties: { goal: { type: 'string', description: 'The capability or task to find tools for.' } },
    required: ['goal'], additionalProperties: false },
};

export function ExecutionTools({ value, onChange }: OptionsEditor) {
  const { t } = useAppTranslation();
  const tool = (kind: string) => typedItem(value.tools, kind);
  const setTool = (kind: string, next?: NativeOptions) => onChange(setOption(value, 'tools', updateTypedItem(value.tools, kind, next)));
  const code = tool('code_interpreter');
  const shell = tool('shell');
  const programmatic = !!tool('programmatic_tool_calling');
  const search = tool('tool_search');
  const environment = object(shell?.environment);
  const useContainerId = typeof code?.container === 'string';
  const callers = (kind: string, current: NativeOptions) => programmatic && <fieldset><legend>{t('Allowed callers')}</legend>
    <FieldGrid>
      {(['direct', 'programmatic'] as const).map(caller => <Toggle key={caller} label={caller === 'direct' ? 'Direct calls' : 'Programmatic calls'}
        checked={list(current.allowed_callers).includes(caller)} onChange={on => {
          const next = toggleInclude(current.allowed_callers, caller, on);
          setTool(kind, setOption(current, 'allowed_callers', next));
        }} />)}
    </FieldGrid>
  </fieldset>;
  const setProgrammatic = (on: boolean) => {
    let tools = updateTypedItem(value.tools, 'programmatic_tool_calling', on ? {} : undefined);
    for (const kind of ['shell', 'code_interpreter']) {
      const item = tool(kind);
      if (item) tools = updateTypedItem(tools, kind, setOption(item, 'allowed_callers', on ? ['direct', 'programmatic'] : undefined));
    }
    onChange(setOption(value, 'tools', tools));
  };
  return <>
    <Card title="Tool search">
      <Toggle label="Tool search" checked={!!search} onChange={on => setTool('tool_search', on ? {} : undefined)} />
      {search && <>
        <Choice label="Tool search execution" choices={{ hosted: 'Hosted', client: 'Client' }} value={search.execution ?? 'hosted'}
          onChange={mode => setTool('tool_search', mode === 'client' ? { ...search, ...clientSearch }
            : setOption(setOption(setOption(search, 'execution'), 'parameters'), 'description'))} />
      </>}
    </Card>
    <Card title="Programmatic tool calling">
      <Toggle label="Programmatic tool calling" checked={programmatic} onChange={setProgrammatic} />
    </Card>
    <Card title="Code interpreter">
      <Toggle label="Code interpreter" checked={!!code} onChange={on => setTool('code_interpreter', on ? {
        container: { type: 'auto' }, ...(programmatic && { allowed_callers: ['direct', 'programmatic'] }),
      } : undefined)} />
      {code && <>
        {callers('code_interpreter', code)}
        <FieldGrid>
          <Choice label="Code interpreter container" choices={{ auto: 'Automatic', reference: 'Existing container' }} value={useContainerId ? 'reference' : 'auto'}
            onChange={mode => setTool('code_interpreter', { ...code, container: mode === 'reference' ? '' : { type: 'auto' } })} />
          {useContainerId && <Text label="Code interpreter container ID" value={code.container}
            onChange={next => setTool('code_interpreter', { ...code, container: next ?? '' })} />}
        </FieldGrid>
        {useContainerId ? <p>{t('Use an existing container only on gateways that allow native container IDs. Shared-key gateways require signed references.')}</p>
          : <ContainerOptions value={object(code.container)} onChange={container => setTool('code_interpreter', { ...code, container })} />}
        <Toggle label="Include Code Interpreter outputs" checked={list(value.include).includes('code_interpreter_call.outputs')}
          onChange={on => onChange(setOption(value, 'include', toggleInclude(value.include, 'code_interpreter_call.outputs', on)))} />
      </>}
    </Card>
    <Card title="Shell">
      <Toggle label="Shell" checked={!!shell} onChange={on => setTool('shell', on ? {
        environment: { type: 'container_auto' }, ...(programmatic && { allowed_callers: ['direct', 'programmatic'] }),
      } : undefined)} />
      {shell && <>
        {callers('shell', shell)}
        <FieldGrid>
          <Choice label="Shell environment" value={environment.type} choices={{ container_auto: 'Automatic container',
            container_reference: 'Existing container', local: 'Local' }} onChange={type => setTool('shell', { ...shell,
            environment: { type: type ?? 'container_auto', ...(type !== 'local' && environment.skills && { skills: environment.skills }) } })} />
          {environment.type === 'container_reference' && <Text label="Shell container ID" value={environment.container_id}
            onChange={next => setTool('shell', { ...shell, environment: setOption(environment, 'container_id', next) })} />}
        </FieldGrid>
        {environment.type === 'local' ? <p role="status">{t('Local Shell is saved but not sent. Default Chat does not run commands on your device.')}</p>
          : environment.type === 'container_reference' ? <p role="status">{t('Existing Shell containers are saved but not sent. This route does not provide signed Shell container references.')}</p>
          : <ContainerOptions value={environment} onChange={next => setTool('shell', { ...shell, environment: next })} />}
        {environment.type !== 'local' && <SkillReferences value={environment} onChange={next => setTool('shell', { ...shell, environment: next })} />}
      </>}
    </Card>
    <Card title="Apply Patch">
      <Toggle label="Apply Patch" checked={!!tool('apply_patch')} onChange={on => setTool('apply_patch', on ? {} : undefined)} />
    </Card>
  </>;
}
