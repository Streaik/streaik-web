import directory from './provider-directory.json' with { type: 'json' };

const providerHomepages = new Map(directory.providers.map(({ id, urls }) => [id.toLowerCase(), urls.homepage]));

export function publicWebUrl(value: string) {
  try {
    const url = new URL(value);
    if ((url.protocol === 'https:' || url.protocol === 'http:') && !url.username && !url.password) return url;
  } catch { /* Not an absolute web URL. */ }
  return undefined;
}

export function websiteFavicon(website: string | undefined) {
  const url = website && publicWebUrl(website);
  if (!url) return undefined;
  // Favicon lookup doesn't need any query parameters or fragments from the website.
  url.search = '';
  url.hash = '';
  return `https://t0.gstatic.com/faviconV2?client=SOCIAL&type=FAVICON&fallback_opts=TYPE,SIZE,URL&url=${encodeURIComponent(url.href)}&size=128`;
}

export function providerFavicon(provider: string) {
  const id = provider.toLowerCase();
  const homepage = providerHomepages.get(id) ?? (id === 'xai' ? providerHomepages.get('spacexai') : undefined);
  return websiteFavicon(homepage);
}
