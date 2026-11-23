import { Button, Tooltip } from '@streaik/themes';
import type { IconName } from '@streaik/themes';
import type { CatalogModel } from '@streaik/gateway';
import { useId, useState } from 'react';
import type { ReactNode } from 'react';
import { CatalogMark } from './CatalogMark';
import { ChatIcon } from './ChatIcon';
import directory from './provider-directory.json';
import { browserNumberFormat, useAppTranslation } from './i18n';

const pageSize = 48;
const number = browserNumberFormat();
const providerLinks = [
  ['homepage', 'website', 'Website'], ['docs', 'docs', 'Docs'], ['pricing', 'pricing', 'Pricing'],
  ['termsOfService', 'terms', 'Terms'], ['privacyPolicy', 'privacy', 'Privacy'], ['console', 'console', 'Console'],
] as const;
type Provider = {
  id: string; name: string; description?: string; category?: string; country?: string; regions?: string[];
  urls?: Partial<Record<typeof providerLinks[number][0], string>>;
};
const providers: Provider[] = [...directory.providers].sort((a, b) => a.name.localeCompare(b.name));
const providerNames = new Map(providers.map(({ id, name }) => [id, name]));
export const providerName = (id: string) => providerNames.get(id) ?? id;
const categories = new Map([
  ['model_provider', 'Model builder'], ['gateway_router', 'Gateway'], ['inference_compute', 'Inference & compute'],
  ['media_voice', 'Media & voice'], ['search_data', 'Search & data'], ['app_tools', 'Apps & tools'],
]);
const otherType = ['Other', 'shapes'] as const;
const types = new Map<string, readonly [label: string, icon: IconName]>([
  ['language', ['Language', 'language']], ['image', ['Image', 'images']], ['decision', ['Decision', 'decision']],
  ['reranking', ['Reranking', 'ranking']], ['realtime', ['Realtime', 'realtime']], ['speech', ['Speech', 'mic']],
  ['transcription', ['Transcription', 'transcription']], ['video', ['Video', 'videos']], ['embedding', ['Embedding', 'embedding']],
  ['audio', ['Audio', 'audio']], ['moderation', ['Moderation', 'moderation']], ['other', otherType],
]);
const modelType = (model: CatalogModel) => model.type && types.has(model.type) ? model.type : 'other';
const sortedValues = (values: string[], label = (value: string) => value, language?: string) =>
  [...new Set(values.filter(Boolean))].sort((a, b) => label(a).localeCompare(label(b), language));
const regionOptions = sortedValues(providers.flatMap(p => p.regions ?? []));

function CatalogHeader({ title, children }: { title: string; children: ReactNode }) {
  const { t } = useAppTranslation();
  return <header className="catalog-heading"><span>{t('Artificial Intelligence')}</span><h1>{title}</h1><p>{children}</p></header>;
}

function Search({ label, value, change }: { label: string; value: string; change: (value: string) => void }) {
  const { t } = useAppTranslation();
  const id = useId();
  return <div className="catalog-field"><label htmlFor={id}>{label}</label>
    <input id={id} type="search" value={value} placeholder={t('Search…')} onChange={event => change(event.currentTarget.value)} />
  </div>;
}

function Filter({ label, all, value, options, change, display = (value: string) => value }: {
  label: string; all: string; value: string; options: string[]; change: (value: string) => void; display?: (value: string) => string;
}) {
  const id = useId();
  return <div className="catalog-field"><label htmlFor={id}>{label}</label>
    <select id={id} value={value} onChange={event => change(event.currentTarget.value)}>
      <option value="">{all}</option>
      {options.map(item => <option key={item} value={item}>{display(item)}</option>)}
    </select>
  </div>;
}

function CardGrid<T>({ items, render, empty }: { items: T[]; render: (item: T) => ReactNode; empty: string }) {
  const { t } = useAppTranslation();
  const [limit, setLimit] = useState(pageSize);
  return items.length ? <>
    <div className="catalog-grid">{items.slice(0, limit).map(render)}</div>
    {items.length > limit && <Button className="catalog-more" onClick={() => setLimit(n => n + pageSize)}>{t('Show more')}</Button>}
  </> : <p className="catalog-empty" role="status">{empty}</p>;
}

function TokenBadge({ icon, count, label }: { icon: IconName; count: number; label: string }) {
  return <Tooltip content={label} visualOnly><span className="catalog-token-badge" role="img" aria-label={label} tabIndex={0}>
    <ChatIcon name={icon} />{number.format(count)}
  </span></Tooltip>;
}

function ModelCard({ model }: { model: CatalogModel }) {
  const { t } = useAppTranslation();
  const provider = providerName(model.provider);
  const [label, icon] = types.get(modelType(model)) ?? otherType;
  return <article className="catalog-card">
    <div className="catalog-card-title"><CatalogMark provider={model.provider} name={provider} /><div>
      <h2>{model.name}</h2><p>{provider}</p>
    </div></div>
    <div className="catalog-id">{model.id}</div>
    {model.description && <p className="catalog-description">{model.description}</p>}
    <div className="catalog-badges">
      <span className="catalog-type-badge"><ChatIcon name={icon} />{t(label)}</span>
      {model.tags.map(tag => <span key={tag} data-realtime={tag === 'realtime' || undefined}>{tag === 'realtime' ? t('Realtime') : tag}</span>)}
      {model.contextWindow ? <TokenBadge icon="contextWindow" count={model.contextWindow}
        label={t('Context window: {{count, number}} tokens', { count: model.contextWindow })} /> : null}
      {model.maxTokens ? <TokenBadge icon="outputLimit" count={model.maxTokens}
        label={t('Maximum output: {{count, number}} tokens', { count: model.maxTokens })} /> : null}
    </div>
  </article>;
}

export function ModelsView({ models, status, refresh }: { models?: CatalogModel[]; status?: string; refresh?: () => void }) {
  const { t } = useAppTranslation();
  const [search, setSearch] = useState('');
  const [provider, setProvider] = useState('');
  const [tab, setTab] = useState('all');
  const id = useId();
  const options = sortedValues((models ?? []).map(model => model.provider), providerName);
  const selectedProvider = options.includes(provider) ? provider : '';
  const query = search.trim().toLowerCase();
  const matching = (models ?? []).filter(model => (!selectedProvider || model.provider === selectedProvider) &&
    (!query || [model.name, model.id, providerName(model.provider), model.description, ...model.tags].some(text => text?.toLowerCase().includes(query))));
  const groups = new Map<string, CatalogModel[]>([['all', matching]]);
  for (const model of matching) {
    const type = modelType(model);
    const keys = type !== 'realtime' && model.tags.includes('realtime') ? [type, 'realtime'] : [type];
    for (const key of keys) {
      const group = groups.get(key);
      if (group) group.push(model);
      else groups.set(key, [model]);
    }
  }
  const available = new Set((models ?? []).map(modelType));
  // Keep the realtime tab discoverable even if the current provider has none.
  available.add('realtime');
  const tabs = [['all', ['All', 'grid']] as const, ...[...types].filter(([key]) => available.has(key))];
  const selected = tabs.some(([key]) => key === tab) ? tab : 'all';
  return <div className="catalog-content">
    <CatalogHeader title={t('Models')}>{models ? t('Explore {{count, number}} models available from your gateway, grouped by capability.', { count: models.length })
      : t('Explore models available from your gateway, grouped by capability.')}</CatalogHeader>
    {status && <p className="catalog-empty" role="status">{status}</p>}
    <div className="catalog-filters">
      <Search label={t('Search models')} value={search} change={setSearch} />
      <Filter label={t('Provider')} all={t('All providers')} value={selectedProvider} options={options} display={providerName} change={setProvider} />
      {refresh && <Button onClick={refresh}>{t('Refresh models')}</Button>}
    </div>
    {models && <>
      <div className="catalog-tabs catalog-model-tabs" role="tablist" aria-label={t('Model capabilities')}>
        {tabs.map(([key, [label, icon]], index) => <button key={key} id={`${id}-${key}`} type="button" role="tab"
          aria-selected={selected === key} aria-controls={`${id}-results`} tabIndex={selected === key ? 0 : -1}
          onClick={() => setTab(key)} onKeyDown={event => {
            const next = ({ ArrowRight: (index + 1) % tabs.length, ArrowLeft: (index - 1 + tabs.length) % tabs.length,
              Home: 0, End: tabs.length - 1 } as Record<string, number>)[event.key];
            if (typeof next !== 'number') return;
            event.preventDefault();
            const nextKey = tabs[next][0];
            setTab(nextKey);
            document.getElementById(`${id}-${nextKey}`)?.focus();
           }}><ChatIcon name={icon} />{t(label)} ({number.format(groups.get(key)?.length ?? 0)})</button>)}
      </div>
      <section id={`${id}-results`} role="tabpanel" aria-labelledby={`${id}-${selected}`} tabIndex={0}>
        <CardGrid key={JSON.stringify([selected, query, selectedProvider])} items={groups.get(selected) ?? []}
          render={model => <ModelCard key={JSON.stringify([model.id, model.type])} model={model} />}
          empty={t(models.length ? 'No models match these filters.' : 'The gateway did not return any models.')} />
      </section>
    </>}
  </div>;
}

function publicLink(value: string | undefined) {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    if (url.protocol === 'https:' && !url.username && !url.password) return url.href;
  } catch { /* Not an absolute URL. */ }
  return undefined;
}

export function ProvidersView({ appName }: { appName: string }) {
  const { t, i18n } = useAppTranslation();
  const language = i18n.resolvedLanguage ?? 'en';
  const countryNames = new Intl.DisplayNames([language], { type: 'region' });
  const countryName = (code: string) => /^[A-Z]{2}$/.test(code) ? countryNames.of(code) ?? code : code;
  const countryOptions = sortedValues(providers.map(p => p.country ?? ''), countryName, language);
  const [search, setSearch] = useState('');
  const [country, setCountry] = useState('');
  const [region, setRegion] = useState('');
  const query = search.trim().toLowerCase();
  const filtered = providers.filter(provider => (!country || provider.country === country) &&
    (!region || provider.regions?.includes(region)) && [provider.name, provider.id, provider.description].some(value => value?.toLowerCase().includes(query)));
  return <div className="catalog-content">
    <CatalogHeader title={t('Providers')}>{t('Browse the {{appName}} directory of {{count, number}} AI providers.', { appName, count: providers.length })}</CatalogHeader>
    <div className="catalog-filters">
      <Search label={t('Search providers')} value={search} change={setSearch} />
      <Filter label={t('Country of origin')} all={t('All countries')} value={country} options={countryOptions} display={countryName} change={setCountry} />
      <Filter label={t('AI region')} all={t('All regions')} value={region} options={regionOptions} display={value => t(value)} change={setRegion} />
    </div>
    <p className="catalog-count" role="status">{t('{{count, number}} providers', { count: filtered.length })}</p>
    <CardGrid key={JSON.stringify([query, country, region])} items={filtered} empty={t('No providers match these filters.')} render={provider =>
      <article className="catalog-card" key={provider.id}>
        <div className="catalog-card-title"><CatalogMark provider={provider.id} name={provider.name} /><div>
          <h2>{provider.name}</h2>{provider.country && <p>{countryName(provider.country)}</p>}
        </div></div>
        {provider.description && <p className="catalog-description">{provider.description}</p>}
        <div className="catalog-badges">
          {provider.category && categories.has(provider.category) && <span>{t(categories.get(provider.category)!)}</span>}
          {provider.regions?.map(area => <Tooltip key={area} content={t('AI region')}><span>{t(area)}</span></Tooltip>)}
        </div>
        <div className="catalog-links">{providerLinks.map(([key, icon, label]) => {
          const href = publicLink(provider.urls?.[key]);
          const name = t('{{provider}} {{link}}', { provider: provider.name, link: t(label).toLocaleLowerCase(language) });
          return href && <Tooltip key={key} content={name}><a href={href} target="_blank" rel="noopener noreferrer" aria-label={name}><ChatIcon name={icon} /></a></Tooltip>;
        })}</div>
      </article>} />
  </div>;
}
