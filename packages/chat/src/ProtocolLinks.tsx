import { Tooltip } from '@streaik/themes';
import { ChatIcon } from './ChatIcon';
import { useAppTranslation } from './i18n';

const protocols = {
  skills: { name: 'Agent Skills', website: 'https://agentskills.io', specification: 'https://agentskills.io/specification' },
  mcp: { name: 'Model Context Protocol', website: 'https://modelcontextprotocol.io/', specification: 'https://modelcontextprotocol.io/specification' },
};

export function ProtocolLinks({ protocol }: { protocol: keyof typeof protocols }) {
  const { t } = useAppTranslation();
  const { name, website, specification } = protocols[protocol];
  const links = [
    [website, 'website', t('{{protocol}} official website', { protocol: name })],
    [specification, 'docs', t('{{protocol}} specification', { protocol: name })],
  ] as const;
  return <div className="catalog-overview-links">
    {links.map(([href, icon, label]) => <Tooltip key={href} content={label}>
      <a href={href} target="_blank" rel="noopener noreferrer" aria-label={label}><ChatIcon name={icon} /></a>
    </Tooltip>)}
  </div>;
}
