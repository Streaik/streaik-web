import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { faviconEndpoint, iconResponse } from './icon-fixtures';

const app = 'http://localhost:15175';
const model = 'openai/gpt-6-luna';
const key = 'test-provider-key';

function stream(text: string) {
  const chunks = [{ type: 'start' }, { type: 'text-start', id: 'text' }, { type: 'text-delta', id: 'text', delta: text },
    { type: 'text-end', id: 'text' }, { type: 'finish' }];
  return { contentType: 'text/event-stream', headers: { 'x-vercel-ai-ui-message-stream': 'v1' },
    body: chunks.map(chunk => `data: ${JSON.stringify(chunk)}\n\n`).join('') + 'data: [DONE]\n\n' };
}

const chatMode = (page: Page, name: string) => page.getByRole('group', { name: 'Chat mode' }).getByRole('button', { name, exact: true });
const agentPicker = (page: Page) => page.getByRole('button', { name: 'Agent', exact: true });

async function start(page: Page) {
  await page.route(faviconEndpoint, route => route.fulfill(iconResponse));
  await page.route('**/gateway/v1/models', route => route.fulfill({ json: { data: [{ id: model }] } }));
  await page.goto(app);
  await expect(chatMode(page, 'Chat')).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Account menu' }).click();
  await page.getByRole('menuitem', { name: 'Settings', exact: true }).click();
  await page.getByRole('tab', { name: 'API keys', exact: true }).click();
  const panel = page.getByRole('tabpanel', { name: 'API keys', exact: true });
  await panel.getByRole('button', { name: 'Add API key' }).click();
  await panel.getByLabel('Provider', { exact: true }).selectOption({ label: 'OpenAI' });
  await panel.getByLabel('OpenAI API key').fill(key);
  await panel.getByRole('button', { name: 'Save OpenAI key' }).click();
  await expect(panel.getByRole('status')).toHaveText('Provider key saved.');
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await chatMode(page, 'Agents').click();
  await expect(agentPicker(page)).toBeEnabled();
}

async function routeGroup(page: Page, name: string) {
  await page.getByRole('button', { name: 'Account menu' }).click();
  await page.getByRole('menuitem', { name: 'Route', exact: true }).press('ArrowRight');
  await page.getByRole('menuitem', { name, exact: true }).press('ArrowRight');
}

async function send(page: Page, text: string) {
  await page.getByRole('textbox', { name: 'Message', exact: true }).fill(text);
  await page.getByRole('button', { name: 'Send', exact: true }).click();
}

test('agent mode prefers hosted API Chat and offers four hosted routes', async ({ page }) => {
  await page.route('**/test-agents/v1/models', async route => {
    expect(await route.request().headerValue('x-openai-key')).toBeNull();
    await route.fulfill({ json: { data: [] } });
  });
  await page.route('**/gateway/api/chat', route => route.fulfill(stream('Welcome')));
  await page.route('**/test-agents/api/chat', async route => {
    expect(await route.request().headerValue('x-openai-key')).toBe(key);
    const body = route.request().postDataJSON();
    expect(body.agent).toMatchObject({ name: 'ChatAgent', instructions: 'Chat' });
    expect(body.tools).toBeUndefined();
    await route.fulfill(stream('Hosted reply'));
  });
  await start(page);
  await expect(agentPicker(page)).toHaveText('ChatAgent');
  await routeGroup(page, 'Agents');
  await expect(page.getByRole('menuitemradio', { name: '/api/chat', exact: true })).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByRole('menuitemradio')).toHaveText(['/api/chat', '/v1/responses', '/v1/messages', '/v1/chat/completions']);
  await page.getByRole('menuitemradio', { name: '/api/chat', exact: true }).click();
  await send(page, 'Run the hosted agent');
  await expect(page.getByText('Hosted reply', { exact: true })).toBeVisible();
  await chatMode(page, 'Chat').click();
  await expect(page.getByRole('button', { name: 'Model', exact: true })).toBeVisible();
});

test('agent mode falls back to browser-run Gateway when the configured agent backend is offline', async ({ page }) => {
  await page.route('**/test-agents/v1/models', route => route.abort());
  await page.route('**/gateway/api/chat', async route => {
    const body = route.request().postDataJSON();
    if (!JSON.stringify(body.messages).includes('Run the browser agent')) return route.fulfill(stream('Welcome'));
    expect(body.agent).toBeUndefined();
    expect(body.model).toBe(model);
    expect(body.messages).toEqual(expect.arrayContaining([expect.objectContaining({ role: 'system' })]));
    await route.fulfill(stream('Browser reply'));
  });
  await start(page);
  await expect(page.getByText('Agent backend unavailable. Using a browser route.')).toBeVisible();
  await routeGroup(page, 'Gateway');
  await expect(page.getByRole('menuitemradio', { name: '/api/chat', exact: true })).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByRole('menuitemradio')).toHaveText(['/api/chat', '/v1/responses', '/v1/messages', '/v1/chat/completions']);
  await page.getByRole('menuitemradio', { name: '/api/chat', exact: true }).click();
  await send(page, 'Run the browser agent');
  await expect(page.getByText('Browser reply', { exact: true })).toBeVisible();
});
