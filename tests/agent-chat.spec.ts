import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { exportSkillZip } from '../packages/chat/src/skillBundles';
import { faviconEndpoint, iconResponse } from './icon-fixtures';
import { selectKeyProvider } from './provider-key-picker';

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

async function start(page: Page, data: { id: string; type?: string; name?: string }[] = [{ id: model }]) {
  await page.route(faviconEndpoint, route => route.fulfill(iconResponse));
  await page.route('**/gateway/v1/models', route => route.fulfill({ json: { data } }));
  await page.goto(app);
  await expect(chatMode(page, 'Model')).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Account menu' }).click();
  await page.getByRole('menuitem', { name: 'Settings', exact: true }).click();
  await page.getByRole('tab', { name: 'API keys', exact: true }).click();
  const panel = page.getByRole('tabpanel', { name: 'API keys', exact: true });
  await panel.getByRole('button', { name: 'Add API key' }).click();
  await selectKeyProvider(panel, 'OpenAI');
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

test('agent picker groups by owner, then each tag, then Central or Local', async ({ page }) => {
  await page.addInitScript(() => {
    const scope = JSON.stringify([new URL('/gateway/api/chat', location.href).href, 'byok']);
    const key = `streaik.agents.v1:${scope}`;
    const local = [
      { id: 'alpha', definition: { name: 'alpha Desk', owned_by: ' Workspace ', tags: ['Ignored'] } },
      { id: 'shared', definition: { name: 'Shared Agent', tags: [' Ops ', 'Ops', '', 'Support'] } },
    ].map(({ id, definition }) => ({ id, definition: { description: 'Test agent', instructions: 'Answer briefly.', ...definition } }));
    localStorage.setItem(key, JSON.stringify({ version: 1, assignments: {}, overrides: [], local }));
  });
  await page.route('**/test-agents/v1/models', route => route.fulfill({ json: { data: [
    { id: 'zulu-desk', name: 'Zulu Desk', owned_by: 'Workspace', tags: ['Ignored'] },
    { id: 'beta-ops', name: 'beta Ops', owned_by: ' ', tags: ['Ops', 42] },
    { id: 'zulu-central', name: 'Zulu Central' },
    { id: 'alpha-central', name: 'alpha Central', tags: [' '] },
  ] } }));
  await start(page);
  await agentPicker(page).click();
  const popup = page.getByRole('dialog', { name: 'Agent', exact: true });
  const list = popup.getByRole('listbox');
  const group = (name: string) => list.getByRole('group', { name, exact: true });
  await expect(group('Workspace').getByRole('option')).toHaveText(['alpha Desk', 'Zulu Desk']);
  await expect(group('Ops').getByRole('option')).toHaveText(['beta Ops', 'Shared Agent']);
  await expect(group('Support').getByRole('option')).toHaveText('Shared Agent');
  await expect(group('Central').getByRole('option')).toHaveText(['alpha Central', 'Zulu Central']);
  await expect(group('Local').getByRole('option', { name: 'ChatAgent', exact: true })).toBeVisible();
  await expect(group('Ignored')).toHaveCount(0);
  await expect(list.getByRole('group')).toHaveCount(5);

  const search = popup.getByRole('combobox', { name: 'Search agents', exact: true });
  await search.fill('Shared Agent');
  const opsId = await group('Ops').getByRole('option').getAttribute('id');
  const supportId = await group('Support').getByRole('option').getAttribute('id');
  expect(opsId).not.toBe(supportId);
  await expect(search).toHaveAttribute('aria-activedescendant', opsId!);
  await search.press('ArrowDown');
  await expect(search).toHaveAttribute('aria-activedescendant', supportId!);
  await search.press('Enter');
  await expect(agentPicker(page)).toHaveText('Shared Agent');
});

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
  let decisions = 0;
  await page.route('**/test-agents/v1/models', route => route.abort());
  await page.route('**/gateway/*/decisions', route => { decisions++; return route.abort(); });
  await page.route('**/gateway/api/chat', async route => {
    const body = route.request().postDataJSON();
    if (!JSON.stringify(body.messages).includes('Run the browser agent')) return route.fulfill(stream('Welcome'));
    expect(body.agent).toBeUndefined();
    expect(body.model).toBe(model);
    expect(body.messages).toEqual(expect.arrayContaining([expect.objectContaining({ role: 'system' })]));
    await route.fulfill(stream('Browser reply'));
  });
  await start(page, [{ id: model, type: 'language' }, { id: model, type: 'decision' }]);
  await expect(page.getByText('Agent backend unavailable. Using a browser route.')).toBeVisible();
  await pickChatAgent(page);
  await routeGroup(page, 'Gateway');
  await expect(page.getByRole('menuitemradio', { name: '/api/chat', exact: true })).toHaveAttribute('aria-checked', 'true');
  await expectConversationalRoutes(page);
  await page.getByRole('menuitemradio', { name: '/api/chat', exact: true }).click();
  await send(page, 'Run the browser agent');
  await expect(page.getByText('Browser reply', { exact: true })).toBeVisible();
  expect(decisions).toBe(0);
});

test('browser Gateway agents route dual-use IDs once per turn and keep the winning model settings', async ({ page }) => {
  const alternate = 'openai/gpt-5-mini';
  const agent = { name: 'Routing agent', description: 'Selects an answer model.', instructions: 'Answer concisely.', models: [
    { id: model, type: 'language', providerMetadata: { service_tier: 'flex' } },
    { id: alternate, type: 'language', providerMetadata: { service_tier: 'priority' } },
  ] };
  await page.addInitScript(definition => {
    const scope = JSON.stringify([new URL('/gateway/api/chat', location.href).href, 'byok']);
    const key = `streaik.agents.v1:${scope}`;
    if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify({ version: 1, assignments: {}, overrides: [],
      local: [{ id: 'routing', definition }] }));
  }, agent);
  await page.route('**/test-agents/v1/models', route => route.abort());
  const sequence: string[] = [];
  await page.route('**/gateway/v1/decisions', route => {
    sequence.push('v1 decision');
    const body = route.request().postDataJSON();
    expect(body.model).toBe(model);
    expect(JSON.parse(body.input)).toEqual({ agent: { name: agent.name, description: agent.description, instructions: agent.instructions },
      conversation: [{ role: 'user', text: 'Route this agent turn' }] });
    expect(body.questions[0].choices.map(({ value }: { value: string }) => value)).toEqual([model, alternate]);
    return route.fulfill({ json: { answers: [{ name: 'chat_model', type: 'choice', choice: alternate }] } });
  });
  await page.route('**/gateway/api/decisions', route => {
    sequence.push('api decision');
    const body = route.request().postDataJSON();
    expect(Object.keys(body.questions.chat_model.criteria)).toEqual([model, alternate]);
    return route.fulfill({ json: { answers: { chat_model: { type: 'choice', choice: 'openai/not-offered' } } } });
  });
  const toolName = 'local_conversations_list_all';
  await page.route('**/gateway/api/chat', route => {
    const body = route.request().postDataJSON();
    const lastUser = body.messages.findLast(({ role }: { role: string }) => role === 'user');
    const text = lastUser?.parts[0]?.text;
    if (!['Route this agent turn', 'Use fallback', 'Skip routing'].includes(text)) return route.fulfill(stream('Welcome'));
    expect(body.agent).toBeUndefined();
    expect(body.decision).toBeUndefined();
    expect(JSON.stringify(body.messages)).not.toContain('streaik_client_model_decision');
    if (text !== 'Route this agent turn') {
      sequence.push(text);
      expect(body).toMatchObject({ model, providerMetadata: { openai: { service_tier: 'flex' } } });
      return route.fulfill(stream(text === 'Use fallback' ? 'Fallback reply' : 'Unrouted reply'));
    }
    expect(body).toMatchObject({ model: alternate, providerMetadata: { openai: { service_tier: 'priority' } } });
    if (sequence.includes('chat')) {
      sequence.push('continuation');
      expect(JSON.stringify(body.messages)).toContain('output-available');
      return route.fulfill(stream('Routed reply'));
    }
    sequence.push('chat');
    expect(body.tools).toEqual(expect.arrayContaining([expect.objectContaining({ name: toolName })]));
    const toolCallId = 'history-call';
    const chunks = [{ type: 'start' }, { type: 'start-step' },
      { type: 'reasoning-start', id: 'history-reasoning' },
      { type: 'reasoning-delta', id: 'history-reasoning', delta: 'Check chat history.' },
      { type: 'reasoning-end', id: 'history-reasoning' },
      { type: 'tool-input-available', toolCallId, toolName, input: {}, dynamic: true },
      { type: 'tool-approval-request', toolCallId, approvalId: 'review-history', signature: 'fixture-signature' },
      { type: 'finish-step' }, { type: 'finish', finishReason: 'tool-calls' }];
    return route.fulfill({ ...stream(''), body: chunks.map(chunk => `data: ${JSON.stringify(chunk)}\n\n`).join('') + 'data: [DONE]\n\n' });
  });
  await start(page, [{ id: model, name: 'Luna router', type: 'decision' }, { id: model, name: 'Luna answer', type: 'language' },
    { id: alternate, name: 'Mini answer', type: 'language' }]);
  await agentPicker(page).click();
  await page.getByRole('option', { name: agent.name, exact: true }).click();
  await page.getByRole('button', { name: 'Chat settings', exact: true }).click();
  const settings = page.getByRole('dialog', { name: 'Chat settings', exact: true });
  await settings.getByRole('tab', { name: 'Tools', exact: true }).click();
  await settings.getByRole('switch', { name: 'Chat History', exact: true }).check();
  await settings.getByRole('button', { name: 'Close', exact: true }).click();
  await send(page, 'Route this agent turn');
  await page.getByRole('dialog', { name: 'Approve tool execution' }).getByRole('button', { name: 'Approve and run', exact: true }).click();
  await expect(page.getByText('Routed reply', { exact: true })).toBeVisible();
  const activity = page.getByRole('article').filter({ hasText: 'Routed reply' }).getByRole('region', { name: 'Assistant activity' });
  await expect(activity).toHaveCount(1);
  await expect(activity).toContainText('2 of 2');
  await page.getByRole('button', { name: 'Account menu', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Settings', exact: true }).click();
  const outputSettings = page.getByRole('dialog', { name: 'Settings', exact: true });
  await outputSettings.getByRole('tab', { name: 'Chat', exact: true }).click();
  await outputSettings.getByRole('switch', { name: 'Show decisions', exact: true }).check();
  await outputSettings.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(activity).toHaveCount(1);
  await expect(activity).toContainText('3 of 3');
  await expect(activity.getByText(toolName, { exact: true })).toBeVisible();
  const previous = activity.getByRole('button', { name: 'Previous activity' });
  await previous.click();
  await expect(activity).toContainText('Check chat history.');
  await previous.click();
  await expect(activity).toContainText('1 of 3');
  await expect(activity.getByText('Decision', { exact: true })).toBeVisible();
  await expect(activity.getByRole('tabpanel', { name: 'Input', exact: true })).toContainText('/v1/decisions');
  expect(sequence).toEqual(['v1 decision', 'chat', 'continuation']);

  await routeGroup(page, 'Decisions');
  await page.getByRole('menuitemradio', { name: '/api/decisions', exact: true }).click();
  await send(page, 'Use fallback');
  await expect(page.getByText('Fallback reply', { exact: true })).toBeVisible();
  const fallback = page.getByRole('article').filter({ hasText: 'Fallback reply' }).getByRole('region', { name: 'Assistant activity' });
  await expect(fallback.getByText('Fallback used', { exact: true })).toBeVisible();
  await expect(fallback.getByRole('button', { name: 'Previous activity' })).toHaveCount(0);
  await fallback.getByRole('tab', { name: 'Output', exact: true }).click();
  await expect(fallback.getByRole('tabpanel', { name: 'Output', exact: true })).toContainText(model);
  await routeGroup(page, 'Decisions');
  await page.getByRole('menuitemradio', { name: 'Off', exact: true }).click();
  await send(page, 'Skip routing');
  await expect(page.getByText('Unrouted reply', { exact: true })).toBeVisible();
  expect(sequence).toEqual(['v1 decision', 'chat', 'continuation', 'api decision', 'Use fallback', 'Skip routing']);

  await page.getByRole('button', { name: 'Agents', exact: true }).click();
  await page.getByRole('article', { name: agent.name, exact: true }).getByRole('button', { name: 'Edit', exact: true }).click();
  const editor = page.getByRole('dialog', { name: 'Agent', exact: true });
  await editor.getByRole('button', { name: 'Add model', exact: true }).click();
  await editor.getByRole('option', { name: `Luna router (${model})`, exact: true }).click();
  await editor.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(editor).toBeHidden();
  const { origins } = await page.context().storageState();
  const saved = origins.flatMap(({ localStorage }) => localStorage).find(({ name }) => name.startsWith('streaik.agents.v1:'));
  expect(saved && JSON.parse(saved.value).local[0].definition).toEqual({ ...agent, models: [...agent.models, { id: model, type: 'decision' }] });
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
    expect(body.agent.tools.find((tool: { type: string }) => tool.type === 'skills')).toEqual({ type: 'skills',
      skills: [{ type: 'skill_reference', skill_id: skill.id, version: 'latest' }] });
    expect(body.agent).not.toHaveProperty('skills');
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
  const editor = page.getByRole('dialog', { name: 'Agent', exact: true });
  await editor.getByRole('tab', { name: 'Skills', exact: true }).click();
  await editor.getByRole('switch', { name: skill.name, exact: true }).check();
  if (mode === 'Agents') {
    const execution = editor.getByRole('combobox', { name: 'Execution', exact: true });
    await expect(execution).toHaveText('Default');
    for (const name of ['Hosted', 'Client', 'Default']) {
      await execution.click();
      await page.getByRole('option', { name, exact: true }).click();
      await expect(execution).toHaveText(name);
    }
  }
  await editor.getByRole('button', { name: 'Save', exact: true }).click();
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
