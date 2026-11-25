import { expect, test } from '@playwright/test';
import type { Page, Route } from '@playwright/test';

const agents = (page: Page) => page.getByRole('button', { name: 'Agents', exact: true });
const card = (page: Page, name: string) => page.getByRole('article', { name, exact: true });
const actions = (page: Page, name: string) => card(page, name).getByRole('button', { name: `More actions for ${name}`, exact: true });
const welcome = 'WelcomeMessageAgent';
const baseDescription = 'Creates short welcome messages.';

async function settings(page: Page, tab = 'Agents') {
  await page.getByRole('button', { name: 'Account menu', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Settings', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Settings', exact: true });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('tab', { name: tab, exact: true }).click();
  return dialog;
}

async function create(page: Page, name: string) {
  const createButton = page.getByRole('banner').getByRole('button', { name: 'Create agent', exact: true });
  await expect(createButton).toHaveText('');
  await createButton.click();
  const editor = page.getByRole('dialog', { name: 'Create agent', exact: true });
  await editor.getByLabel('Name', { exact: true }).fill(name);
  await editor.getByLabel('Description', { exact: true }).fill('A local definition.');
  await editor.getByLabel('Instructions', { exact: true }).fill('Write something helpful.');
  return editor;
}

const textAgentModel = 'openai/gpt-6-luna';
const replyModel = 'openai/gpt-4.1-mini';
const agentTestKey = 'test-agent-openai-key';

async function mockTextAgentModels(page: Page) {
  await page.route('**/gateway/v1/models', route => route.fulfill({ json: { data: [
    { id: replyModel, name: 'Answer model', type: 'language' },
    { id: textAgentModel, name: 'Text agent model', type: 'language' },
  ] } }));
}

async function enableOpenAI(page: Page) {
  const keys = await settings(page, 'API keys');
  await keys.getByRole('button', { name: 'Add API key', exact: true }).click();
  await keys.getByLabel('Provider', { exact: true }).selectOption({ label: 'OpenAI' });
  await keys.getByLabel('OpenAI API key', { exact: true }).fill(agentTestKey);
  await keys.getByRole('button', { name: 'Save OpenAI key', exact: true }).click();
  await keys.getByRole('button', { name: 'Close', exact: true }).click();
}

function finishText(route: Route, text: string, messageId = 'agent-reply') {
  const chunks = [{ type: 'start', messageId }, { type: 'text-start', id: 'text' },
    { type: 'text-delta', id: 'text', delta: text.slice(0, 5) }, { type: 'text-delta', id: 'text', delta: text.slice(5) },
    { type: 'text-end', id: 'text' }, { type: 'finish', finishReason: 'stop' }];
  return route.fulfill({ headers: { 'content-type': 'text/event-stream', 'x-vercel-ai-ui-message-stream': 'v1' },
    body: chunks.map(chunk => `data: ${JSON.stringify(chunk)}\n\n`).join('') + 'data: [DONE]\n\n' });
}

test('welcome app agent shows a skeleton and falls back to Welcome on failure or when disabled', async ({ page }) => {
  await mockTextAgentModels(page);
  const greeting = Promise.withResolvers<void>();
  let requests = 0;
  await page.route('**/gateway/api/chat', async route => {
    const body = route.request().postDataJSON();
    expect(body.model).toBe(textAgentModel);
    expect(body.tools).toBeUndefined();
    expect(await route.request().headerValue('x-openai-key')).toBe(agentTestKey);
    expect(body.messages.map(({ role }: { role: string }) => role)).toEqual(['system', 'user']);
    expect(body.messages[0].parts[0].text).toContain('Write a friendly, professional welcome message');
    if (++requests === 1) {
      await greeting.promise;
      await finishText(route, 'Good to see you');
    } else await route.fulfill({ status: 503 });
  });

  const fallback = page.getByRole('heading', { name: 'Welcome', exact: true });
  const newChat = page.getByRole('button', { name: 'New chat', exact: true });
  await page.goto('/');
  await expect(fallback).toBeVisible();
  await enableOpenAI(page);
  try {
    await expect.poll(() => requests).toBe(1);
    const loading = page.getByRole('heading', { name: 'Loading welcome message…' });
    await expect(loading).toHaveAttribute('aria-busy', 'true');
    await expect(loading.locator('.chat-welcome-skeleton')).toBeVisible();
  } finally { greeting.resolve(); }
  await expect(page.getByRole('heading', { name: 'Good to see you' })).toBeVisible();

  await newChat.click();
  await expect.poll(() => requests).toBe(2);
  await expect(fallback).toBeVisible();
  await expect(page.getByRole('alert')).toHaveCount(0);
  const dialog = await settings(page);
  await dialog.getByRole('combobox', { name: 'Welcome message', exact: true }).click();
  await dialog.getByRole('option', { name: 'None', exact: true }).click();
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();
  await newChat.click();
  await expect(fallback).toBeVisible();
  expect(requests).toBe(2);
});

test('conversation name uses the requested language and saves without losing later replies or pinning', async ({ page }) => {
  await mockTextAgentModels(page);
  const title = Promise.withResolvers<void>();
  const first = 'What should I see in Utrecht?';
  const second = 'Which places are free?';
  const generated = 'Bezienswaardigheden in Utrecht';
  let titles = 0;
  let replies = 0;
  await page.route('**/gateway/api/chat', async route => {
    const { model, messages, tools } = route.request().postDataJSON();
    if (model === textAgentModel) {
      if (messages[1].parts[0].text === 'Welcome the user to the app.') return finishText(route, 'Welcome to Streak');
      titles++;
      expect(tools).toBeUndefined();
      expect(messages).toEqual([
        { id: 'streaik-request-context', role: 'system', parts: [
          { type: 'text', text: expect.stringContaining('Name the conversation') },
          { type: 'text', text: expect.stringContaining('systemInformation') },
          { type: 'text', text: expect.stringContaining('"preferredLanguage":"nl"') },
        ] },
        { id: 'streaik-app-agent-input', role: 'user', parts: [{ type: 'text', text: first }] },
      ]);
      await title.promise;
      return finishText(route, `“${generated}”`);
    }
    expect(model).toBe(replyModel);
    expect(messages.slice(1).map(({ role }: { role: string }) => role)).toEqual(replies ? ['user', 'assistant', 'user'] : ['user']);
    expect(JSON.stringify(messages)).not.toContain('streaik-app-agent-input');
    return finishText(route, `Chat answer ${++replies}`, `chat-reply-${replies}`);
  });

  await page.goto('/');
  await enableOpenAI(page);
  await page.getByRole('button', { name: 'Model', exact: true }).click();
  await page.getByRole('option', { name: 'Text agent model', exact: true }).click();
  await page.getByRole('option', { name: 'Answer model', exact: true }).click();
  await page.keyboard.press('Escape');
  const general = await settings(page, 'General');
  await general.getByRole('combobox', { name: 'Language' }).selectOption('nl');
  await page.getByRole('dialog').getByRole('button', { name: 'Sluiten', exact: true }).click();
  const composer = page.getByRole('textbox', { name: 'Bericht', exact: true });
  try {
    await composer.fill(first);
    await composer.press('Enter');
    await expect(page.getByText('Chat answer 1')).toBeVisible();
    await expect.poll(() => titles).toBe(1);
    await page.getByRole('button', { name: 'Navigatie in- of uitklappen' }).click();
    await page.getByRole('button', { name: `Meer acties voor ${first}` }).press('ArrowDown');
    await page.getByRole('menuitem', { name: 'Vastzetten', exact: true }).click();
    await composer.fill(second);
    await composer.press('Enter');
    await expect(page.getByText('Chat answer 2')).toBeVisible();
  } finally { title.resolve(); }

  const pinned = page.getByRole('list', { name: 'Vastgezet' }).getByRole('button', { name: generated, exact: true });
  await expect(pinned).toBeVisible();
  await expect(page.getByRole('main').getByText(generated, { exact: true })).toHaveCount(0);
  await page.reload();
  await expect(page.getByText('Chat answer 1')).toBeVisible();
  await expect(page.getByText('Chat answer 2')).toBeVisible();
  await page.getByRole('button', { name: 'Navigatie in- of uitklappen' }).click();
  await expect(pinned).toBeVisible();
  expect(titles).toBe(1);
});

test('browser-only agent creation, search, deletion and assignments', async ({ page }) => {
  const network: string[] = [];
  page.on('request', (request) => { if (new URL(request.url()).pathname.startsWith('/gateway/')) network.push(request.url()); });
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Agents', exact: true })).toBeVisible();
  const draft = page.getByRole('textbox', { name: 'Message', exact: true });
  await draft.fill('Keep this unsent draft');
  await agents(page).click();
  await expect(page.getByRole('heading', { name: 'Agents', level: 1, exact: true })).toBeVisible();
  await expect(page.getByText('Manage agent definitions in this browser. Agent chat is not available yet.', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Back to chat', exact: true })).toHaveCount(0);
  await expect(page.getByRole('main').getByRole('button', { name: 'Create agent', exact: true })).toHaveCount(0);
  await expect(card(page, welcome)).toContainText('Sample agent');
  const editor = await create(page, 'My agent');
  await expect(editor.getByRole('button', { name: 'Add model', exact: true })).toBeDisabled();
  await editor.getByLabel('Description', { exact: true }).fill(' ');
  await editor.getByRole('tab', { name: 'Details' }).click();
  await editor.getByLabel('Owner').fill('Local owner');
  await editor.getByLabel('Tag', { exact: true }).fill('offline-tag');
  await editor.getByLabel('Tag', { exact: true }).press('Enter');
  await editor.getByRole('button', { name: 'Save agent' }).click();
  await expect(editor.getByRole('alert')).toHaveText('Name, description, and instructions are required.');
  await expect(editor.getByRole('tab', { name: 'General' })).toHaveAttribute('aria-selected', 'true');
  await editor.getByLabel('Description', { exact: true }).fill('A local definition.');
  await editor.getByRole('button', { name: 'Save agent' }).click();
  await expect(editor).toBeHidden();
  const search = page.getByRole('searchbox', { name: 'Search agents' });
  await search.fill('TAG defin');
  await expect(card(page, 'My agent')).toBeVisible();
  await expect(card(page, welcome)).toHaveCount(0);
  await search.fill('something helpful');
  await expect(page.getByText('No matching agents.')).toBeVisible();
  await search.clear();
  await expect(card(page, welcome)).toBeVisible();
  await page.getByRole('button', { name: 'New chat', exact: true }).click();
  await expect(draft).toHaveValue('');
  const dialog = await settings(page);
  const panel = dialog.getByRole('tabpanel', { name: 'Agents', exact: true });
  await expect(panel.getByRole('heading', { name: 'Agents', exact: true })).toBeVisible();
  await expect(panel.getByText('Choose an agent for each role', { exact: false })).toHaveCount(0);
  const select = dialog.getByRole('combobox', { name: 'Welcome message', exact: true });
  await expect(select).toHaveText(welcome);
  await select.click();
  await expect(dialog.getByRole('option', { name: 'Use sample default', exact: false })).toHaveCount(0);
  await dialog.getByRole('option', { name: 'My agent', exact: true }).click();

  await page.reload();
  await agents(page).click();
  const local = card(page, 'My agent');
  await expect(local).toContainText('offline-tag');
  await expect(local.locator('.catalog-mark')).toHaveText('MY');
  const editButton = local.locator('header').getByRole('button', { name: 'Edit', exact: true });
  await expect(editButton).toHaveText('');
  await editButton.click();
  const edit = page.getByRole('dialog', { name: 'Edit agent', exact: true });
  await edit.getByRole('tab', { name: 'Details' }).click();
  await expect(edit.getByLabel('Owner')).toHaveValue('Local owner');
  await expect(edit.getByRole('button', { name: 'Remove tag offline-tag' })).toBeVisible();
  await edit.getByRole('button', { name: 'Remove tag offline-tag' }).click();
  await page.keyboard.press('Escape');
  await expect(editButton).toBeFocused();
  await expect(local).toContainText('offline-tag');
  await expect(local.getByRole('button', { name: 'Delete', exact: true })).toHaveCount(0);
  await search.fill('offline-tag');
  await actions(page, 'My agent').click();
  await page.getByRole('menuitem', { name: 'Delete', exact: true }).click();
  await page.getByRole('dialog', { name: 'Delete agent' }).getByRole('button', { name: 'Delete agent', exact: true }).click();
  await expect(local).toHaveCount(0);
  await expect(page.getByText('No matching agents.')).toBeVisible();
  await expect(search).toBeFocused();
  await settings(page);
  await expect(select).toHaveText('Unavailable agent');
  expect(network).toEqual([]);
});

test('a sample can be duplicated from the keyboard-accessible card menu', async ({ page }) => {
  await page.goto('/');
  await agents(page).click();
  const trigger = actions(page, welcome);
  await expect(card(page, welcome).locator('header').getByRole('button', { name: `More actions for ${welcome}`, exact: true })).toHaveText('');
  await expect(trigger.locator('svg.lucide-ellipsis-vertical')).toBeVisible();
  await expect(card(page, welcome).getByRole('button', { name: 'Duplicate', exact: true })).toHaveCount(0);
  await trigger.press('ArrowDown');
  const menu = page.getByRole('menu');
  const duplicate = menu.getByRole('menuitem', { name: 'Duplicate', exact: true });
  await expect(duplicate).toBeFocused();
  await expect(menu.getByRole('menuitem')).toHaveCount(1);
  await page.keyboard.press('Enter');
  await expect(menu).toBeHidden();
  const editor = page.getByRole('dialog', { name: 'Create agent', exact: true });
  await expect(editor.getByLabel('Name', { exact: true })).toHaveValue(`${welcome} copy`);
  const closeHint = editor.getByRole('tooltip', { name: 'Close', exact: true });
  await expect(closeHint).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(closeHint).toBeHidden();
  await page.keyboard.press('Escape');
  await expect(trigger).toBeFocused();
});

test('catalog-backed models and Realtime settings persist without starting audio sessions', async ({ page }) => {
  const calls: string[] = [];
  page.on('request', (request) => { if (new URL(request.url()).pathname.startsWith('/gateway/')) calls.push(request.method()); });
  const catalog = [
    { id: 'openai/chat-example', name: 'Answer model', type: 'language' },
    { id: 'anthropic/router', name: 'Decision router', type: 'decision' },
    { id: 'openai/live-transcribe', name: 'Live transcription', type: 'transcription', tags: ['real-time'] },
    { id: 'openai/batch-transcribe', name: 'Batch transcription', type: 'transcription' },
    { id: 'openai/example-tts', name: 'Voice model', type: 'speech' },
    { id: 'openai/example-live-audio', name: 'Generic audio', type: 'audio', tags: ['realtime'] },
  ];
  let available = true;
  await page.route('**/gateway/v1/models', (route) => route.fulfill({ json: { data: available ? catalog : [] } }));
  await page.goto('/');
  await enableOpenAI(page);
  await agents(page).click();

  const editor = await create(page, 'Audio agent');
  await editor.getByLabel('Argument hint').fill('Describe the result');
  const addModel = editor.getByRole('button', { name: 'Add model', exact: true });
  await addModel.click();
  await expect(editor.getByRole('option')).toHaveCount(4);
  await expect(editor.getByRole('option', { name: /Live transcription/ })).toBeVisible();
  await expect(editor.getByRole('option', { name: /Batch transcription/ })).toBeVisible();
  await editor.getByRole('option', { name: /Answer model/ }).click();
  await addModel.click();
  await editor.getByRole('option', { name: /Decision router/ }).click();
  await editor.getByRole('button', { name: 'Move anthropic/router up' }).click();
  const realtime = editor.getByRole('tab', { name: 'Realtime', exact: true });
  await realtime.click();
  await expect(editor.getByText(/Configure audio models/)).toHaveCount(0);
  const transcription = editor.getByRole('button', { name: 'Transcription model', exact: true });
  await transcription.click();
  await expect(editor.getByRole('option')).toHaveText(['None', 'Live transcription (openai/live-transcribe)']);
  await editor.getByRole('option', { name: /Live transcription/ }).click();
  await editor.getByRole('button', { name: 'Speech model', exact: true }).click();
  await expect(editor.getByRole('option')).toHaveText(['None', 'Voice model (openai/example-tts)']);
  await editor.getByRole('option', { name: /Voice model/ }).click();
  await editor.getByLabel('Voice', { exact: true }).fill('alloy');
  await editor.getByLabel('Speech instructions').fill('Speak clearly.');
  await editor.getByLabel('Language', { exact: true }).fill('en');
  await editor.getByLabel('Speed', { exact: true }).fill('-1');
  await expect(editor.getByLabel('Sample rate (Hz)')).toBeDisabled();
  await editor.getByLabel('Audio format', { exact: true }).fill('audio/pcm');
  await editor.getByLabel('Sample rate (Hz)').fill('24000');
  await editor.getByRole('tab', { name: 'Details', exact: true }).click();
  await editor.getByRole('button', { name: 'Save agent' }).click();
  await expect(realtime).toHaveAttribute('aria-selected', 'true');
  await expect(editor.getByRole('alert')).toHaveText('Speech speed must be a positive number.');
  await editor.getByLabel('Speed', { exact: true }).fill('1.15');
  await editor.getByRole('button', { name: 'Save agent' }).click();
  const local = card(page, 'Audio agent');
  await expect(local.locator('.catalog-mark img')).toHaveAttribute('src', /\/openai\.png$/);

  available = false;
  await page.reload();
  await agents(page).click();
  await local.getByRole('button', { name: 'Edit', exact: true }).click();
  const edit = page.getByRole('dialog', { name: 'Edit agent', exact: true });
  await expect(edit.getByLabel('Argument hint')).toHaveValue('Describe the result');
  await expect(edit.getByRole('listitem')).toHaveText([/anthropic\/router/, /openai\/chat-example/]);
  await edit.getByRole('tab', { name: 'Realtime' }).click();
  await expect(edit.getByRole('button', { name: 'Transcription model' })).toContainText('openai/live-transcribe (saved, unavailable)');
  await expect(edit.getByRole('button', { name: 'Speech model' })).toContainText('openai/example-tts (saved, unavailable)');
  for (const [label, value] of [['Voice', 'alloy'], ['Speech instructions', 'Speak clearly.'], ['Language', 'en'], ['Speed', '1.15'],
    ['Audio format', 'audio/pcm'], ['Sample rate (Hz)', '24000']]) await expect(edit.getByLabel(label, { exact: true })).toHaveValue(value);
  await edit.getByRole('button', { name: 'Save agent' }).click();
  expect(calls.length).toBeGreaterThan(0);
  expect(calls.every((method) => method === 'GET')).toBe(true);
});

test('Agents share provider forms and use the selected model’s saved native settings', async ({ page }) => {
  const alternate = 'openai/example-alternate';
  const cerebras = 'cerebras/gpt-oss-120b';
  const together = 'together/openai/gpt-oss-20b';
  const agentName = 'Configured text agent';
  const unknownOption = { values: [0, false, null] };
  const models = [
    { id: textAgentModel, providerMetadata: { service_tier: 'flex' } },
    { id: alternate, providerMetadata: { service_tier: 'default', future_field: unknownOption } },
    { id: cerebras, providerMetadata: { reasoning_effort: 'high', seed: 0 } },
    { id: together, providerMetadata: { reasoning_effort: 'low' } },
  ];
  await page.addInitScript(({ agentName, models }) => {
    const scope = JSON.stringify([new URL('/gateway/api/chat', location.href).href, 'byok']);
    const key = `streaik.agents.v1:${scope}`;
    if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify({ version: 1, overrides: [], local: [{
      id: 'configured', definition: { name: agentName, description: 'Portable native settings.', instructions: 'Write short text.', models },
    }], assignments: { 'welcome-message': 'local:configured', 'conversation-name': 'local:configured' } }));
  }, { agentName, models });
  await page.route('**/gateway/v1/models', route => route.fulfill({ json: { data: [
    { id: replyModel, name: 'Answer model', type: 'language' },
    { id: textAgentModel, name: 'Text agent model', type: 'language' },
    { id: alternate, name: 'Alternate model', type: 'language' },
  ] } }));
  const requests: { model: string; textAgent: boolean; welcome: boolean; metadata: unknown; beta: string | null }[] = [];
  await page.route('**/gateway/api/chat', async route => {
    const { model, messages, providerMetadata } = route.request().postDataJSON();
    const textAgent = messages[1]?.id === 'streaik-app-agent-input';
    const welcome = textAgent && messages[1].parts[0].text === 'Welcome the user to the app.';
    const beta = await route.request().headerValue('openai-beta');
    requests.push({ model, textAgent, welcome, metadata: providerMetadata, beta });
    return finishText(route, welcome ? 'Welcome to Streak' : textAgent ? 'Configured title' : 'Regular chat response');
  });

  await page.goto('/');
  await enableOpenAI(page);
  await expect.poll(() => requests.find(request => request.welcome)).toMatchObject({
    model: textAgentModel, metadata: { openai: { service_tier: 'flex' } },
  });
  await agents(page).click();
  const openEditor = () => card(page, agentName).getByRole('button', { name: 'Edit', exact: true }).click();
  await openEditor();
  const editor = page.getByRole('dialog', { name: 'Edit agent', exact: true });
  const tab = (name: string) => editor.getByRole('tab', { name, exact: true });
  const modelPicker = editor.getByRole('combobox', { name: 'Model', exact: true });
  const tier = editor.getByRole('combobox', { name: 'Service tier', exact: true });
  await tab('OpenAI').click();
  await expect(tier).toHaveValue('flex');
  await expect(editor.getByText(/Add ordered native context management rules/)).toHaveCount(0);
  await tier.selectOption('scale');
  await modelPicker.selectOption({ label: `Alternate model (${alternate})` });
  await expect(tier).toHaveValue('default');
  await tier.selectOption('priority');
  await editor.getByRole('button', { name: 'Add compaction rule' }).click();
  await editor.getByRole('spinbutton', { name: 'Compaction threshold' }).fill('4096');
  await editor.getByRole('switch', { name: 'Enable multi-agent responses' }).check();

  await tab('Cerebras').click();
  await expect(editor.getByRole('combobox', { name: 'Reasoning effort' })).toHaveValue('high');
  await expect(editor.getByRole('spinbutton', { name: 'Seed', exact: true })).toHaveValue('0');
  await tab('Together AI').click();
  await expect(editor.getByRole('combobox', { name: 'Reasoning effort' })).toHaveValue('low');
  await tab('General').click();
  await editor.getByRole('button', { name: `Remove model ${together}` }).click();
  await expect(tab('Together AI')).toHaveCount(0);
  await editor.getByRole('button', { name: `Move ${alternate} up` }).click();
  await tab('OpenAI').click();
  await expect(tier).toHaveValue('priority');
  await modelPicker.selectOption({ label: `Text agent model (${textAgentModel})` });
  await expect(tier).toHaveValue('scale');
  await editor.getByRole('button', { name: 'Save agent' }).click();

  const native = { openai: {
    service_tier: 'priority', future_field: unknownOption,
    context_management: [{ type: 'compaction', compact_threshold: 4096 }],
    multi_agent: { enabled: true, max_concurrent_subagents: 3 },
  } };
  await page.getByRole('button', { name: 'New chat', exact: true }).click();
  await expect.poll(() => requests.findLast(request => request.welcome)).toMatchObject({
    model: alternate, metadata: native, beta: 'responses_multi_agent=v1',
  });
  const composer = page.getByRole('textbox', { name: 'Message', exact: true });
  await composer.fill('A normal chat message');
  await composer.press('Enter');
  await expect(page.getByText('Regular chat response', { exact: true })).toBeVisible();
  await expect.poll(() => requests.find(request => request.textAgent && !request.welcome)).toMatchObject({
    model: alternate, metadata: native, beta: 'responses_multi_agent=v1',
  });
  expect(requests.find(request => !request.textAgent)?.metadata).toBeUndefined();

  await page.reload();
  await agents(page).click();
  await openEditor();
  await tab('OpenAI').click();
  await expect(tier).toHaveValue('priority');
  await expect(editor.getByRole('spinbutton', { name: 'Compaction threshold' })).toHaveValue('4096');
  await expect(tab('Together AI')).toHaveCount(0);
});

test('agent cards share provider icons and fall back when themed icons fail or are removed', async ({ page }) => {
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><rect width="32" height="32" fill="purple"/></svg>';
  await page.route('**/agent-mark.svg', (route) => route.fulfill({ contentType: 'image/svg+xml', body: svg }));
  await page.route('**/agent-light.svg', (route) => route.fulfill({ contentType: 'image/svg+xml', body: svg }));
  await page.route('**/agent-dark.svg', (route) => route.fulfill({ status: 404 }));
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto('/');
  await agents(page).click();
  const sample = card(page, welcome);
  const icon = sample.locator('.catalog-mark img');
  await expect(icon).toHaveAttribute('src', /\/openai\.png$/);
  await sample.getByRole('button', { name: 'Edit', exact: true }).click();
  const edit = page.getByRole('dialog', { name: 'Edit agent', exact: true });
  const details = edit.getByRole('tab', { name: 'Details', exact: true });
  await details.click();
  await edit.getByLabel('Icon URL', { exact: true }).fill('/agent-mark.svg');
  await edit.getByRole('button', { name: 'Add icon', exact: true }).click();
  for (const [theme, path] of [['Light', '/agent-light.svg'], ['Dark', '/agent-dark.svg']]) {
    await edit.getByLabel('Icon URL', { exact: true }).fill(path);
    await edit.getByRole('combobox', { name: 'Icon theme', exact: true }).click();
    await edit.getByRole('option', { name: theme, exact: true }).click();
    await edit.getByRole('button', { name: 'Add icon', exact: true }).click();
  }
  await edit.getByRole('button', { name: 'Save agent' }).click();
  await expect(icon).toHaveAttribute('src', '/agent-light.svg');
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect(icon).toHaveAttribute('src', '/agent-mark.svg');

  await sample.getByRole('button', { name: 'Edit', exact: true }).click();
  await details.click();
  await edit.getByRole('button', { name: 'Remove icon 1', exact: true }).click();
  await edit.getByRole('button', { name: 'Save agent' }).click();
  await expect(icon).toHaveAttribute('src', /\/openai\.png$/);
});

test('sample overrides persist and reset without changing explicit role choices', async ({ page }) => {
  await page.goto('/');
  const dialog = await settings(page);
  const welcomeRole = dialog.getByRole('combobox', { name: 'Welcome message', exact: true });
  const conversationRole = dialog.getByRole('combobox', { name: 'Conversation name', exact: true });
  await welcomeRole.click();
  await dialog.getByRole('option', { name: 'None', exact: true }).click();
  await conversationRole.click();
  await dialog.getByRole('option', { name: welcome, exact: true }).click();
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();
  await agents(page).click();
  await card(page, welcome).getByRole('button', { name: 'Edit', exact: true }).click();
  const editor = page.getByRole('dialog', { name: 'Edit agent', exact: true });
  await expect(editor.getByLabel('Name', { exact: true })).toHaveAttribute('readonly', '');
  await editor.getByLabel('Description', { exact: true }).fill('Custom sample description.');
  await editor.getByRole('button', { name: 'Save agent' }).click();

  await page.reload();
  await agents(page).click();
  await expect(card(page, welcome)).toContainText('Custom sample description.');
  await expect(card(page, welcome)).toContainText('Local override');
  const reset = 'Reset to sample default';
  await actions(page, welcome).click();
  await page.getByRole('menuitem', { name: reset, exact: true }).click();
  await page.getByRole('dialog', { name: reset }).getByRole('button', { name: reset, exact: true }).click();
  await expect(card(page, welcome)).toContainText(baseDescription);
  await expect(card(page, welcome)).not.toContainText('Local override');
  await settings(page);
  await expect(welcomeRole).toHaveText('None');
  await expect(conversationRole).toHaveText(welcome);
});

test('only the active Entra profile sees its agent overrides, definitions and choices', async ({ page }) => {
  await page.route((url) => url.port === '15174' && url.pathname === '/src/auth.ts', (route) => route.fulfill({
    contentType: 'application/javascript',
    body: `export async function createEntraAuth() {
      const id = sessionStorage.getItem('test-agent-account') ?? 'alpha';
      return {
        getAccount: () => id === 'signed-out' ? null : { homeAccountId: id, environment: 'test', tenantId: 'test', name: id },
        headers: () => new Headers(),
      };
    }`,
  }));
  await page.route('**/gateway/v1/models', (route) => route.fulfill({ json: { data: [] } }));
  await page.goto('http://localhost:15174');
  await agents(page).click();
  await (await create(page, 'Alpha only')).getByRole('button', { name: 'Save agent' }).click();
  await expect(card(page, 'Alpha only')).toBeVisible();
  await card(page, welcome).getByRole('button', { name: 'Edit', exact: true }).click();
  const editor = page.getByRole('dialog', { name: 'Edit agent', exact: true });
  await editor.getByLabel('Description', { exact: true }).fill('Alpha override.');
  await editor.getByRole('button', { name: 'Save agent' }).click();
  await expect(card(page, welcome)).toContainText('Alpha override.');
  const dialog = await settings(page);
  const select = dialog.getByRole('combobox', { name: 'Welcome message', exact: true });
  await select.click();
  await dialog.getByRole('option', { name: 'Alpha only', exact: true }).click();

  for (const account of ['signed-out', 'beta', 'alpha']) {
    await page.evaluate((id) => sessionStorage.setItem('test-agent-account', id), account);
    await page.reload();
    if (account === 'signed-out') {
      await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible();
      await expect(agents(page)).toHaveCount(0);
      continue;
    }
    await agents(page).click();
    await expect(card(page, 'Alpha only')).toHaveCount(account === 'alpha' ? 1 : 0);
    await expect(card(page, welcome)).toContainText(account === 'alpha' ? 'Alpha override.' : baseDescription);
    await settings(page);
    await expect(select).toHaveText(account === 'alpha' ? 'Alpha only' : welcome);
  }
});

for (const theme of ['html', 'fluent']) {
  test(`${theme} agent editor is labeled and closes with Escape`, async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 640 });
    await page.goto('/');
    const dialog = await settings(page, 'Theme');
    const themePanel = dialog.getByRole('tabpanel', { name: 'Theme' });
    await themePanel.getByRole('combobox', { name: 'Theme', exact: true }).selectOption(theme);
    await expect(themePanel.getByRole('group', { name: `${theme === 'html' ? 'HTML' : 'Fluent'} settings` })).toBeVisible();
    await dialog.getByRole('tab', { name: 'Agents', exact: true }).click();
    await dialog.getByRole('combobox', { name: 'Welcome message', exact: true }).selectOption('none');
    await dialog.getByRole('button', { name: 'Close', exact: true }).click();
    await agents(page).click();
    const editor = await create(page, `${theme} unsaved`);
    await expect(editor.getByRole('textbox', { name: 'Instructions', exact: true })).toBeFocused();
    const general = editor.getByRole('tab', { name: 'General', exact: true });
    await general.press('ArrowRight');
    await expect(editor.getByRole('tab', { name: 'Details', exact: true })).toBeFocused();
    await page.keyboard.press('End');
    await expect(editor.getByRole('tabpanel', { name: 'Realtime', exact: true })).toBeVisible();
    await page.keyboard.press('Home');
    await expect(general).toBeFocused();
    await expect(editor.getByLabel('Instructions', { exact: true })).toHaveValue('Write something helpful.');
    await page.keyboard.press('Escape');
    await expect(editor).toBeHidden();
    await expect(page.getByRole('button', { name: 'Create agent', exact: true })).toBeFocused();
    await expect(card(page, `${theme} unsaved`)).toHaveCount(0);
  });
}
