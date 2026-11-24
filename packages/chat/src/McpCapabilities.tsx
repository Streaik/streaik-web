import { Button } from '@streaik/themes';
import { useEffect, useState } from 'react';
import { useAppTranslation } from './i18n';
import { discoverMcpCapabilities, expandMcpResource, mcpTemplateSlots, readMcpCapability } from './mcp';
import type { McpServer } from './mcp';

type Field = { name: string; description?: string; required?: boolean };
type Entry = { label: string; description?: string; fields: Field[]; read: (values: Record<string, string>) => Parameters<typeof readMcpCapability>[1] };

export function McpCapabilities({ server }: { server: McpServer }) {
  const { t } = useAppTranslation();
  const [entries, setEntries] = useState<Entry[]>();
  const [choice, setChoice] = useState(0);
  const [request, setRequest] = useState<Parameters<typeof readMcpCapability>[1]>();
  const [text, setText] = useState<string>();
  const [error, setError] = useState('');

  useEffect(() => {
    const controller = new AbortController();
    void discoverMcpCapabilities(server, controller.signal).then(({ resources, resourceTemplates, prompts }) => {
      if (controller.signal.aborted) return;
      setEntries([
        ...resources.map(resource => ({ label: resource.title || resource.name, description: resource.description, fields: [], read: () => ({ uri: resource.uri }) })),
        ...resourceTemplates.flatMap(template => {
          const slots = mcpTemplateSlots(template.uriTemplate);
          return slots ? [{ label: template.title || template.name, description: template.description,
            fields: slots.map(name => ({ name, required: true })),
            read: (values: Record<string, string>) => ({ uri: expandMcpResource(template.uriTemplate, values) }) }] : [];
        }),
        ...prompts.map(prompt => ({ label: prompt.title || prompt.name, description: prompt.description, fields: prompt.arguments ?? [],
          read: (values: Record<string, string>) => ({ name: prompt.name, arguments: values }) })),
      ]);
    }, () => { if (!controller.signal.aborted) setError('Could not list resources and prompts.'); });
    return () => controller.abort();
  }, [server]);

  useEffect(() => {
    if (!request) return;
    const controller = new AbortController();
    void readMcpCapability(server, request, controller.signal).then(result => {
      if (!controller.signal.aborted) setText(result);
    }, () => { if (!controller.signal.aborted) setError('Could not read this item. Check access and try again.'); }).finally(() => {
      if (!controller.signal.aborted) setRequest(undefined);
    });
    return () => controller.abort();
  }, [request, server]);

  const item = entries?.[choice];
  return <section className="chat-settings-section mcp-form">
    {!entries && !error && <p role="status">{t('Loading resources and prompts…')}</p>}
    {entries?.length === 0 && <p>{t('This server has no compatible resources or prompts.')}</p>}
    {entries && item && <>
      <label>{t('Resource or prompt')}<select value={choice} disabled={!!request} onChange={event => {
        setChoice(Number(event.target.value)); setText(undefined); setError('');
      }}>{entries.map((entry, index) => <option key={index} value={index}>{entry.label}</option>)}</select></label>
      {item.description && <p>{item.description}</p>}
      <form key={choice} className="mcp-form" onSubmit={event => {
        event.preventDefault(); setText(undefined); setError('');
        const values = Object.fromEntries([...new FormData(event.currentTarget)].filter((entry): entry is [string, string] => typeof entry[1] === 'string' && !!entry[1]));
        try { setRequest(item.read(values)); }
        catch { setError('Check the values and try again.'); }
      }}>
        {item.fields.map(field => <label key={field.name}>{field.name}{field.description && <small>{field.description}</small>}
          <input name={field.name} required={field.required} maxLength={2048} autoComplete="off" disabled={!!request} /></label>)}
        <Button type="submit" variant="primary" disabled={!!request}>{t(request ? 'Reading…' : 'Read')}</Button>
      </form>
    </>}
    {error && <p role="alert" className="chat-error">{t(error)}</p>}
    {text !== undefined && (text ? <pre className="mcp-resource-result">{text}</pre> : <p>{t('This item returned no text.')}</p>)}
  </section>;
}
