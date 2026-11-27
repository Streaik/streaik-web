import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';

async function openChatSettings(page: Page, theme: 'shadcn' | 'fluent' | 'html') {
  await page.addInitScript(theme => localStorage.setItem('streaik.theme', theme), theme);
  await page.route('**/gateway/v1/models', route => route.fulfill({ json: { data: [] } }));
  await page.goto('/');
  await page.getByRole('button', { name: 'Chat settings', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Chat settings', exact: true });
  await expect(dialog).toBeVisible();
  await page.setViewportSize({ width: 320, height: 720 });
  const list = dialog.getByRole('tablist', { name: 'Chat settings sections', exact: true });
  return { dialog, list, general: list.getByRole('tab', { name: 'General', exact: true }) };
}

function rowCount(list: Locator) {
  return list.getByRole('tab').evaluateAll(tabs => new Set(tabs.map(tab => Math.round(tab.getBoundingClientRect().top))).size);
}

async function expectSelected(dialog: Locator, tab: Locator, label: string) {
  await expect(tab).toBeFocused();
  await expect(tab).toHaveAttribute('aria-selected', 'true');
  const panel = dialog.getByRole('tabpanel', { name: label, exact: true });
  await expect(panel).toBeVisible();
  await expect(tab).toHaveAttribute('aria-controls', (await panel.getAttribute('id'))!);
}

test('shadcn chat tabs scroll in one row and reveal the focused tab', async ({ page }) => {
  const { dialog, list, general } = await openChatSettings(page, 'shadcn');
  await expect(general).toHaveAttribute('data-state', 'active');
  await expect.poll(() => list.evaluate(el => el.scrollWidth > el.clientWidth)).toBe(true);
  expect(await rowCount(list)).toBe(1);

  const skills = list.getByRole('tab', { name: 'Skills', exact: true });
  await general.press('End');
  await expectSelected(dialog, skills, 'Skills');
  await expect.poll(() => list.evaluate(el => el.scrollLeft)).toBeGreaterThan(0);
  await skills.press('ArrowRight');
  await expectSelected(dialog, general, 'General');
});

test('Fluent chat tabs make overflow accessible from an ellipsis inside the modal', async ({ page }) => {
  const { dialog, list, general } = await openChatSettings(page, 'fluent');
  const more = dialog.getByRole('button', { name: 'More tabs', exact: true });
  const menu = dialog.getByRole('menu', { name: 'More tabs', exact: true });
  const skills = list.getByRole('tab', { name: 'Skills', exact: true });
  await expect(more).toBeVisible();
  await expect(skills).toBeHidden();
  expect(await rowCount(list)).toBe(1);

  await general.press('Tab');
  await expect(more).toBeFocused();
  await more.press('Enter');
  await expect(menu).toBeVisible();
  await expect(menu.getByRole('menuitem', { name: 'General', exact: true })).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();
  await expect(dialog).toBeVisible();
  await expect(more).toBeFocused();

  await more.press('Enter');
  await menu.getByRole('menuitem', { name: 'Skills', exact: true }).press('Enter');
  await expect(menu).toBeHidden();
  await expectSelected(dialog, skills, 'Skills');

  await skills.press('Home');
  await expectSelected(dialog, general, 'General');
  await general.press('End');
  await expectSelected(dialog, skills, 'Skills');

  await page.setViewportSize({ width: 1000, height: 720 });
  await expect(more).toBeHidden();
  await expectSelected(dialog, skills, 'Skills');
});

test('HTML chat tabs keep their plain buttons and wrapping layout', async ({ page }) => {
  const { dialog, list, general } = await openChatSettings(page, 'html');
  await expect(list.locator(':scope > button[role=tab]')).toHaveCount(4);
  expect(await rowCount(list)).toBeGreaterThan(1);
  await expect(dialog.getByRole('button', { name: 'More tabs', exact: true })).toHaveCount(0);
  await general.press('End');
  await expectSelected(dialog, list.getByRole('tab', { name: 'Skills', exact: true }), 'Skills');
});
