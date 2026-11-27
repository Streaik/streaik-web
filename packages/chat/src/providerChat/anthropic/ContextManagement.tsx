import { Button } from '@streaik/themes';
import { useAppTranslation } from '../../i18n';
import { Card, Choice, FieldGrid, Integer, ListField, Text } from '../fields';
import type { OptionsEditor } from '../fields';
import type { NativeOptions, NativeValue } from '../settings';
import { array, BooleanChoice, edit, object, section } from './fields';

const editTypes = {
  clear_tool_uses_20250919: 'Clear tool uses',
  clear_thinking_20251015: 'Clear thinking',
  compact_20260112: 'Compact context',
};
const inputTokens = { input_tokens: 'Input tokens' };
const toolUses = { tool_uses: 'Tool uses' };
const newEdit = (type = 'clear_tool_uses_20250919'): NativeOptions => type === 'clear_thinking_20251015'
  ? { type, keep: { type: 'thinking_turns', value: 1 } }
  : { type, trigger: { type: 'input_tokens', value: type === 'compact_20260112' ? 150000 : 10000 } };

function CountField({ editor, name, label, types, initial, min = 1 }: {
  editor: OptionsEditor; name: string; label: string; types: Record<string, string>; initial: number; min?: number;
}) {
  const value = object(editor.value[name]);
  return <FieldGrid>
    <Choice label={label} value={value.type} choices={types}
      onChange={type => edit(editor, name)(type ? { ...value, type, value: value.value ?? initial } : undefined)} />
    {typeof value.type === 'string' && <Integer label={`${label} count`} value={value.value} min={min}
      onChange={next => edit(editor, name)(next === undefined ? undefined : { ...value, value: next })} />}
  </FieldGrid>;
}

function EditFields(editor: OptionsEditor) {
  const { value } = editor;
  if (value.type === 'clear_tool_uses_20250919') {
    const clear = value.clear_tool_inputs;
    return <>
      <CountField editor={editor} name="trigger" label="Trigger" types={{ ...inputTokens, ...toolUses }} initial={10000} />
      <CountField editor={editor} name="keep" label="Keep" types={toolUses} initial={3} min={0} />
      <CountField editor={editor} name="clear_at_least" label="Clear at least" types={inputTokens} initial={5000} min={0} />
      <Choice label="Clear tool inputs" value={Array.isArray(clear) ? 'list' : typeof clear === 'boolean' ? 'boolean' : undefined}
        choices={{ boolean: 'Boolean', list: 'Tool list' }}
        onChange={next => edit(editor, 'clear_tool_inputs')(next === 'list' ? [] : next === 'boolean' ? true : undefined)} />
      {Array.isArray(clear) ? <ListField label="Tool inputs to clear" value={clear} onChange={next => edit(editor, 'clear_tool_inputs')(next ?? [])} />
        : typeof clear === 'boolean' && <BooleanChoice label="Clear tool inputs value" value={clear} onChange={edit(editor, 'clear_tool_inputs')} />}
      <ListField label="Excluded tools" value={value.exclude_tools} onChange={edit(editor, 'exclude_tools')} />
    </>;
  }
  if (value.type === 'clear_thinking_20251015') {
    const keep = object(value.keep);
    return <FieldGrid>
      <Choice label="Keep" value={value.keep === 'all' ? 'all_literal' : keep.type === 'all' ? 'all_object' : keep.type}
        choices={{ thinking_turns: 'Thinking turns', all_object: 'All (object)', all_literal: 'All (literal)' }}
        onChange={mode => edit(editor, 'keep')(mode === 'all_literal' ? 'all' : mode === 'all_object' ? { type: 'all' }
          : mode === 'thinking_turns' ? { type: 'thinking_turns', value: keep.value ?? 1 } : undefined)} />
      {keep.type === 'thinking_turns' && <Integer label="Keep count" min={0} value={keep.value}
        onChange={next => edit(editor, 'keep')(next === undefined ? undefined : { ...keep, value: next })} />}
    </FieldGrid>;
  }
  if (value.type === 'compact_20260112') return <>
    <CountField editor={editor} name="trigger" label="Trigger" types={inputTokens} initial={150000} />
    <BooleanChoice label="Pause after compaction" value={value.pause_after_compaction} onChange={edit(editor, 'pause_after_compaction')} />
    <Text label="Compaction instructions" multiline value={value.instructions} onChange={edit(editor, 'instructions')} />
  </>;
  return null;
}

export function AnthropicContextManagement(editor: OptionsEditor) {
  const { t } = useAppTranslation();
  const context = section(editor, 'context_management');
  const edits = array(context.value.edits);
  const update = (next: readonly NativeValue[]) => editor.onChange({ ...editor.value,
    context_management: next.length ? { ...context.value, edits: next } : undefined,
    ...(next.length && { compaction: undefined }),
  });
  const move = (from: number, to: number) => {
    const next = [...edits];
    [next[from], next[to]] = [next[to], next[from]];
    update(next);
  };
  return <Card title="Context management">
    {edits.map((entry, i) => {
      const value = object(entry);
      const replace = (next: NativeOptions) => update(edits.map((old, j) => i === j ? next : old));
      return <fieldset key={i} className="chat-provider-fields"><legend>{t('Context edit')} {i + 1}</legend>
        <Choice label="Edit type" value={value.type} choices={editTypes} onChange={type => replace(newEdit(type))} />
        <EditFields key={String(value.type)} value={value} onChange={replace} />
        <div>
          <Button variant="subtle" disabled={i === 0} onClick={() => move(i, i - 1)}>{t('Move up')}</Button>
          <Button variant="subtle" disabled={i === edits.length - 1} onClick={() => move(i, i + 1)}>{t('Move down')}</Button>
          <Button variant="subtle" onClick={() => update(edits.filter((_, j) => i !== j))}>{t('Remove edit')}</Button>
        </div>
      </fieldset>;
    })}
    <div><Button variant="subtle" onClick={() => update([...edits, newEdit()])}>{t('Add context edit')}</Button></div>
  </Card>;
}
