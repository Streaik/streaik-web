import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

test.use({ locale: 'nl-NL' });

async function expectProtocolLinks(page: Page, title: string, protocol: string, urls: [website: string, specification: string]) {
  const heading = page.getByRole('heading', { name: title, level: 1, exact: true });
  await expect(heading).toBeVisible();
  const header = page.getByRole('main').locator('header').filter({ has: heading });
  const website = header.getByRole('link', { name: `Officiële website van ${protocol}`, exact: true });
  const specification = header.getByRole('link', { name: `Specificatie van ${protocol}`, exact: true });
  await expect(header.getByRole('link')).toHaveCount(2);
  for (const [link, href] of [[website, urls[0]], [specification, urls[1]]] as const) {
    await expect(link).toHaveAttribute('href', href);
    await expect(link).toHaveAttribute('target', '_blank');
    await expect(link).toHaveText('');
    await expect(link.locator('svg')).toBeVisible();
  }
  await website.press('Tab');
  await expect(specification).toBeFocused();
}

test('localizes the MCP overview tabs and uses matching cards for registry and installed servers', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const description = 'Published server description';
  const endpoint = 'https://example.test/mcp';
  const alternate = 'https://example.test/mcp-alternate';
  const singleUrl = 'https://example.test/single';
  let requests = 0;
  await page.route('**/test-mcp-registry*', route => {
    requests++;
    return route.fulfill({ json: { servers: [
      { server: { name: 'example/tools', title: 'Fixture Tools', version: '1.2.3', description,
        remotes: [endpoint, alternate].map(url => ({ type: 'streamable-http', url })) } },
      { server: { name: 'example/single', title: 'Single Endpoint', remotes: [{ type: 'streamable-http', url: singleUrl }] } },
      { server: { name: 'example/unsupported', title: 'Unsupported Server' } },
    ] } });
  });
  await page.goto('http://localhost:15175/mcp');
  await expectProtocolLinks(page, 'Model Context', 'Model Context Protocol', ['https://modelcontextprotocol.io/', 'https://modelcontextprotocol.io/specification']);
  await expect(page.getByText(/^Installeer servers uit het register/)).toHaveCount(0);
  const tabs = page.getByRole('tablist', { name: 'Model Context' });
  await expect(tabs.getByRole('tab')).toHaveText(['Geïnstalleerd', 'Register']);
  const installedTab = tabs.getByRole('tab', { name: 'Geïnstalleerd', exact: true });
  const registryTab = tabs.getByRole('tab', { name: 'Register', exact: true });
  const installed = page.getByRole('tabpanel', { name: 'Geïnstalleerd', exact: true });
  const registry = page.getByRole('tabpanel', { name: 'Register', exact: true });
  const empty = installed.getByText('Er zijn nog geen MCP-servers geïnstalleerd.');
  await expect(installedTab).toHaveAttribute('aria-selected', 'true');
  await expect(empty).toBeVisible();
  await expect(registry).toBeHidden();
  expect(requests).toBe(0);

  const add = page.locator('.chat-toolbar').getByRole('button', { name: 'Toevoegen via URL', exact: true });
  await expect(installed.getByRole('button', { name: 'Toevoegen via URL', exact: true })).toHaveCount(0);
  await expect(add).toHaveText('');
  await expect(add.locator('svg')).toBeVisible();
  await add.press('Enter');
  const editor = page.getByRole('dialog', { name: 'MCP-server toevoegen' });
  await expect(editor.getByLabel('Server-URL')).toBeVisible();
  await editor.getByRole('button', { name: 'Annuleren' }).click();

  await installedTab.press('ArrowRight');
  await expect(registryTab).toBeFocused();
  await expect(registryTab).toHaveAttribute('aria-selected', 'true');
  await expect(installed).toBeHidden();
  await expect(add).toBeVisible();
  const search = registry.getByRole('searchbox', { name: 'MCP-servers zoeken' });
  const card = registry.getByRole('article').filter({ has: page.getByRole('heading', { name: 'Fixture Tools' }) });
  await expect(card).toHaveClass(/\bcatalog-card\b/);
  await expect(card.getByText(description, { exact: true })).toBeVisible();
  await expect(card.getByRole('img', { name: 'Versie 1.2.3', exact: true })).toHaveText('v1.2.3');
  const copyLabel = 'Server-URL kopiëren';
  const copy = card.getByRole('button', { name: copyLabel, exact: true });
  const singleCard = registry.getByRole('article').filter({ has: page.getByRole('heading', { name: 'Single Endpoint' }) });
  await expect(singleCard.getByRole('img')).toHaveCount(0);
  await expect(singleCard.getByText(singleUrl, { exact: true })).toHaveCount(0);
  await expect(singleCard.getByRole('button', { name: copyLabel, exact: true })).toBeVisible();
  const unsupportedCard = registry.getByRole('article').filter({ has: page.getByRole('heading', { name: 'Unsupported Server' }) });
  await expect(unsupportedCard).toBeVisible();
  await expect(unsupportedCard.getByRole('button', { name: copyLabel, exact: true })).toHaveCount(0);
  const refresh = registry.getByRole('button', { name: 'Register vernieuwen' });
  const install = card.getByRole('button', { name: 'Fixture Tools installeren' });
  for (const button of [refresh, install]) {
    await expect(button).toHaveText('');
    await expect(button.locator('svg')).toBeVisible();
  }
  const beforeRefresh = requests;
  await refresh.press('Enter');
  await expect.poll(() => requests).toBeGreaterThan(beforeRefresh);
  await expect(refresh).toBeEnabled();
  await search.fill('Fixture');
  const urls = card.getByRole('combobox', { name: 'Server-URL' });
  await expect(urls).toHaveValue(endpoint);
  await urls.selectOption(alternate);
  await registryTab.press('Home');
  await expect(empty).toBeVisible();
  await installedTab.press('End');
  await expect(search).toHaveValue('Fixture');
  await expect(urls).toHaveValue(alternate);
  await copy.hover();
  await expect(page.getByRole('tooltip', { name: alternate, exact: true })).toBeVisible();
  await copy.click();
  await expect(card.getByRole('status')).toHaveText('Gekopieerd');
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(alternate);
  await install.press('Enter');
  await expect(card.getByText('Geïnstalleerd', { exact: true })).toBeVisible();
  await expect(copy).toBeVisible();

  await installedTab.click();
  const installedCard = installed.getByRole('article').filter({ has: page.getByRole('heading', { name: 'Fixture Tools' }) });
  await expect(installedCard).toHaveClass(/\bcatalog-card\b/);
  await expect(installedCard.getByText(alternate, { exact: true })).toBeVisible();
  await installedCard.getByRole('button', { name: 'Fixture Tools configureren' }).click();
  const edit = page.getByRole('dialog', { name: 'Model Context Server', exact: true });
  await expect(edit.getByLabel('Server-URL')).toHaveValue(alternate);
  await expect(edit.getByText(/Headers worden alleen naar/)).toHaveCount(0);
  await edit.getByRole('button', { name: 'Annuleren' }).click();
  await installedCard.getByRole('button', { name: 'Fixture Tools verwijderen' }).click();
  await expect(empty).toBeVisible();
  await registryTab.click();
  await expect(install).toBeVisible();

  await page.getByRole('button', { name: 'Nieuw gesprek', exact: true }).click();
  await page.getByRole('button', { name: /^(Bijlagen toevoegen|Aan bericht toevoegen)$/ }).click();
  await page.getByRole('menuitem', { name: 'Model Context', exact: true }).click();
  const picker = page.getByRole('dialog', { name: 'Model Context', exact: true });
  await expect(picker.getByRole('link', { name: /Model Context Protocol/ })).toHaveCount(0);
  const pickerCard = picker.getByRole('article').filter({ has: page.getByRole('heading', { name: 'Fixture Tools' }) });
  await expect(pickerCard.getByRole('img', { name: 'Versie 1.2.3', exact: true })).toHaveText('v1.2.3');
  const pickerCopy = pickerCard.getByRole('button', { name: copyLabel, exact: true });
  await pickerCopy.hover();
  await expect(picker.getByRole('tooltip', { name: endpoint, exact: true })).toBeVisible();
  await pickerCopy.click();
  await expect(pickerCard.getByRole('status')).toHaveText('Gekopieerd');
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(endpoint);
});

test('uses Dutch single-word chat settings headings and composer menu labels', async ({ page }) => {
  await page.goto('/');
  const addLabel = /^(Bijlagen toevoegen|Aan bericht toevoegen)$/;
  await page.getByRole('button', { name: addLabel }).click();
  const menu = page.getByRole('menu', { name: addLabel });
  await expect(menu.getByRole('menuitem', { name: 'Bestanden', exact: true })).toBeVisible();
  await expect(menu.getByRole('menuitem', { name: 'Link', exact: true })).toBeVisible();
  await page.keyboard.press('Escape');

  await page.getByRole('button', { name: 'Chatinstellingen', exact: true }).click();
  const settings = page.getByRole('dialog', { name: 'Chatinstellingen', exact: true });
  await settings.getByRole('tab', { name: 'Tools', exact: true }).click();
  await expect(settings.getByRole('tabpanel', { name: 'Tools', exact: true }).getByRole('heading', { level: 3 })).toHaveText('Lokaal');
  await settings.getByRole('tab', { name: 'Skills', exact: true }).click();
  await expect(settings.getByRole('region', { name: 'Lokaal', exact: true })).toBeVisible();
  await expect(settings.getByRole('region', { name: 'Centraal', exact: true })).toBeVisible();
});

test('localizes the transcription search field in Dutch', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Transcripties', exact: true }).click();
  const finished = page.getByRole('tabpanel', { name: 'Voltooid', exact: true });
  const search = finished.getByRole('searchbox', { name: 'Transcripties zoeken', exact: true });
  await expect(search).toBeVisible();
  await expect(search).toHaveAttribute('placeholder', 'Transcripties zoeken…');
});

test('translates the Dutch Skills overview and shows a simplified skill editor', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Skills', exact: true }).click();
  await expectProtocolLinks(page, 'Skills', 'Agent Skills', ['https://agentskills.io', 'https://agentskills.io/specification']);
  await expect(page.getByText('Maak Agent Skills in je browser of download ze bij providers en zet ze over.', { exact: true })).toHaveCount(0);
  const sources = page.getByRole('tablist', { name: 'Bronnen van skills', exact: true });
  await expect(sources.getByRole('tab')).toHaveText(['Lokaal', 'Centraal']);

  await page.getByRole('button', { name: 'Skill toevoegen', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Nieuw', exact: true }).click();
  const editor = page.getByRole('dialog', { name: 'Skill maken', exact: true });
  const general = editor.getByRole('tabpanel', { name: 'Algemeen', exact: true });
  await expect(general.getByRole('textbox')).toHaveCount(5);
  await expect(general.locator('details')).toHaveCount(0);
  for (const [name, placeholder] of [
    ['Naam', 'bijv. weekoverzicht'],
    ['Beschrijving', 'Beschrijf wat de skill doet en wanneer je die gebruikt'],
    ['Licentie', 'bijv. MIT (optioneel)'],
    ['Compatibiliteit', 'bijv. internettoegang vereist (optioneel)'],
    ['Toegestane tools', 'bijv. Read Search (optioneel)'],
  ]) {
    const field = general.getByRole('textbox', { name, exact: true });
    await expect(field).toBeVisible();
    await expect(field).toHaveAttribute('placeholder', placeholder);
  }

  await editor.getByRole('tab', { name: 'SKILL.md', exact: true }).click();
  const instructions = editor.getByRole('tabpanel', { name: 'SKILL.md', exact: true });
  await expect(instructions.getByRole('textbox', { name: 'Instructies', exact: true })).toBeVisible();
  await expect(instructions.locator('p')).toHaveCount(0);
  await editor.getByRole('tab', { name: 'Bestanden', exact: true }).click();
  const files = editor.getByRole('tabpanel', { name: 'Bestanden', exact: true });
  await expect(files.getByRole('textbox', { name: 'Bestandspad', exact: true })).toBeVisible();
  await expect(files.locator('p')).toHaveCount(0);
  await expect(editor.getByRole('button', { name: 'Maken', exact: true })).toBeVisible();
});

test('detects Dutch, switches to Spanish without losing drafts, and remembers the language', async ({ page }) => {
  await page.goto('/');
  const appName = await page.title();
  await expect(page.locator('html')).toHaveAttribute('lang', 'nl');
  await expect(page.getByRole('contentinfo')).toContainText(`${appName} kan fouten maken.`);
  const agents = page.getByRole('button', { name: 'Agents', exact: true });
  await expect(agents).toBeVisible();
  await page.getByRole('textbox', { name: 'Bericht', exact: true }).fill('Keep this draft');
  await page.getByRole('button', { name: 'Context bekijken', exact: true }).click();
  const dutchContext = page.getByRole('dialog', { name: 'Context', exact: true });
  await expect(dutchContext.getByRole('heading', { name: 'Systeemcontext', exact: true })).toBeVisible();
  await dutchContext.getByRole('button', { name: 'Sluiten', exact: true }).click();

  await page.getByRole('button', { name: 'Accountmenu' }).click();
  await page.getByRole('menuitem', { name: 'Instellingen' }).click();
  const settings = page.getByRole('dialog');
  await expect(settings.getByRole('tab', { name: 'Agents', exact: true })).toBeVisible();
  await expect(settings.getByRole('tabpanel', { name: 'Algemeen', exact: true })).toBeVisible();
  await expect(settings.getByRole('combobox', { name: 'Taal' })).toHaveValue('nl');
  await settings.getByRole('combobox', { name: 'Taal' }).selectOption('es');
  await expect(settings).toHaveAccessibleName('Configuración');
  await expect(settings.getByRole('tab', { name: 'Agents', exact: true })).toBeVisible();
  await expect(settings.getByRole('combobox', { name: 'Modo de color' })).toBeVisible();
  await settings.getByRole('tab', { name: 'Claves de API' }).click();
  await expect(settings.getByRole('button', { name: 'Añadir clave de API' })).toBeVisible();
  const close = settings.getByRole('button', { name: 'Cerrar' });
  await expect(close).toHaveText('');
  await close.hover();
  await expect(settings.getByRole('tooltip', { name: 'Cerrar', exact: true })).toBeVisible();
  await close.press('Enter');
  await expect(settings).toBeHidden();
  await expect(page.getByRole('textbox', { name: 'Mensaje', exact: true })).toHaveValue('Keep this draft');
  await page.getByRole('button', { name: 'Ver contexto', exact: true }).click();
  const spanishContext = page.getByRole('dialog', { name: 'Contexto', exact: true });
  await expect(spanishContext.getByRole('heading', { name: 'Contexto del sistema', exact: true })).toBeVisible();
  await spanishContext.getByRole('button', { name: 'Cerrar', exact: true }).click();

  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('lang', 'es');
  await expect(page).toHaveTitle(appName);
  await expect(page.getByRole('contentinfo')).toContainText(`${appName} puede cometer errores.`);
  await agents.click();
  await expect(page.getByRole('heading', { name: 'Agents', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Más páginas', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Proveedores', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Proveedores' })).toBeVisible();
  await expect(page.getByRole('link', { name: /^sitio web de / }).first()).toBeVisible();
  await page.getByRole('button', { name: 'Servidores MCP', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Servidores MCP', exact: true })).toBeVisible();
  await expect(page.getByText(/^Instala servidores del registro/)).toBeVisible();
});

test('uses English when the browser language is unsupported', async ({ browser, baseURL }) => {
  const page = await browser.newPage({ locale: 'fr-FR', baseURL });
  try {
    await page.goto('/');
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await expect(page.getByRole('button', { name: 'New chat' })).toBeVisible();
  } finally { await page.close(); }
});
