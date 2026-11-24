import { expect, test } from '@playwright/test';

test('history search shows recent chats, opens keyboard results, and removes deleted chats across reload', async ({ page }) => {
  const label = 'Search chat history';
  const trigger = page.getByRole('button', { name: label, exact: true });
  const rail = page.getByRole('navigation', { name: 'Chat navigation' });
  const panel = page.getByRole('complementary', { name: 'Chat history' });
  const dialog = page.getByRole('dialog', { name: label });
  const input = dialog.getByRole('searchbox', { name: label });
  const results = dialog.getByRole('list', { name: 'Search results' });
  const status = dialog.getByRole('status');

  await page.goto('/models');
  await rail.getByRole('button', { name: label }).click();
  await expect(status).toHaveText('No conversations yet.');
  await expect(input).toBeFocused();
  await input.press('Escape');
  await expect(dialog).not.toBeVisible();
  await expect(trigger).toBeFocused();

  await page.evaluate(() => new Promise<void>((resolve, reject) => {
    const request = indexedDB.open('streaik-conversations', 1);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      const tx = db.transaction('conversations', 'readwrite');
      const store = tx.objectStore('conversations');
      const gateway = new URL('/gateway/api/chat', location.origin).href;
      for (let i = 1; i <= 8; i++) {
        const id = `search-chat-${i}`;
        const messages = [{ id: `${id}-q`, role: 'user', parts: [{ type: 'text', text: i === 1 ? 'Where is the planetarium?' : `Question ${i}` }] },
          { id: `${id}-a`, role: 'assistant', parts: [{ type: 'text', text: i === 1 ? 'The observatory is downtown.' : `Reply ${i}` }] }];
        store.put({ id, metadata: { name: `Example ${i}`, updatedAt: new Date(Date.UTC(2026, 0, i)).toISOString(), pinned: i === 8 }, messages },
          [JSON.stringify([gateway, 'byok']), id]);
      }
      for (const [id, scope] of [['foreignprofile', [gateway, 'another-profile']], ['foreigngateway', ['https://elsewhere.example/api/chat', 'byok']]] as const) {
        store.put({ id, messages: [{ id: `${id}-q`, role: 'user', parts: [{ type: 'text', text: id }] }] }, [JSON.stringify(scope), id]);
      }
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onabort = () => { db.close(); reject(tx.error); };
    };
  }));
  await page.reload();

  await page.getByRole('button', { name: 'Toggle navigation' }).click();
  const headerTrigger = panel.getByRole('button', { name: label });
  await expect(rail.getByRole('button', { name: label })).toHaveCount(0);
  await expect(headerTrigger).toHaveText('');
  await page.setViewportSize({ width: 360, height: 620 });
  await headerTrigger.click();
  const box = await dialog.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(360);
  await expect(dialog.getByRole('list', { name: 'Recent' }).getByRole('button')).toHaveText(
    ['Example 8', 'Example 7', 'Example 6', 'Example 5', 'Example 4', 'Example 3']);
  await expect(input).toBeFocused();

  for (const term of ['foreignprofile', 'foreigngateway']) {
    await input.fill(term);
    await expect(status).toHaveText('No matches found.');
  }
  await input.fill('planetarium');
  await expect(results.getByRole('button', { name: 'Example 1' })).toBeVisible();
  await input.fill('observ ');
  const hit = results.getByRole('button', { name: 'Example 1' });
  await expect(hit).toHaveAccessibleDescription(/The observatory is downtown/);
  await input.fill('observ'); // Whitespace alone must not invalidate the current matches.
  await expect(hit).toBeVisible();
  await input.press('Enter');
  await expect(dialog).not.toBeVisible();
  await expect(page).toHaveURL(/\/c\/search-chat-1$/);
  await expect(panel).not.toBeVisible();
  await expect(page.getByText('The observatory is downtown.', { exact: true })).toBeVisible();

  await page.setViewportSize({ width: 1024, height: 768 });
  await page.getByRole('button', { name: 'Toggle navigation' }).click();
  await panel.getByRole('button', { name: 'Example 1', exact: true }).hover();
  await panel.getByRole('button', { name: 'More actions for Example 1', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Delete', exact: true }).click();
  await headerTrigger.click();
  await input.fill('observ');
  await expect(status).toHaveText('No matches found.');
  await page.reload();
  await trigger.click();
  await input.fill('observ');
  await expect(status).toHaveText('No matches found.');
  await input.fill('Example 8');
  await expect(results.getByRole('button', { name: 'Example 8' })).toBeVisible();
});
