import { useAppTranslation } from './i18n';
import { toolCallers } from './toolConfiguration';
import type { ToolCaller, ToolOptions } from './toolConfiguration';

export type ToolConfigurationRow = { key: string; label: string; source: string; options: ToolOptions; namespace?: string };
const labels = { direct: 'Direct', programmatic: 'Programmatic' } as const;

export function ToolConfigurationEditor({ rows, onChange, namespaces, disabled }: {
  rows: readonly ToolConfigurationRow[];
  onChange: (keys: readonly string[], patch: ToolOptions) => void;
  namespaces?: { checked: boolean; onChange: (checked: boolean) => void; disabled?: boolean };
  disabled?: boolean;
}) {
  const { t } = useAppTranslation();
  const sorted = [...rows].sort((a, b) => (a.namespace ?? '').localeCompare(b.namespace ?? '') || a.label.localeCompare(b.label));
  const all = t('All tools');
  const allKeys = sorted.map(row => row.key);
  const allCallers = toolCallers.filter(caller => sorted.every(row => row.options.allowed_callers?.includes(caller)));
  function callers(label: string, values: readonly ToolCaller[], keys: readonly string[]) {
    return <details className="tool-config-callers">
      <summary aria-label={t('Usage method for {{tool}}', { tool: label })} aria-disabled={disabled}
        onClick={event => { if (disabled) event.preventDefault(); }}>
        {values.length ? values.map(value => t(labels[value])).join(', ') : t('Select…')}
      </summary>
      <div className="tool-config-options">
        {toolCallers.map(caller => <label key={caller}>
          <input type="checkbox" checked={values.includes(caller)} disabled={disabled} onChange={event => {
            const next = event.currentTarget.checked ? [...values, caller] : values.filter(value => value !== caller);
            onChange(keys, { allowed_callers: next });
          }} /> {t(labels[caller])}
        </label>)}
      </div>
    </details>;
  }
  function search(label: string, checked: boolean, keys: readonly string[]) {
    return <input className="tool-config-switch" type="checkbox" role="switch" checked={checked} disabled={disabled}
      aria-label={t('Search for {{tool}}', { tool: label })} onChange={event => onChange(keys, { defer_loading: event.currentTarget.checked })} />;
  }
  return <div className="tool-config-editor">
    {namespaces && <label className="tool-config-namespaces"><input className="tool-config-switch" type="checkbox" role="switch"
      checked={namespaces.checked} disabled={disabled || namespaces.disabled} onChange={event => namespaces.onChange(event.currentTarget.checked)} />
      {t('Use namespaces')}</label>}
    {!sorted.length ? <p>{t('No tools enabled.')}</p> : <table className="tool-config-table">
      <thead><tr><th scope="col">{t('Tool')}</th><th scope="col">{t('Usage method')}</th><th scope="col">{t('Search')}</th></tr></thead>
      <tbody>
        <tr><th scope="row">{all}</th><td>{callers(all, allCallers, allKeys)}</td>
          <td>{search(all, sorted.every(row => row.options.defer_loading === true), allKeys)}</td></tr>
        {sorted.map((row, index) => <tr key={row.key}>
          <th scope="row">{row.namespace && row.namespace !== sorted[index - 1]?.namespace && <small>{t('Namespace')}: {row.namespace}</small>}
            {row.label}<small>{row.source}</small>
          </th><td>{callers(row.label, row.options.allowed_callers ?? [], [row.key])}</td>
          <td>{search(row.label, row.options.defer_loading === true, [row.key])}</td>
        </tr>)}
      </tbody>
    </table>}
  </div>;
}
