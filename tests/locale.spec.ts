import { expect, test } from '@playwright/test';

test.use({ locale: 'nl-NL' });

test('uses Dutch skills headings and single-word composer menu labels', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Bijlagen toevoegen', exact: true }).click();
  const menu = page.getByRole('menu', { name: 'Bijlagen toevoegen', exact: true });
  await expect(menu.getByRole('menuitem')).toHaveText(['Bestanden', 'Link']);
  await page.keyboard.press('Escape');

  await page.getByRole('button', { name: 'Chatinstellingen', exact: true }).click();
  const settings = page.getByRole('dialog', { name: 'Chatinstellingen', exact: true });
  await settings.getByRole('tab', { name: 'Skills', exact: true }).click();
  await expect(settings.getByRole('region', { name: 'Lokale skills', exact: true })).toBeVisible();
  await expect(settings.getByRole('region', { name: 'Gehoste skills', exact: true })).toBeVisible();
});

test('detects Dutch, switches to Spanish without losing drafts, and remembers the language', async ({ page }) => {
  await page.goto('/');
  const appName = await page.title();
  await expect(page.locator('html')).toHaveAttribute('lang', 'nl');
  await expect(page.getByRole('contentinfo')).toContainText(`${appName} kan fouten maken.`);
  const agents = page.getByRole('button', { name: 'Agents', exact: true });
  await expect(agents).toBeVisible();
  await page.getByRole('textbox', { name: 'Bericht', exact: true }).fill('Keep this draft');

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
});

test('uses English when the browser language is unsupported', async ({ browser, baseURL }) => {
  const page = await browser.newPage({ locale: 'fr-FR', baseURL });
  try {
    await page.goto('/');
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await expect(page.getByRole('button', { name: 'New chat' })).toBeVisible();
  } finally { await page.close(); }
});
