import type { Locator, Page } from '@playwright/test';

export async function selectKeyProvider(container: Locator | Page, name: string) {
  await container.getByRole('button', { name: 'Provider', exact: true }).click();
  await container.getByRole('combobox', { name: 'Search providers', exact: true }).fill(name);
  await container.getByRole('listbox', { name: 'Provider', exact: true }).getByRole('option', { name, exact: true }).click();
}
