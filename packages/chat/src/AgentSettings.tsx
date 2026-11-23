import { Select } from '@streaik/themes';
import type { SelectOption } from '@streaik/themes';
import { useId } from 'react';
import { defaultAgentKey, effectiveRoleAssignment } from './agentCatalog';
import { useAgents } from './AgentsProvider';
import { useAppTranslation } from './i18n';

export function AgentSettings() {
  const { t } = useAppTranslation();
  const store = useAgents();
  const id = useId();
  const roles = store?.config.roles;
  if (!store || !roles?.length) return null;
  const { entries, data, assign, notice } = store;
  const choices = entries.map(({ key, definition }) => ({ value: key, label: definition.name }));

  return <section className="chat-settings-section" aria-labelledby={`${id}-title`}>
    <h3 id={`${id}-title`}>{t('Agents')}</h3>
    {notice && <p role="status">{t(notice)}</p>}
    {roles.map((role, index) => {
      const selectId = `${id}-${index}`;
      const label = t(role.label);
      const selected = effectiveRoleAssignment(data, role);
      const options: SelectOption[] = [{ value: 'none', label: t('None') }];
      if (selected && !choices.some(({ value }) => value === selected)) {
        options.push({ value: selected, label: t('Unavailable agent') });
      }
      options.push(...choices);
      return <div className="appearance-row agent-role" key={role.id}>
        <label htmlFor={selectId}>{label}</label>
        <Select id={selectId} label={label} value={selected ?? 'none'} options={options}
          onValueChange={(value) => {
            if (value === 'none') assign(role, null);
            else {
              const entry = entries.find(({ key }) => key === value);
              if (entry) assign(role, entry.key === defaultAgentKey(role) ? undefined : entry.key);
            }
          }} />
      </div>;
    })}
  </section>;
}
