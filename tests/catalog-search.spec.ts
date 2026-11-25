import { expect, test } from '@playwright/test';
import { faviconEndpoint, iconResponse } from './icon-fixtures';

test('MCP search stays within the current tab and indexes loaded registry pages', async ({ page }) => {
  const cursors: (string | null)[] = [];
  await page.route('**/test-mcp-registry*', route => {
    const cursor = new URL(route.request().url()).searchParams.get('cursor');
    cursors.push(cursor);
    const server = cursor ? { name: 'example/reports', title: 'Résumé Reports', description: 'Build monthly digests.',
      remotes: [{ type: 'streamable-http', url: 'https://reports.example.test/archive' }] }
      : { name: 'example/forecast', title: 'Weather Forecast', description: 'Look up local forecasts.' };
    return route.fulfill({ json: { servers: [{ server }], metadata: cursor ? {} : { nextCursor: 'page-2' } } });
  });
  await page.goto('http://localhost:15175/mcp');
  const installedTab = page.getByRole('tab', { name: 'Installed', exact: true });
  const registryTab = page.getByRole('tab', { name: 'Registry', exact: true });
  const search = page.getByRole('searchbox', { name: 'Search MCP servers', exact: true });
  await expect(installedTab).toHaveAttribute('aria-selected', 'true');
  await registryTab.click();
  await expect(page.getByRole('heading', { name: 'Weather Forecast' })).toBeVisible();
  await search.fill('archive resume');
  await expect(page.getByText('No matching MCP servers.')).toBeVisible();
  expect(cursors).toEqual([null]);
  await page.getByRole('button', { name: 'Load more servers' }).click();
  await expect(page.getByRole('heading', { name: 'Résumé Reports' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Weather Forecast' })).toHaveCount(0);
  expect(cursors).toEqual([null, 'page-2']);
  await page.getByRole('button', { name: 'Install Résumé Reports' }).click();

  await installedTab.click();
  await expect(search).toHaveValue('');
  const installedCard = page.getByRole('heading', { name: 'Résumé Reports' });
  await expect(installedCard).toBeVisible();
  await search.fill('reports archive');
  await expect(installedCard).toBeVisible();
  await search.fill('monthly');
  await expect(page.getByText('No matching MCP servers.')).toBeVisible();
  await search.clear();
  await expect(installedCard).toBeVisible();
  await registryTab.click();
  await expect(search).toHaveValue('archive resume');
  await search.clear();
  await expect(page.getByRole('tabpanel', { name: 'Registry', exact: true }).getByRole('heading')).toHaveText(['Weather Forecast', 'Résumé Reports']);
});

test('MCP registry icons prefer themed external images, then website favicons, then the tool glyph', async ({ page }) => {
  const iconHost = 'https://images.example.test';
  const items = [
    { name: 'example/themed', title: 'Themed server', websiteUrl: 'https://themed.example.test', icons: [
      { src: `${iconHost}/neutral.svg` }, { src: `${iconHost}/light.svg`, theme: 'light' }, { src: `${iconHost}/dark.svg`, theme: 'dark' },
    ] },
    { name: 'example/broken', title: 'Broken icon server', websiteUrl: 'https://broken.example.test/about?private=example#about',
      icons: [{ src: `${iconHost}/broken.svg` }] },
    { name: 'example/website', title: 'Website only server', websiteUrl: 'https://website.example.test' },
    { name: 'example/none', title: 'Generic server' },
  ];
  await page.route('**/test-mcp-registry*', route => route.fulfill({ json: { servers: items.map(server => ({ server })) } }));
  await page.route(`${iconHost}/**`, async route => {
    expect(await route.request().headerValue('referer')).toBeNull();
    return route.request().url().endsWith('/broken.svg') ? route.abort() : route.fulfill(iconResponse);
  });
  const lookups: (string | null)[] = [];
  await page.route(faviconEndpoint, route => {
    lookups.push(new URL(route.request().url()).searchParams.get('url'));
    return route.fulfill(iconResponse);
  });
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto('http://localhost:15175/mcp');
  await page.getByRole('tab', { name: 'Registry', exact: true }).click();
  const mark = (title: string) => page.getByRole('article').filter({ has: page.getByRole('heading', { name: title, exact: true }) }).locator('.catalog-mark');
  const themed = mark('Themed server').locator('img');
  await expect(themed).toHaveAttribute('src', `${iconHost}/light.svg`);
  await expect(themed).toHaveJSProperty('naturalWidth', 32);
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect(themed).toHaveAttribute('src', `${iconHost}/dark.svg`);
  await expect(themed).toHaveJSProperty('naturalWidth', 32);
  for (const title of ['Broken icon server', 'Website only server']) {
    const icon = mark(title).locator('img');
    await expect(icon).toHaveAttribute('src', faviconEndpoint);
    await expect(icon).toHaveJSProperty('naturalWidth', 32);
  }
  expect(lookups.sort()).toEqual(['https://broken.example.test/about', 'https://website.example.test/']);
  const generic = mark('Generic server');
  await expect(generic.locator('svg')).toBeVisible();
  await expect(generic.locator('img')).toHaveCount(0);
});
