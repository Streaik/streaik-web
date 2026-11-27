import { agentMcpPolicy } from './agentMcpClient';
import { AgentSelectField, AgentSwitch } from './AgentToolControls';
import { mcpPolicyFlags } from './chatModelContext';
import type { McpPolicyFlag } from './chatModelContext';
import { useAppTranslation } from './i18n';

export function McpPolicyCard({ policy, onChange }: {
  policy?: Partial<Record<McpPolicyFlag, unknown>>; onChange?: (flag: McpPolicyFlag, checked: boolean) => void;
}) {
  const { t } = useAppTranslation();
  return <section className="agent-field-group">
    <h3>{t('Policy')}</h3>
    <div className="agent-mcp-columns">{mcpPolicyFlags.map(flag => <AgentSwitch key={flag} label={t(agentMcpPolicy[flag])} checked={policy?.[flag] === true}
      onChange={onChange && (checked => onChange(flag, checked))} />)}</div>
  </section>;
}

const toolValue = (name: string) => `tool:${name}`;

export function McpAllowedToolsField({ available, names, custom, onChange, disabled }: {
  available: readonly string[]; names?: readonly string[]; custom?: boolean; disabled?: boolean;
  onChange: (names: readonly string[] | undefined) => void;
}) {
  const { t } = useAppTranslation();
  // Saved names remain visible if the server no longer advertises them.
  const choices = [...new Set([...available, ...(names ?? [])])].sort();
  const selected = names?.length ? names.map(toolValue) : [names ? 'none' : custom ? 'custom' : 'all'];
  return <AgentSelectField multiple label={t('Allowed tools')} value={selected} disabled={disabled} options={[
    { value: 'all', label: t('All tools') }, { value: 'none', label: t('No tools') },
    ...(selected.includes('custom') ? [{ value: 'custom', label: t('Custom filter') }] : []),
    ...choices.map(name => ({ value: toolValue(name), label: name })),
  ]} onValueChange={next => {
    if (next.includes('all') && !selected.includes('all')) onChange(undefined);
    else if (next.includes('none') && !selected.includes('none')) onChange([]);
    else {
      const picked = next.filter(value => value.startsWith('tool:')).map(value => value.slice('tool:'.length));
      // Toggling the current All/No/Custom mode does not change the allowlist.
      if (picked.length || names?.length) onChange(picked);
    }
  }} />;
}

export function McpApprovalField({ approval, onChange, disabled }: {
  approval?: unknown; onChange: (approval: 'always' | 'never' | undefined) => void; disabled?: boolean;
}) {
  const { t } = useAppTranslation();
  const value = approval === 'always' || approval === 'never' ? approval : approval == null ? 'default' : 'custom';
  return <AgentSelectField label={t('Require approval')} value={value} disabled={disabled} options={[
    { value: 'default', label: t('Default') }, { value: 'always', label: t('Always') }, { value: 'never', label: t('Never') },
    ...(value === 'custom' ? [{ value: 'custom', label: t('Custom filter') }] : []),
  ]} onValueChange={next => {
    if (next !== 'custom') onChange(next === 'always' || next === 'never' ? next : undefined);
  }} />;
}
