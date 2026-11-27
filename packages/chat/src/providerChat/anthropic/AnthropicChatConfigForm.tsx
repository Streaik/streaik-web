import { useState } from 'react';
import { Card, Choice, FieldGrid, Integer, ListField, Text, Toggle } from '../fields';
import type { OptionsEditor, ProviderFormProps } from '../fields';
import { nativeObject } from '../settings';
import type { NativeOptions } from '../settings';
import { anthropicBetas, anthropicChatHeaders, anthropicDefaults } from './options';
import { array, CacheFields, edit, JsonField, object, OptionalCard, section } from './fields';
import { AnthropicToolCards } from './tools';
import { AnthropicContextManagement } from './ContextManagement';

const betaOptions = [
  'mcp-client-2025-11-20', 'interleaved-thinking-2025-05-14', anthropicBetas.contextManagement,
  'model-context-window-exceeded-2025-08-26', 'fast-mode-2026-02-01', 'mid-conversation-tool-changes-2026-07-01',
  'managed-agents-2026-04-01', 'task-budgets-2026-03-13', 'server-side-fallback-2026-07-01', anthropicBetas.advisor,
  'cache-diagnosis-2026-04-07', 'thinking-display-updates-2026-08-18', 'mid-conversation-system-clear-at-2026-08-21',
  'mid-conversation-output-config-2026-07-01', 'thinking-binding-controls-2026-08-01', anthropicBetas.compaction,
  'inline-tools-2026-09-15',
].sort();

const thinkingChoices = { adaptive: 'Adaptive', enabled: 'Enabled', disabled: 'Disabled', between_tools: 'Between tools' };

function Thinking(editor: OptionsEditor) {
  const thinking = section(editor, 'thinking');
  const binding = section(thinking, 'block_binding');
  const type = thinking.value.type;
  return <OptionalCard title="Thinking" enabled={!!editor.value.thinking}
    onToggle={enabled => edit(editor, 'thinking')(enabled ? { type: 'adaptive' } : undefined)}>
    <Choice label="Thinking mode" choices={thinkingChoices} value={type} onChange={(next = 'adaptive') => {
      const { budget_tokens, display, block_binding, ...rest } = thinking.value;
      thinking.onChange({ ...rest, type: next,
        ...(next === 'enabled' && { budget_tokens: budget_tokens ?? 1024 }),
        ...(next !== 'disabled' && display !== undefined && { display }),
        ...((next === 'adaptive' || next === 'enabled') && block_binding !== undefined && { block_binding }),
      });
    }} />
    <FieldGrid>
      {type !== 'disabled' && <Choice label="Thinking display" value={thinking.value.display}
        choices={{ summarized: 'Summarized', omitted: 'Omitted', updates: 'Updates' }} onChange={edit(thinking, 'display')} />}
      {(type === 'enabled' || type === 'adaptive') && <Choice label="Thinking block prefix mismatch" value={binding.value.prefix_mismatch_behavior}
        choices={{ error: 'Error', drop_block: 'Drop block' }} onChange={edit(binding, 'prefix_mismatch_behavior')} />}
      {type === 'enabled' && <Integer label="Thinking budget" min={1024} value={thinking.value.budget_tokens}
        onChange={value => edit(thinking, 'budget_tokens')(value ?? 1024)} />}
    </FieldGrid>
  </OptionalCard>;
}

function Output(editor: OptionsEditor) {
  const output = section(editor, 'output_config');
  const budget = object(output.value.task_budget);
  return <OptionalCard title="Output" enabled={!!editor.value.output_config}
    onToggle={enabled => edit(editor, 'output_config')(enabled ? { effort: 'medium' } : undefined)}>
    <FieldGrid>
      <Choice label="Effort" choices={{ low: 'Low', medium: 'Medium', high: 'High', xhigh: 'Extra high', max: 'Maximum' }}
        value={output.value.effort} onChange={edit(output, 'effort')} />
      <Integer label="Task budget" min={1} value={budget.total}
        onChange={total => edit(output, 'task_budget')(total === undefined ? undefined : { ...budget, type: 'tokens', total })} />
    </FieldGrid>
    <JsonField label="Output format" value={output.value.format} shape="object" onChange={edit(output, 'format')} />
  </OptionalCard>;
}

function Container(editor: OptionsEditor) {
  const container = typeof editor.value.container === 'string' ? { id: editor.value.container } : object(editor.value.container);
  const skills = array(container.skills);
  const update = (next: NativeOptions) => edit(editor, 'container')(next);
  const updateSkills = (next: typeof skills) => update({ ...container, skills: next.length ? next : undefined });
  return <OptionalCard title="Container" enabled={editor.value.container != null}
    onToggle={enabled => edit(editor, 'container')(enabled ? {} : undefined)}>
    <Text label="Container ID" value={container.id} onChange={id => update({ ...container, id })} />
    <ListField label="Custom skill IDs" value={skills.filter(raw => object(raw).type === 'custom').map(raw => object(raw).skill_id ?? '')}
      onChange={ids => updateSkills([
        ...skills.filter(raw => object(raw).type !== 'custom'),
        ...(ids ?? []).map(skill_id => skills.find(raw => object(raw).type === 'custom' && object(raw).skill_id === skill_id)
          ?? { type: 'custom', skill_id }),
      ])} />
    <div className="chat-tool-switches">
      {Object.entries({ pptx: 'PowerPoint', xlsx: 'Excel', docx: 'Word', pdf: 'PDF' }).map(([id, label]) => {
        const match = (raw: unknown) => object(raw).type === 'anthropic' && object(raw).skill_id === id;
        return <Toggle key={id} label={label} checked={skills.some(match)} onChange={enabled => updateSkills(enabled
          ? [...skills, { type: 'anthropic', skill_id: id, version: 'latest' }] : skills.filter(raw => !match(raw)))} />;
      })}
    </div>
  </OptionalCard>;
}

function SessionBudget(editor: OptionsEditor) {
  const budget = object(editor.value.budget);
  const cost = object(budget.max_list_cost);
  const [on, setOn] = useState(editor.value.budget != null);
  const [draft, setDraft] = useState<string>();
  const amount = typeof cost.amount === 'string' && /^\d+$/.test(cost.amount) ? BigInt(cost.amount) : undefined;
  const dollars = amount === undefined ? undefined : `${amount / 100n}.${String(amount % 100n).padStart(2, '0')}`;
  return <OptionalCard title="Session budget" enabled={on}
    onToggle={enabled => { setOn(enabled); if (!enabled) { setDraft(undefined); edit(editor, 'budget')(); } }}>
    <Text label="Maximum list cost (USD)" value={draft ?? dollars} onChange={value => {
      setDraft(value ?? '');
      if (!value) { edit(editor, 'budget')(); return; }
      const match = /^(\d+)(?:\.(\d{0,2}))?$/.exec(value.trim());
      if (!match) return;
      const cents = BigInt(match[1]) * 100n + BigInt((match[2] ?? '').padEnd(2, '0'));
      if (cents > 0n) edit(editor, 'budget')({ ...budget, type: 'limit', max_list_cost: { ...cost, amount: String(cents), currency: 'USD' } });
    }} />
  </OptionalCard>;
}

const splitBetas = (value: unknown) => typeof value === 'string' ? value.split(',').map(item => item.trim()).filter(Boolean) : [];

function Headers(editor: OptionsEditor) {
  const { value } = editor;
  const selected = splitBetas(value['anthropic-beta']);
  const required = splitBetas(anthropicChatHeaders({}, value)['anthropic-beta']);
  const managed = new Set([...betaOptions, ...required]);
  const toggleBeta = (beta: string, enabled: boolean) => {
    const next = (enabled ? [...selected, beta] : selected.filter(item => item !== beta)).join(',') || undefined;
    if (beta === anthropicBetas.compaction && enabled && object(value.compaction).type !== 'summarize') {
      editor.onChange({ ...value, 'anthropic-beta': next, compaction: { type: 'summarize' } });
    } else edit(editor, 'anthropic-beta')(next);
  };
  return <>
    <Card title="Provider headers">
      <Choice label="Anthropic API version" choices={['2026-10-21', '2023-06-01']}
        value={value['anthropic-version'] ?? anthropicDefaults['anthropic-version']} onChange={edit(editor, 'anthropic-version')} />
      <Text label="Custom Anthropic API version" value={value['anthropic-version']} onChange={edit(editor, 'anthropic-version')} />
    </Card>
    <Card title="Anthropic beta headers">
      <div className="chat-tool-switches">
        {[...managed].map(beta => <Toggle key={beta} label={beta} checked={required.includes(beta) || selected.includes(beta)}
          disabled={required.includes(beta) || (beta === anthropicBetas.compaction && array(object(value.context_management).edits).length > 0)}
          onChange={enabled => toggleBeta(beta, enabled)} />)}
      </div>
      <ListField label="Additional beta headers" value={selected.filter(beta => !managed.has(beta))}
        onChange={betas => edit(editor, 'anthropic-beta')([...selected.filter(beta => managed.has(beta)), ...(betas ?? [])].join(',') || undefined)} />
    </Card>
  </>;
}

export function AnthropicChatConfigForm({ value, onChange }: ProviderFormProps) {
  const editor = { value, onChange };
  const compaction = object(value.compaction);
  const contextEdits = array(object(value.context_management).edits);
  const { 'anthropic-version': version, 'anthropic-beta': betas, ...body } = value;
  return <>
    <Integer label="Maximum output tokens" value={value.max_tokens ?? anthropicDefaults.max_tokens} min={1} max={2147483647}
      onChange={edit(editor, 'max_tokens')} />
    <CacheFields {...editor} title="Cache" />
    <OptionalCard title="Context compaction" enabled={compaction.type === 'summarize'} disabled={contextEdits.length > 0}
      onToggle={enabled => onChange({ ...value, compaction: enabled ? { ...compaction, type: 'summarize' } : undefined,
        ...(!enabled && { 'anthropic-beta': splitBetas(betas).filter(beta => beta !== anthropicBetas.compaction).join(',') || undefined }),
      })}>
      <Text label="Compaction instructions" multiline value={compaction.instructions} onChange={edit(section(editor, 'compaction'), 'instructions')} />
    </OptionalCard>
    <Thinking {...editor} />
    <Output {...editor} />
    <Container {...editor} />
    <AnthropicToolCards {...editor} />
    <AnthropicContextManagement {...editor} />
    <SessionBudget {...editor} />
    <Card title="Other Anthropic options">
      <FieldGrid>
        <Choice label="Speed" choices={{ standard: 'Standard', fast: 'Fast' }} value={value.speed} onChange={edit(editor, 'speed')} />
        <Choice label="Service tier" choices={{ auto: 'Automatic', standard_only: 'Standard only' }}
          value={value.service_tier} onChange={edit(editor, 'service_tier')} />
        <Choice label="Inference geography" choices={{ global: 'Global', us: 'United States' }}
          value={value.inference_geo} onChange={edit(editor, 'inference_geo')} />
      </FieldGrid>
    </Card>
    <Headers {...editor} />
    <Card title="Advanced Anthropic options">
      <JsonField label="Native Messages body options (JSON)" shape="object" value={Object.keys(body).length ? body : undefined}
        onChange={next => onChange({ ...nativeObject(next), ...(version !== undefined && { 'anthropic-version': version }),
          ...(betas !== undefined && { 'anthropic-beta': betas }) })} />
    </Card>
  </>;
}
