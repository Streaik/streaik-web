import { Card, Choice, FieldGrid, Integer, ListField, Text, Toggle, setOption } from '../fields';
import type { OptionsEditor } from '../fields';
import type { NativeOptions, NativeValue } from '../settings';
import { efforts, list, object, toggleInclude, typedItem, updateTypedItem } from './options';

function Include({ value, onChange, name, label }: OptionsEditor & { name: string; label: string }) {
  return <Toggle label={label} checked={list(value.include).includes(name)}
    onChange={on => onChange(setOption(value, 'include', toggleInclude(value.include, name, on)))} />;
}

export function HostedTools(props: OptionsEditor) {
  const { value, onChange } = props;
  const tool = (kind: string) => typedItem(value.tools, kind);
  const set = (kind: string, next?: NativeOptions) => onChange(setOption(value, 'tools', updateTypedItem(value.tools, kind, next)));
  const patch = (kind: string, key: string, next?: NativeValue) => set(kind, setOption(tool(kind) ?? {}, key, next));
  const web = tool('web_search');
  const filters = object(web?.filters);
  const location = object(web?.user_location);
  const imageSettings = object(web?.image_settings);
  const contentTypes = list(web?.search_content_types);
  const enabledContent = contentTypes.length ? contentTypes : ['text'];
  const image = tool('image_generation');
  const svg = object(image?.svg);
  const file = tool('file_search');
  return <>
    <Card title="Web search">
      <Toggle label="Web search" checked={!!web} onChange={on => set('web_search', on ? { search_context_size: 'medium' } : undefined)} />
      {web && <>
        <FieldGrid>
          <Choice label="Search context size" value={web.search_context_size} choices={['low', 'medium', 'high']}
            onChange={next => patch('web_search', 'search_context_size', next)} />
          <Choice label="Return token budget" value={web.return_token_budget} choices={['unlimited']}
            onChange={next => patch('web_search', 'return_token_budget', next)} />
        </FieldGrid>
        <ListField label="Allowed web domains" value={filters.allowed_domains} onChange={domains => {
          const next = setOption(filters, 'allowed_domains', domains);
          patch('web_search', 'filters', Object.keys(next).length ? next : undefined);
        }} />
        <FieldGrid>
          {([['country', 'Country'], ['region', 'Region'], ['city', 'City'], ['timezone', 'Time zone']] as const).map(([key, label]) =>
            <Text key={key} label={label} value={location[key]} onChange={next => {
              const updated = setOption(location, key, next);
              patch('web_search', 'user_location', Object.keys(updated).some(key => key !== 'type') ? { type: 'approximate', ...updated } : undefined);
            }} />)}
        </FieldGrid>
        <Toggle label="External web access" checked={web.external_web_access !== false}
          onChange={on => patch('web_search', 'external_web_access', on ? undefined : false)} />
        <FieldGrid>
          <Include {...props} name="web_search_call.action.sources" label="Include web sources" />
          <Include {...props} name="web_search_call.results" label="Include web search results" />
          {(['text', 'image'] as const).map(type => <Toggle key={type} label={type === 'text' ? 'Search text' : 'Search images'}
            checked={enabledContent.includes(type)} disabled={enabledContent.length === 1 && enabledContent.includes(type)} onChange={on => {
              const next = on ? [...enabledContent, type] : enabledContent.filter(item => item !== type);
              const updated = setOption(web, 'search_content_types', next.length === 1 && next[0] === 'text' ? undefined : next);
              set('web_search', setOption(updated, 'image_settings', next.includes('image') ? web.image_settings : undefined));
            }} />)}
        </FieldGrid>
        {enabledContent.includes('image') && <FieldGrid>
          <Integer label="Maximum image search results" value={imageSettings.max_results} min={1}
            onChange={next => patch('web_search', 'image_settings', setOption(imageSettings, 'max_results', next))} />
          <Toggle label="Include image captions" checked={imageSettings.caption === true}
            onChange={on => patch('web_search', 'image_settings', { ...imageSettings, caption: on })} />
        </FieldGrid>}
      </>}
    </Card>
    <Card title="Image generation">
      <Toggle label="Image generation" checked={!!image} onChange={on => set('image_generation', on ? {} : undefined)} />
      {image && <>
        <FieldGrid>
          {([
            ['model', 'Image model', ['gpt-image-2.6-sunburst', 'gpt-image-2.6-flare', 'gpt-image-2.5-sunburst', 'gpt-image-2.5-flare', 'gpt-image-2']],
            ['action', 'Image action', ['auto', 'generate', 'edit']],
            ['quality', 'Image quality', ['auto', 'low', 'medium', 'high', 'xhigh', 'max']],
            ['moderation', 'Image moderation', ['auto', 'low']],
            ['background', 'Image background', ['auto', 'transparent', 'opaque']],
            ['size', 'Image size', ['auto', '1024x1024', '1024x1536', '1536x1024']],
            ['output_format', 'Image output format', ['png', 'jpeg', 'webp', 'gif', 'svg']],
          ] as const).map(([key, label, choices]) => <Choice key={key} label={label} value={image[key]} choices={choices}
            onChange={next => patch('image_generation', key, next)} />)}
          <Integer label="Partial images" value={image.partial_images} min={0} max={3} onChange={next => patch('image_generation', 'partial_images', next)} />
          <Integer label="Image output compression" value={image.output_compression} min={0} max={100}
            onChange={next => patch('image_generation', 'output_compression', next)} />
          <Choice label="Image complexity" value={image.complexity} choices={['low', 'medium', 'high']}
            onChange={next => patch('image_generation', 'complexity', next)} />
        </FieldGrid>
        {image.output_format === 'gif' && <FieldGrid>
          <Integer label="Frame count" value={image.frame_count} min={1} onChange={next => patch('image_generation', 'frame_count', next)} />
          <Integer label="Frame duration (ms)" value={image.frame_duration_ms} min={1}
            onChange={next => patch('image_generation', 'frame_duration_ms', next)} />
        </FieldGrid>}
        <Toggle label="Configure SVG generation" checked={!!image.svg} onChange={on => patch('image_generation', 'svg', on ? {} : undefined)} />
        {!!image.svg && <FieldGrid>
          <Text label="SVG model" value={svg.model} onChange={next => patch('image_generation', 'svg', setOption(svg, 'model', next))} />
          <Choice label="SVG reasoning effort" value={object(svg.reasoning).effort} choices={efforts}
            onChange={effort => patch('image_generation', 'svg', setOption(svg, 'reasoning',
              effort ? { ...object(svg.reasoning), effort } : undefined))} />
        </FieldGrid>}
      </>}
    </Card>
    <Card title="File search">
      <Toggle label="File search" checked={!!file}
        onChange={on => set('file_search', on ? { max_num_results: 10, vector_store_ids: [] } : undefined)} />
      {file && <>
        <ListField label="File search vector store IDs (one per line)" value={file.vector_store_ids}
          onChange={next => patch('file_search', 'vector_store_ids', next ?? [])} />
        <FieldGrid>
          <Integer label="Maximum file search results" value={file.max_num_results} min={1} max={50}
            onChange={next => patch('file_search', 'max_num_results', next)} />
          <Include {...props} name="file_search_call.results" label="Include file search results" />
        </FieldGrid>
      </>}
    </Card>
  </>;
}
