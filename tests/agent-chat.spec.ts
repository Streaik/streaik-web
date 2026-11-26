import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { exportSkillZip } from '../packages/chat/src/skillBundles';
import { faviconEndpoint, iconResponse } from './icon-fixtures';

const app = 'http://localhost:15175';
const model = 'openai/gpt-6-luna';
const key = 'test-provider-key';
const endpoints = ['/api/chat', '/v1/responses', '/v1/messages', '/v1/chat/completions'];

function stream(text: string) {
  const chunks = [{ type: 'start' }, { type: 'text-start', id: 'text' }, { type: 'text-delta', id: 'text', delta: text },
    { type: 'text-end', id: 'text' }, { type: 'finish' }];
  return { contentType: 'text/event-stream', headers: { 'x-vercel-ai-ui-message-stream': 'v1' },
    body: chunks.map(chunk => `data: ${JSON.stringify(chunk)}\n\n`).join('') + 'data: [DONE]\n\n' };
}

const chatMode = (page: Page, name: 'Model' | 'Agent') => page.getByRole('group', { name: 'Chat mode' })
  .getByRole('button', { name: `${name} chat`, exact: true });
const agentPicker = (page: Page) => page.getByRole('button', { name: 'Agent', exact: true });

async function start(page: Page) {
  await page.route(faviconEndpoint, route => route.fulfill(iconResponse));
  await page.route('**/gateway/v1/models', route => route.fulfill({ json: { data: [{ id: model }] } }));
  await page.goto(app);
  await expect(chatMode(page, 'Model')).toHaveAttribute('aria-pressed', 'true');
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
  await chatMode(page, 'Agent').click();
  await expect(agentPicker(page)).toBeEnabled();
  await expect(agentPicker(page)).toHaveText('Select an agent');
}

async function pickChatAgent(page: Page) {
  await agentPicker(page).click();
  await page.getByRole('option', { name: 'ChatAgent', exact: true }).click();
  await expect(agentPicker(page)).toHaveText('ChatAgent');
}

async function routeGroup(page: Page, name: string) {
  await page.getByRole('button', { name: 'Account menu' }).click();
  await page.getByRole('menuitem', { name: 'Route', exact: true }).press('ArrowRight');
  await page.getByRole('menuitem', { name, exact: true }).press('ArrowRight');
}

async function expectConversationalRoutes(page: Page) {
  await expect(page.getByRole('menuitemradio')).toHaveCount(endpoints.length);
  for (const name of endpoints) await expect(page.getByRole('menuitemradio', { name, exact: true })).toBeVisible();
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
  await page.getByRole('textbox', { name: 'Message', exact: true }).fill('Run the hosted agent');
  await expect(page.getByRole('button', { name: 'Send', exact: true })).toBeDisabled();
  await pickChatAgent(page);
  await routeGroup(page, 'Agents');
  await expect(page.getByRole('menuitemradio', { name: '/api/chat', exact: true })).toHaveAttribute('aria-checked', 'true');
  await expectConversationalRoutes(page);
  await page.getByRole('menuitemradio', { name: '/api/chat', exact: true }).click();
  await send(page, 'Run the hosted agent');
  await expect(page.getByText('Hosted reply', { exact: true })).toBeVisible();
  await chatMode(page, 'Model').click();
  await expect(page.getByRole('button', { name: 'Model', exact: true })).toBeVisible();
  await chatMode(page, 'Agent').click();
  await expect(agentPicker(page)).toHaveText('ChatAgent');
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
  await pickChatAgent(page);
  await routeGroup(page, 'Gateway');
  await expect(page.getByRole('menuitemradio', { name: '/api/chat', exact: true })).toHaveAttribute('aria-checked', 'true');
  await expectConversationalRoutes(page);
  await page.getByRole('menuitemradio', { name: '/api/chat', exact: true }).click();
  await send(page, 'Run the browser agent');
  await expect(page.getByText('Browser reply', { exact: true })).toBeVisible();
});

for (const mode of ['Gateway', 'Direct', 'Agents'] as const) test(`saved agent skills use browser tools only on browser routes: ${mode}`, async ({ page }) => {
  const endpoint = '/v1/chat/completions';
  const skill = { id: 'openai/skill_agenda', name: 'agenda-check', description: 'Review an agenda.', default_version: '1', latest_version: '2' };
  const instructions = 'Open the agenda template.';
  const zip = await exportSkillZip({ metadata: { name: skill.name, description: skill.description }, instructions,
    files: [{ path: 'references/template.md', data: new Blob(['The agenda template']) }] });
  let downloads = 0;
  await page.route('**/test-agents/v1/models', route => route.fulfill({ json: { data: [] } }));
  await page.route('**/gateway/v1/skills?*', route => route.fulfill({ json: { data: [skill], has_more: false } }));
  await page.route('**/gateway/v1/skills/openai/skill_agenda/versions/2/content', async route => {
    downloads++;
    await route.fulfill({ contentType: 'application/zip', body: Buffer.from(await zip.arrayBuffer()) });
  });
  const headers = { 'access-control-allow-origin': app, 'access-control-allow-headers': 'authorization, content-type',
    'access-control-allow-methods': 'GET, POST, OPTIONS' };
  await page.route('https://api.openai.com/v1/models', route => route.fulfill({ headers, json: { data: [{ id: 'gpt-6-luna' }] } }));
  await page.route('**/gateway/api/chat', route => route.fulfill(stream('Welcome')));
  await page.route('**/test-agents/api/chat', route => {
    const body = route.request().postDataJSON();
    expect(body.agent.skills).toEqual([{ type: 'skill_reference', skill_id: skill.id, version: 'latest' }]);
    expect(body.tools).toBeUndefined();
    expect(JSON.stringify(body.messages)).not.toMatch(/activate_skill|read_skill_resource|agenda-check/);
    return route.fulfill(stream('Hosted agenda reply'));
  });
  let requests = 0;
  const browserUrl = mode === 'Direct' ? `https://api.openai.com${endpoint}` : `**/gateway${endpoint}`;
  await page.route(browserUrl, route => {
    if (route.request().method() === 'OPTIONS') return route.fulfill({ headers });
    requests++;
    const body = route.request().postDataJSON();
    expect(body.tools.map((tool: { function: { name: string } }) => tool.function.name)).toEqual(['activate_skill', 'read_skill_resource']);
    const serialized = JSON.stringify(body.messages);
    const context = body.messages.flatMap(({ content }: { content?: string }) => {
      if (typeof content !== 'string' || !content.startsWith('{"skills":')) return [];
      return JSON.parse(content).skills;
    });
    expect(context).toMatchObject([{ name: skill.name, description: skill.description }]);
    const base = { id: `agenda-${requests}`, object: 'chat.completion.chunk', created: 1, model: 'gpt-6-luna' };
    const call = (name: string, input: object) => ({ role: 'assistant', tool_calls: [{ index: 0, id: `call-${requests}`,
      type: 'function', function: { name, arguments: JSON.stringify(input) } }] });
    let delta;
    if (requests === 1) {
      expect(serialized).not.toContain(instructions);
      expect(downloads).toBe(0);
      delta = call('activate_skill', { skill_id: context[0].skill_id });
    } else if (requests === 2) {
      expect(serialized).toContain(instructions);
      delta = call('read_skill_resource', { skill_id: context[0].skill_id, path: 'references/template.md' });
    } else {
      expect(serialized).toContain('The agenda template');
      delta = { role: 'assistant', content: 'Browser agenda reply' };
    }
    return route.fulfill({ headers, contentType: 'text/event-stream', body: [
      { ...base, choices: [{ index: 0, delta, finish_reason: null }] },
      { ...base, choices: [{ index: 0, delta: {}, finish_reason: requests < 3 ? 'tool_calls' : 'stop' }] },
    ].map(frame => `data: ${JSON.stringify(frame)}\n\n`).join('') + 'data: [DONE]\n\n' });
  });

  await start(page);
  await page.getByRole('button', { name: 'Agents', exact: true }).click();
  await page.getByRole('article', { name: 'ChatAgent', exact: true }).getByRole('button', { name: 'Edit', exact: true }).click();
  const editor = page.getByRole('dialog', { name: 'Edit agent' });
  await editor.getByRole('tab', { name: 'Skills', exact: true }).click();
  await editor.getByRole('switch', { name: skill.name, exact: true }).check();
  await editor.getByRole('button', { name: 'Save agent', exact: true }).click();
  await expect(editor).toBeHidden();
  await page.getByRole('button', { name: 'New chat', exact: true }).click();
  if (await chatMode(page, 'Agent').getAttribute('aria-pressed') !== 'true') await chatMode(page, 'Agent').click();
  await pickChatAgent(page);
  await routeGroup(page, mode);
  await page.getByRole('menuitemradio', { name: mode === 'Agents' ? '/api/chat' : endpoint, exact: true }).click();
  await send(page, 'Check the agenda');
  await expect(page.getByText(`${mode === 'Agents' ? 'Hosted' : 'Browser'} agenda reply`, { exact: true })).toBeVisible();
  expect(downloads).toBe(mode === 'Agents' ? 0 : 1);
  expect(requests).toBe(mode === 'Agents' ? 0 : 3);
});
