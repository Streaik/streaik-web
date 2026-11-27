import { Choice, FieldGrid, Integer, ListField, setOption, Text, Toggle } from '../fields';
import type { OptionsEditor } from '../fields';
import type { NativeOptions } from '../settings';
import { array, BooleanChoice, cacheTtls, edit, JsonField, object, OptionalCard, section } from './fields';
import { useAppTranslation } from '../../i18n';

const versions = {
  bash: ['bash_20250124'],
  web_search: ['web_search_20260318', 'web_search_20260209', 'web_search_20250305'],
  web_fetch: ['web_fetch_20260318', 'web_fetch_20260309', 'web_fetch_20260209', 'web_fetch_20250910'],
  code_execution: ['code_execution_20260521', 'code_execution_20260120', 'code_execution_20250825'],
  text_editor: ['text_editor_20250728', 'text_editor_20250429', 'text_editor_20250124'],
  memory: ['memory_20250818'],
  advisor: ['advisor_20260301'],
  tool_search_tool_bm25: ['tool_search_tool_bm25_20251119'],
  tool_search_tool_regex: ['tool_search_tool_regex_20251119'],
} as const;

const titles: Record<keyof typeof versions, string> = {
  bash: 'Bash', web_search: 'Web search', web_fetch: 'Web fetch', code_execution: 'Code execution', text_editor: 'Text editor',
  memory: 'Memory', advisor: 'Advisor', tool_search_tool_bm25: 'Tool search (BM25)', tool_search_tool_regex: 'Tool search (regex)',
};

const advisorModels = ['claude-sonnet-5-5', 'claude-opus-5-5', 'claude-fable-5-1', 'claude-opus-5', 'claude-opus-4-8',
  'claude-opus-4-7', 'claude-opus-4-6', 'claude-sonnet-4-6'];

const toolName = (id: keyof typeof versions, type: string) => id === 'text_editor'
  ? type === 'text_editor_20250124' ? 'str_replace_editor' : 'str_replace_based_edit_tool' : id;

function ToolCache({ editor, field, label }: { editor: OptionsEditor; field: 'cache_control' | 'caching'; label: string }) {
  const cache = section(editor, field);
  return <>
    <Toggle label={label} checked={!!editor.value[field]} onChange={enabled => edit(editor, field)(enabled ? { type: 'ephemeral' } : undefined)} />
    {!!editor.value[field] && <FieldGrid>
      <Choice label={`${label} type`} value={cache.value.type} choices={['ephemeral']} onChange={type => edit(cache, 'type')(type ?? 'ephemeral')} />
      <Choice label={`${label} duration`} value={cache.value.ttl} choices={cacheTtls} onChange={edit(cache, 'ttl')} />
    </FieldGrid>}
  </>;
}

function WebToolFields({ id, editor }: { id: 'web_search' | 'web_fetch'; editor: OptionsEditor }) {
  const { value } = editor;
  const location = section(editor, 'user_location');
  const citations = section(editor, 'citations');
  return <>
    <FieldGrid>
      <Integer label="Maximum uses" min={1} value={value.max_uses} onChange={edit(editor, 'max_uses')} />
      {id === 'web_fetch' && <Integer label="Maximum content tokens" min={1} value={value.max_content_tokens} onChange={edit(editor, 'max_content_tokens')} />}
      {value.type === versions[id][0] && <Choice label="Response inclusion" value={value.response_inclusion}
        choices={['excluded']} onChange={edit(editor, 'response_inclusion')} />}
    </FieldGrid>
    <FieldGrid>
      <ListField label="Allowed domains" value={value.allowed_domains} onChange={domains => editor.onChange({
        ...setOption(value, 'allowed_domains', domains), ...(domains && { blocked_domains: undefined }),
      })} />
      <ListField label="Blocked domains" value={value.blocked_domains} onChange={domains => editor.onChange({
        ...setOption(value, 'blocked_domains', domains), ...(domains && { allowed_domains: undefined }),
      })} />
    </FieldGrid>
    {id === 'web_search' ? <>
      <Toggle label="User location" checked={!!value.user_location}
        onChange={enabled => edit(editor, 'user_location')(enabled ? { type: 'approximate' } : undefined)} />
      {!!value.user_location && <FieldGrid>
        <Choice label="Location type" value={location.value.type} choices={['approximate']} onChange={type => edit(location, 'type')(type ?? 'approximate')} />
        {Object.entries({ country: 'Country', region: 'Region', city: 'City', timezone: 'Timezone' }).map(([key, label]) =>
          <Text key={key} label={label} value={location.value[key]} onChange={edit(location, key)} />)}
      </FieldGrid>}
    </> : <FieldGrid>
      <BooleanChoice label="Citations" value={citations.value.enabled} onChange={edit(citations, 'enabled')} />
      {(value.type === 'web_fetch_20260318' || value.type === 'web_fetch_20260309') &&
        <BooleanChoice label="Use cache" value={value.use_cache} onChange={edit(editor, 'use_cache')} />}
    </FieldGrid>}
  </>;
}

export function AnthropicToolCards(editor: OptionsEditor) {
  const tools = array(editor.value.tools);
  return <>{(Object.keys(versions) as (keyof typeof versions)[]).map(id => {
    const index = tools.findIndex(raw => {
      const tool = object(raw);
      return typeof tool.type === 'string' && tool.type.startsWith(`${id}_`);
    });
    const tool = object(tools[index]);
    const update = (next?: NativeOptions) => {
      const updated = index < 0 ? (next ? [...tools, next] : tools)
        : tools.flatMap((item, i) => i !== index ? [item] : next ? [next] : []);
      edit(editor, 'tools')(updated.length ? updated : undefined);
    };
    const toolEditor = { value: tool, onChange: update };
    const changeVersion = (type: string = versions[id][0]) => {
      const next: NativeOptions = { ...tool, type, name: toolName(id, type) };
      update({ ...next,
        ...(id === 'text_editor' && type !== 'text_editor_20250728' && { max_characters: undefined }),
        ...((id === 'web_fetch' || id === 'web_search') && type !== versions[id][0] && { response_inclusion: undefined }),
        ...(id === 'web_fetch' && !['web_fetch_20260318', 'web_fetch_20260309'].includes(type) && { use_cache: undefined }),
      });
    };
    return <OptionalCard key={id} title={titles[id]} enabled={index >= 0} onToggle={enabled => update(enabled ? {
      name: toolName(id, versions[id][0]), type: versions[id][0],
      ...(id === 'advisor' ? { model: advisorModels[0] } : { allowed_callers: ['direct'] }),
      ...((id === 'web_fetch' || id === 'web_search') && { max_uses: 5 }),
      ...(id === 'web_fetch' && { citations: { enabled: true } }),
    } : undefined)}>
      {id === 'advisor' ? <>
        <Choice label="Advisor model" choices={advisorModels} value={tool.model} onChange={model => edit(toolEditor, 'model')(model ?? advisorModels[0])} />
        <FieldGrid>
          <Integer label="Maximum uses" min={1} value={tool.max_uses} onChange={edit(toolEditor, 'max_uses')} />
          <Integer label="Advisor maximum tokens" min={1024} value={tool.max_tokens} onChange={edit(toolEditor, 'max_tokens')} />
        </FieldGrid>
        <ToolCache editor={toolEditor} field="caching" label="Advisor caching" />
      </> : <>
        <Choice label="Tool version" value={tool.type} choices={versions[id]} onChange={changeVersion} />
        <AllowedCallers editor={toolEditor} />
        <FieldGrid>
          <BooleanChoice label="Deferred loading" value={tool.defer_loading} onChange={edit(toolEditor, 'defer_loading')} />
          <BooleanChoice label="Strict validation" value={tool.strict} onChange={edit(toolEditor, 'strict')} />
        </FieldGrid>
        <ToolCache editor={toolEditor} field="cache_control" label="Tool cache control" />
        {(id === 'bash' || id === 'memory' || id === 'text_editor') &&
          <JsonField label="Input examples" value={tool.input_examples} shape="array" onChange={edit(toolEditor, 'input_examples')} />}
        {id === 'text_editor' && tool.type === 'text_editor_20250728' &&
          <Integer label="Maximum characters" min={1} value={tool.max_characters} onChange={edit(toolEditor, 'max_characters')} />}
        {(id === 'web_search' || id === 'web_fetch') && <WebToolFields id={id} editor={toolEditor} />}
      </>}
    </OptionalCard>;
  })}</>;
}

function AllowedCallers({ editor }: { editor: OptionsEditor }) {
  const { t } = useAppTranslation();
  const selected = array(editor.value.allowed_callers);
  return <fieldset className="chat-tool-switches"><legend>{t('Allowed callers')}</legend>
    {['direct', ...versions.code_execution].map(caller => <Toggle key={caller} label={caller} checked={selected.includes(caller)}
      onChange={enabled => {
        const next = enabled ? [...selected, caller] : selected.filter(value => value !== caller);
        edit(editor, 'allowed_callers')(next.length ? next : undefined);
      }} />)}
  </fieldset>;
}
