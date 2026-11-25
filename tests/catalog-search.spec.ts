import { expect, test } from '@playwright/test';

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
