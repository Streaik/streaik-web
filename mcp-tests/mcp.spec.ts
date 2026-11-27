import { expect, test } from '@playwright/test';
import type { APIRequestContext, APIResponse, Page, Request } from '@playwright/test';
import { completeMcpArgument, discoverMcpServer, fetchMcpCatalog, mcpAppAuth } from '../packages/chat/src/mcp';
import { acceptsEntraMcpToken, readMcpConfig } from '../samples/shared/mcpConfig';

const model = 'openai/gpt-4.1-mini';
const mcp = 'http://localhost:15281';
const delegated = 'http://localhost:15282';
const registryUrl = 'http://localhost:15283/v0.1/servers';
const version = '2026-07-28';
const auth = { openai: { Authorization: 'Bearer browser-openai' }, google: { 'x-goog-api-key': 'browser-google' },
  anthropic: { 'x-api-key': 'browser-anthropic' } };
const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jf2sAAAAASUVORK5CYII=';
const openAiError = 'OpenAI request failed (HTTP 400) [invalid_size, field: size]: This model does not support the requested size. Key: [redacted]';
const openAiToolError = { isError: true, content: [{ type: 'text', text: openAiError }] };

function sse(events: unknown[]) { return events.map(event => `data: ${JSON.stringify(event)}\n\n`).join('') + 'data: [DONE]\n\n'; }

async function setOpenAiKey(page: Page) {
  await page.getByRole('button', { name: 'Account menu' }).click();
  await page.getByRole('menuitem', { name: 'Settings' }).click();
  await page.getByRole('tab', { name: 'API keys', exact: true }).click();
  await page.getByRole('button', { name: 'Add API key', exact: true }).click();
  await page.getByLabel('Provider', { exact: true }).selectOption('openai');
  await page.getByLabel('OpenAI API key').fill('browser-openai');
  await page.getByRole('button', { name: 'Save OpenAI key' }).click();
  await page.getByRole('button', { name: 'Close', exact: true }).click();
}

async function addManualServer(page: Page, title: string, url: string, authorization = auth.openai.Authorization) {
  await page.getByRole('button', { name: 'Model Context', exact: true }).click();
  await page.getByRole('button', { name: 'Add by URL' }).click();
  const editor = page.getByRole('dialog', { name: 'Add MCP server' });
  await editor.getByLabel('Name', { exact: true }).fill(title);
  await editor.getByLabel('URL', { exact: true }).fill(url);
  await editor.getByRole('button', { name: 'Add header' }).click();
  await editor.getByLabel('Header name').fill('Authorization');
  await editor.getByLabel('Header value').fill(authorization);
  await editor.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(editor).toHaveCount(0);
}

async function openModelContext(page: Page) {
  await page.getByRole('button', { name: 'Add to message' }).click();
  await page.getByRole('menuitem', { name: 'Model Context', exact: true }).click();
  return page.getByRole('dialog', { name: 'Model Context' });
}

async function selectServer(page: Page, name: string, count: number) {
  const picker = await openModelContext(page);
  await expect(picker.getByRole('tab', { name: 'Installed' })).toHaveAttribute('aria-selected', 'true');
  const toggle = picker.getByRole('switch', { name, exact: true });
  await expect(toggle).not.toBeChecked();
  await toggle.check();
  await expect(picker.getByText(`${count} tools available`)).toBeVisible();
  await picker.getByRole('button', { name: 'Close' }).click();
}

async function exerciseChat(page: Page, approve: boolean, manual = false, rejectUpstream = false) {
  const endpoint = `${manual ? delegated : mcp}/openai-images`;
  const authorization = manual ? 'Bearer test-mcp-token' : auth.openai.Authorization;
  const toolRequests: Request[] = [];
  const calls: string[] = [];
  const mcpFailures: string[] = [];
  let chatRequests = 0;
  let decisions = 0;
  const routed = !approve && !manual && !rejectUpstream;
  const prompt = rejectUpstream ? 'Reject my image' : 'A tiny landscape';
  const candidate = 'openai/gpt-5-nano';
  const router = 'openai/test-router';
  const instructions = 'Choose the model most suitable for concise image prompts.';
  await page.route('**/gateway/v1/models', route => route.fulfill({ json: { data: [
    { id: model }, ...(routed ? [{ id: candidate }, { id: router, type: 'decision', name: 'Test router' }] : []),
  ] } }));
  await page.route('**/gateway/v1/decisions', (route) => {
    decisions++;
    expect(routed).toBe(true);
    expect(route.request().postDataJSON()).toMatchObject({ model: router, questions: [{ name: 'chat_model', instructions }] });
    return route.fulfill({ json: { answers: [{ name: 'chat_model', type: 'choice', choice: candidate }] } });
  });
  page.on('request', request => {
    if (request.url() !== endpoint || request.method() === 'OPTIONS') return;
    toolRequests.push(request);
    if (request.method() === 'POST' && request.postDataJSON().method === 'tools/call') calls.push(request.postDataJSON().params.name);
  });
  page.on('response', async response => {
    if (response.url() === endpoint && response.request().method() === 'POST' && response.request().postDataJSON().method === 'tools/call')
      mcpFailures.push(await response.text().catch(() => `HTTP ${response.status()}`));
  });
  await page.route('**/gateway/api/chat', async route => {
    chatRequests++;
    const sent = route.request().postDataJSON();
    const tool = sent.tools.map((tool: { name: string }) => tool.name).find((name: string) => name.endsWith('_OpenAIImages_CreateImage'));
    expect(sent.model).toBe(routed ? candidate : model);
    expect(sent).not.toHaveProperty('clientToolResultApproval');
    expect(tool).toMatch(manual ? /^mcp_[\w-]+_OpenAIImages_CreateImage$/ : /^mcp_openai_images_OpenAIImages_CreateImage$/);
    expect(sent.tools.map((tool: { name: string }) => tool.name).filter((name: string) => name.startsWith('mcp_'))).toHaveLength(3);
    const headers = { 'content-type': 'text/event-stream', 'x-vercel-ai-ui-message-stream': 'v1' };
    if (chatRequests === 1) {
      await route.fulfill({ headers, body: sse([
        { type: 'start', messageId: 'mcp-assistant' }, { type: 'start-step' },
        { type: 'tool-input-available', toolCallId: 'fixture-tool', toolName: tool, input: { prompt }, dynamic: true },
        { type: 'tool-approval-request', toolCallId: 'fixture-tool', approvalId: 'fixture-review' },
        { type: 'finish-step' }, { type: 'finish', finishReason: 'tool-calls' },
      ]) });
    } else {
      const reviewed = sent.messages.at(-1).parts.find((part: { toolCallId?: string }) => part.toolCallId === 'fixture-tool');
      expect(reviewed, mcpFailures.join('\n')).toMatchObject({
        state: approve ? 'output-available' : 'approval-responded',
        approval: { id: 'fixture-review', approved: approve },
      });
      expect(reviewed.approval).not.toHaveProperty('signature');
      if (approve) expect(reviewed.output).toMatchObject(rejectUpstream ? openAiToolError : {
        content: [{ type: 'image', mimeType: 'image/png', data: png.split(',')[1] }],
      });
      else expect(reviewed).not.toHaveProperty('output');
      expect(JSON.stringify(sent)).not.toContain('browser-openai');
      expect(JSON.stringify(sent)).not.toContain('test-mcp-token');
      if (!approve || rejectUpstream) expect(JSON.stringify(sent)).not.toContain('iVBOR');
      await route.fulfill({ headers, body: sse([
        { type: 'start', messageId: 'mcp-assistant' }, { type: 'start-step' },
        { type: 'text-start', id: 'reply' }, { type: 'text-delta', id: 'reply', delta: 'Chat continued after MCP.' },
        { type: 'text-end', id: 'reply' }, { type: 'finish-step' }, { type: 'finish', finishReason: 'stop' },
      ]) });
    }
  });

  await page.goto('/');
  await setOpenAiKey(page);
  if (manual) await addManualServer(page, 'Manual images', endpoint, authorization);
  else {
    await page.getByRole('button', { name: 'Model Context', exact: true }).click();
    await page.getByRole('tab', { name: 'Registry', exact: true }).click();
    await page.getByRole('button', { name: 'Install OpenAI Images' }).click();
    await page.getByRole('tab', { name: 'Installed', exact: true }).click();
    await expect(page.getByRole('tabpanel', { name: 'Installed' }).getByRole('heading', { name: 'OpenAI Images', exact: true })).toBeVisible();
  }
  await page.getByRole('button', { name: 'New chat', exact: true }).click();
  if (approve && !rejectUpstream) {
    await page.getByRole('button', { name: 'Account menu', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Settings', exact: true }).click();
    const settings = page.getByRole('dialog', { name: 'Settings' });
    await settings.getByRole('tab', { name: 'Chat', exact: true }).click();
    await settings.getByRole('switch', { name: 'Images', exact: true }).check();
    await settings.getByRole('button', { name: 'Close', exact: true }).click();
  }
  if (routed) {
    await page.getByRole('button', { name: 'Agents', exact: true }).click();
    await page.getByRole('button', { name: 'Create agent', exact: true }).click();
    const editor = page.getByRole('dialog', { name: 'Create agent', exact: true });
    await editor.getByLabel('Name', { exact: true }).fill('Fixture router');
    await editor.getByLabel('Description', { exact: true }).fill('Selects the chat model.');
    await editor.getByLabel('Instructions', { exact: true }).fill(instructions);
    await editor.getByRole('button', { name: 'Add model', exact: true }).click();
    await editor.getByRole('option', { name: `Test router (${router})`, exact: true }).click();
    await editor.getByRole('button', { name: 'Save', exact: true }).click();
    await page.getByRole('button', { name: 'New chat', exact: true }).click();
    await page.getByRole('button', { name: 'Account menu' }).click();
    await page.getByRole('menuitem', { name: 'Settings' }).click();
    await page.getByRole('tab', { name: 'Agents', exact: true }).click();
    await page.getByRole('combobox', { name: 'Select a model', exact: true }).click();
    await page.getByRole('option', { name: 'Fixture router', exact: true }).click();
    await page.getByRole('button', { name: 'Close', exact: true }).click();
    await page.getByRole('button', { name: 'Model', exact: true }).click();
    await page.getByRole('option', { name: 'gpt-5-nano', exact: true }).click();
    await page.keyboard.press('Escape');
  }
  await selectServer(page, manual ? 'Manual images' : 'OpenAI Images', 3);
  await page.getByRole('textbox', { name: 'Message', exact: true }).fill('Create a tiny landscape.');
  await page.getByRole('button', { name: 'Send', exact: false }).click();
  const review = page.getByRole('dialog', { name: 'Review tool result' });
  if (rejectUpstream) await expect(review.getByRole('tabpanel', { name: 'Text' })).toContainText(openAiError);
  await expect(page.getByRole('dialog', { name: 'Approve tool execution' })).toHaveCount(0);
  if (!rejectUpstream) {
    await expect(review.getByRole('tab', { name: 'Images' })).toHaveAttribute('aria-selected', 'true');
    await expect(review.getByRole('img', { name: 'MCP image 1' })).toBeVisible();
  }
  await review.getByRole('tab', { name: 'Input' }).click();
  await expect(review.getByRole('tabpanel', { name: 'Input' })).toContainText(prompt);
  expect(calls).toEqual(['OpenAIImages_CreateImage']);
  expect(chatRequests).toBe(1);
  await review.getByRole('button', { name: approve ? 'Approve and share' : 'Decline', exact: true }).click();
  await expect(page.getByText('Chat continued after MCP.')).toBeVisible();
  if (approve && !rejectUpstream) {
    const activity = page.getByRole('region', { name: 'Assistant activity' });
    await expect(activity.getByRole('tab', { name: 'Input' })).toHaveAttribute('aria-selected', 'true');
    await activity.getByRole('tab', { name: 'Images' }).click();
    const image = activity.getByRole('img', { name: 'MCP image 1' });
    await expect(image).toBeVisible();
    await expect.poll(() => image.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(1);
  } else await expect(page.getByRole('img', { name: 'MCP image 1' })).toHaveCount(0);
  expect(calls).toEqual(['OpenAIImages_CreateImage']);
  expect(chatRequests).toBe(2);
  expect(decisions).toBe(routed ? 1 : 0);
  // The SDK does modern capability discovery on each connection, not a legacy initialize handshake.
  expect(toolRequests.map(request => request.method())).toEqual(['POST', 'POST', 'POST', 'POST']);
  expect(toolRequests.map(request => request.postDataJSON().method)).toEqual(['server/discover', 'tools/list', 'server/discover', 'tools/call']);
  for (const request of toolRequests) {
    const headers = await request.allHeaders();
    expect(headers['mcp-protocol-version']).toBe(version);
    expect(headers['mcp-session-id']).toBeUndefined();
    expect(headers.authorization).toBe(authorization);
    expect(request.postDataJSON().params._meta['io.modelcontextprotocol/protocolVersion']).toBe(version);
  }
}

test('browser executes once, previews the image in a review modal, and shares the approved result', async ({ page }) => exerciseChat(page, true));
test('the assigned router runs once and its chosen model continues after an MCP denial', async ({ page }) => exerciseChat(page, false));
test('a manual server outside the trusted base runs once before result approval', async ({ page }) => exerciseChat(page, true, true));
test('approved MCP failures reach the model with provider details and without credentials', async ({ page }) => exerciseChat(page, true, false, true));
test('declined MCP failures do not reach the model', async ({ page }) => exerciseChat(page, false, false, true));

for (const approve of [true, false]) {
  test(`native chat ${approve ? 'shares' : 'withholds'} the executed MCP result`, async ({ page }) => {
    const endpoint = `${mcp}/openai-images`;
    let chatCalls = 0, toolCalls = 0;
    let release = () => {};
    const inFlight = new Promise<void>(resolve => { release = resolve; });
    const chunk = { id: 'native-mcp', object: 'chat.completion.chunk', created: 1, model: 'gpt-4.1-mini' };
    await page.route('**/gateway/v1/models', route => route.fulfill({ json: { data: [{ id: model }] } }));
    await page.route(endpoint, async route => {
      if (route.request().method() === 'POST' && route.request().postDataJSON().method === 'tools/call') {
        toolCalls++;
        await inFlight;
      }
      await route.continue();
    });
    await page.route('**/gateway/v1/chat/completions', route => {
      const sent = route.request().postDataJSON();
      if (++chatCalls === 1) {
        const name = sent.tools.find(({ function: tool }: { function: { name: string } }) => tool.name.endsWith('_OpenAIImages_CreateImage')).function.name;
        return route.fulfill({ contentType: 'text/event-stream', body: sse([
          { ...chunk, choices: [{ index: 0, delta: { role: 'assistant', tool_calls: [{ index: 0, id: 'native-call', type: 'function',
            function: { name, arguments: '{"prompt":"Reject my image"}' } }] }, finish_reason: null }] },
          { ...chunk, choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }] },
        ]) });
      }
      const result = sent.messages.at(-1);
      expect(result).toMatchObject({ role: 'tool', tool_call_id: 'native-call' });
      if (approve) expect(JSON.parse(result.content)).toMatchObject(openAiToolError);
      else expect(result.content).toBe('The user declined to share this tool result.');
      expect(JSON.stringify(sent)).not.toContain('Key: browser-openai');
      return route.fulfill({ contentType: 'text/event-stream', body: sse([
        { ...chunk, choices: [{ index: 0, delta: { role: 'assistant', content: 'Native chat continued.' }, finish_reason: 'stop' }] },
      ]) });
    });
    await page.goto('/');
    await setOpenAiKey(page);
    await addManualServer(page, 'Native images', endpoint);
    await page.getByRole('button', { name: 'New chat', exact: true }).click();
    await page.getByRole('button', { name: 'Account menu', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Route', exact: true }).press('ArrowRight');
    await page.getByRole('menuitem', { name: 'Gateway', exact: true }).press('ArrowRight');
    await page.getByRole('menuitemradio', { name: '/v1/chat/completions', exact: true }).click();
    await selectServer(page, 'Native images', 3);
    const review = page.getByRole('dialog', { name: 'Review tool result' });
    const composer = page.getByRole('textbox', { name: 'Message', exact: true });
    try {
      await composer.fill('Test the native tool.');
      await composer.press('Enter');
      await expect.poll(() => toolCalls).toBe(1);
      await expect(review).toHaveCount(0);
      await expect(page.getByRole('dialog', { name: 'Approve tool execution' })).toHaveCount(0);
    } finally { release(); }
    await expect(review.getByRole('tabpanel', { name: 'Text' })).toContainText(openAiError);
    expect(chatCalls).toBe(1);
    await review.getByRole('button', { name: approve ? 'Approve and share' : 'Decline', exact: true }).click();
    await expect(page.getByText('Native chat continued.')).toBeVisible();
    expect(chatCalls).toBe(2);
    expect(toolCalls).toBe(1);
  });
}

test('bundled REST Countries returns prompt completions through the web MCP client', async () => {
  const server = { id: 'countries', title: 'REST Countries', endpoint: `${mcp}/github-rest-countries`, requestHeaders: () => ({}) };
  const signal = new AbortController().signal;
  const discovery = await discoverMcpServer(server, signal);
  expect(discovery.hasCompletions).toBe(true);
  const name = 'list-languages-by-region';
  expect(discovery.prompts.some(prompt => prompt.name === name)).toBe(true);
  const suggestions = await completeMcpArgument(server, { ref: { type: 'ref/prompt', name }, argument: { name: 'region', value: '' } }, signal);
  expect(suggestions).toContain('Europe');
});

test('approved REST Countries structured data reaches the next chat request', async ({ page }) => {
  const endpoint = `${mcp}/github-rest-countries`;
  const remoteName = 'github_rest_countries_get_detail';
  let calls = 0, chats = 0;
  await page.route(endpoint, async route => {
    if (route.request().method() === 'POST') {
      expect(route.request().headers().authorization).toBeUndefined();
      const rpc = route.request().postDataJSON();
      if (rpc.method === 'tools/call') {
        calls++;
        expect(rpc.params).toMatchObject({ name: remoteName, arguments: { cca: 'PL' } });
      }
    }
    await route.continue();
  });
  await page.route('**/gateway/v1/models', route => route.fulfill({ json: { data: [{ id: model }] } }));
  await page.route('**/gateway/api/chat', route => {
    const sent = route.request().postDataJSON();
    const headers = { 'content-type': 'text/event-stream', 'x-vercel-ai-ui-message-stream': 'v1' };
    if (++chats === 1) {
      const name = sent.tools.find((tool: { name: string }) => tool.name.endsWith(`_${remoteName}`)).name;
      return route.fulfill({ headers, body: sse([
        { type: 'start', messageId: 'country-response' }, { type: 'start-step' },
        { type: 'tool-input-available', toolCallId: 'country-call', toolName: name, input: { cca: 'PL' }, dynamic: true },
        { type: 'tool-approval-request', toolCallId: 'country-call', approvalId: 'country-review' },
        { type: 'finish-step' }, { type: 'finish', finishReason: 'tool-calls' },
      ]) });
    }
    const reviewed = sent.messages.at(-1).parts.find((part: { toolCallId?: string }) => part.toolCallId === 'country-call');
    expect(reviewed).toMatchObject({ state: 'output-available', approval: { approved: true },
      output: { content: [], structuredContent: { name: { common: 'Poland' }, capital: ['Warsaw'] } } });
    return route.fulfill({ headers, body: sse([
      { type: 'start', messageId: 'country-response' }, { type: 'start-step' },
      { type: 'text-start', id: 'country' }, { type: 'text-delta', id: 'country', delta: 'Warsaw is the capital of Poland.' },
      { type: 'text-end', id: 'country' }, { type: 'finish-step' }, { type: 'finish', finishReason: 'stop' },
    ]) });
  });
  await page.goto('/');
  await setOpenAiKey(page);
  await page.getByRole('button', { name: 'Model Context', exact: true }).click();
  await page.getByRole('tab', { name: 'Registry', exact: true }).click();
  await page.getByRole('button', { name: 'Install GitHub RESTCountries.NET', exact: true }).click();
  await page.getByRole('button', { name: 'New chat', exact: true }).click();
  await selectServer(page, 'GitHub RESTCountries.NET', 3);
  await page.getByRole('textbox', { name: 'Message', exact: true }).fill('What is the capital of Poland?');
  await page.getByRole('button', { name: 'Send', exact: false }).click();
  const review = page.getByRole('dialog', { name: 'Review tool result' });
  const structured = review.getByRole('tabpanel', { name: 'Structured' });
  await structured.getByRole('button', { name: 'Expand all' }).click();
  await expect(structured).toContainText('Poland');
  expect(chats).toBe(1);
  await review.getByRole('button', { name: 'Approve and share', exact: true }).click();
  await expect(page.getByText('Warsaw is the capital of Poland.')).toBeVisible();
  expect(calls).toBe(1);
  expect(chats).toBe(2);
});

test('the registry controls which servers appear in chat and receives no credentials', async ({ page }) => {
  await page.route('**/gateway/v1/models', route => route.fulfill({ json: { data: [{ id: model }] } }));
  let listings = 0;
  const discovery: string[] = [];
  page.on('request', request => {
    if (request.url().startsWith(mcp) && request.method() === 'POST') discovery.push(request.url());
  });
  await page.route(registryUrl, async route => {
    listings++;
    const headers = await route.request().allHeaders();
    for (const header of ['authorization', 'x-api-key', 'x-goog-api-key', 'cookie']) expect(headers[header]).toBeUndefined();
    const response = await route.fetch();
    const result = await response.json();
    const entry = result.servers.find(({ server }: { server: { name: string } }) => server.name.endsWith('/OpenAI-Images'));
    entry.server.title = 'Images from the configured registry';
    await route.fulfill({ response, json: { servers: [entry], metadata: { count: 1 } } });
  });
  await page.goto('/');
  await setOpenAiKey(page);
  expect(listings).toBe(0);
  const draft = page.getByRole('textbox', { name: 'Message', exact: true });
  await draft.fill('Keep this draft while browsing');
  const catalog = await openModelContext(page);
  await expect(catalog.getByRole('tab', { name: 'Registry', exact: true })).toHaveAttribute('aria-selected', 'true');
  await catalog.getByRole('button', { name: 'Install Images from the configured registry' }).click();
  expect(discovery).toEqual([]);
  await catalog.getByRole('button', { name: 'Close' }).click();
  await expect(draft).toHaveValue('Keep this draft while browsing');
  await expect(page).toHaveURL(new URL('/', page.url()).href);
  await selectServer(page, 'Images from the configured registry', 3);
  expect([...new Set(discovery)]).toEqual([`${mcp}/openai-images`]);
  expect(listings).toBe(1);
});

test('manual headers are not persisted, and the disabled toggle has a separate configure button', async ({ page }) => {
  await page.goto('/');
  await addManualServer(page, 'Private MCP', `${mcp}/openai-images`);
  expect(await page.evaluate(() => JSON.stringify(localStorage))).not.toContain(auth.openai.Authorization);
  await page.reload();
  const installed = page.getByRole('tabpanel', { name: 'Installed' });
  await expect(installed.getByText('Credentials needed')).toBeVisible();
  await page.getByRole('button', { name: 'New chat' }).click();
  const picker = await openModelContext(page);
  const toggle = picker.getByRole('switch', { name: 'Private MCP' });
  await expect(toggle).toBeDisabled();
  await expect(toggle).not.toBeChecked();
  const configure = picker.getByRole('button', { name: 'Configure Private MCP' });
  await expect(configure).toHaveText('');
  await configure.click();
  const editor = page.getByRole('dialog', { name: 'Model Context Server' });
  await expect(editor.getByLabel('Header value')).toHaveValue('');
  await editor.getByLabel('Header value').fill(auth.openai.Authorization);
  await editor.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(toggle).toBeEnabled();
  await expect(toggle).not.toBeChecked();
});

test('registry install renders secret template fields when an app credential is unavailable', async ({ page }) => {
  await page.goto('/model-context');
  await page.getByRole('tab', { name: 'Registry', exact: true }).click();
  await page.getByRole('button', { name: 'Install OpenAI Images' }).click();
  const editor = page.getByRole('dialog', { name: 'Install MCP server' });
  const key = editor.getByLabel(/openai_api_key/);
  await expect(key).toHaveAttribute('type', 'password');
  await expect(key).toHaveAttribute('required', '');
  await key.fill('manual-test-key');
  await editor.getByRole('button', { name: 'Install server', exact: true }).click();
  await page.getByRole('tab', { name: 'Installed', exact: true }).click();
  await expect(page.getByRole('tabpanel', { name: 'Installed' }).getByRole('heading', { name: 'OpenAI Images', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'New chat' }).click();
  const listed = page.waitForRequest(request => request.url() === `${mcp}/openai-images` && request.method() === 'POST');
  await selectServer(page, 'OpenAI Images', 3);
  expect((await (await listed).allHeaders()).authorization).toBe('Bearer manual-test-key');
});

test('catalog is configured separately, and app credentials are not resolved outside the trusted base', async () => {
  const site = new URL('http://localhost:15273/');
  expect(readMcpConfig(site, mcp)?.registryUrl).toBeUndefined();
  expect(readMcpConfig(site, undefined, registryUrl)?.base).toBeUndefined();
  expect(readMcpConfig(site, mcp, 'http://remote.example.test/v0.1/servers')).toBeUndefined();
  expect(readMcpConfig(site, mcp, '/registry/v0.1/servers')?.registryUrl?.href).toBe(`${site.origin}/registry/v0.1/servers`);

  const { servers } = await fetchMcpCatalog(new URL(registryUrl), new AbortController().signal);
  expect(servers).not.toHaveLength(0);
  for (const base of [delegated, `${mcp}/other-runtime/`]) {
    const options = readMcpConfig(site, base, registryUrl)!;
    const policy = { ...options, headersForRemote: () => {
      throw new Error('Untrusted endpoints must not reach the credential policy.');
    } };
    for (const server of servers) for (const remote of server.remotes) expect(mcpAppAuth(policy, { ...remote, source: 'registry' })).toBeUndefined();
  }
});

test('the Entra chat policy never uses app credentials for provider header declarations', async () => {
  const options = readMcpConfig(new URL('http://localhost:15274/'), mcp, registryUrl)!;
  const { servers } = await fetchMcpCatalog(new URL(registryUrl), new AbortController().signal);
  const policy = { ...options, headersForRemote: (headers: Parameters<typeof acceptsEntraMcpToken>[0]) => acceptsEntraMcpToken(headers)
    ? { ready: true, headers: () => ({ Authorization: 'Bearer fixture' }) } : undefined };
  const credentialed = servers.flatMap(server => server.remotes).filter(remote => remote.declarations.length > 0);
  expect(credentialed).not.toHaveLength(0);
  for (const remote of credentialed) expect(mcpAppAuth(policy, { ...remote, source: 'registry' })).toBeUndefined();
  expect(acceptsEntraMcpToken([])).toBe(true);
  expect(acceptsEntraMcpToken([{ name: 'Authorization', value: 'Bearer {access_token}' }])).toBe(true);
});

test('the sample registry allows uncredentialed CORS from the web app', async ({ request }) => {
  const origin = 'http://localhost:15273';
  const allowed = await request.get(registryUrl, { headers: { Origin: origin } });
  const denied = await request.get(registryUrl, { headers: { Origin: 'https://unrelated.example.test' } });
  const cors = allowed.headers()['access-control-allow-origin'];
  expect([origin, '*']).toContain(cors);
  expect(denied.headers()['access-control-allow-origin']).toBe(cors === '*' ? '*' : undefined);
  for (const response of [allowed, denied]) expect(response.headers()['access-control-allow-credentials']).toBeUndefined();
});

async function rpc(request: APIRequestContext, host: string, path: string, method: string, params: object = {}, headers: Record<string, string> = {},
  headerVersion: string | null = version, bodyVersion = version) {
  return request.post(`${host}/${path}`, {
    headers: { Accept: 'application/json, text/event-stream', 'Mcp-Method': method,
      ...('name' in params ? { 'Mcp-Name': String(params.name) } : {}),
      ...(headerVersion ? { 'Mcp-Protocol-Version': headerVersion } : {}), ...headers },
    data: { jsonrpc: '2.0', id: 1, method, params: { ...params, _meta: { 'io.modelcontextprotocol/protocolVersion': bodyVersion,
      'io.modelcontextprotocol/clientCapabilities': {}, 'io.modelcontextprotocol/clientInfo': { name: 'Streaik MCP tests', version: '1.0.0' } } } },
  });
}

async function rpcBody(response: APIResponse) {
  const text = await response.text();
  return response.headers()['content-type']?.startsWith('text/event-stream')
    ? JSON.parse(text.split(/\r?\n/).filter(line => line.startsWith('data: ')).at(-1)!.slice(6))
    : JSON.parse(text);
}

test('tool hosts do not serve discovery and enforce isolated, stateless, versioned routes', async ({ request }) => {
  for (const host of [mcp, delegated]) {
    for (const path of ['/catalog.json', '/v0.1/servers', '/v1/servers']) {
      expect((await request.get(`${host}${path}`)).status()).toBe(404);
    }
  }
  for (const versionHeader of [null, '2025-11-25', '2099-01-01']) {
    const response = await rpc(request, mcp, 'openai-images', 'tools/list', {}, {}, versionHeader);
    expect(response.status()).toBe(400);
    expect(await response.json()).toMatchObject({ error: { code: -32022, data: { supported: [version] } } });
  }
  const mismatch = await rpc(request, mcp, 'openai-images', 'tools/list', {}, {}, version, '2025-11-25');
  expect(mismatch.status()).toBe(400);
  const list = await rpc(request, mcp, 'anthropic-skills', 'tools/list');
  expect(list.status(), await list.text()).toBe(200);
  expect(list.headers()['mcp-session-id']).toBeUndefined();
  expect((await rpcBody(list)).result.tools.map(({ name }: { name: string }) => name)).toEqual(['AnthropicSkills_List', 'AnthropicSkills_Get']);
  const badTool = await rpc(request, mcp, 'anthropic-skills', 'tools/call', { name: 'OpenAIImages_CreateImage', arguments: { prompt: 'Example' } });
  expect((await rpcBody(badTool)).error).toBeTruthy();
  expect((await request.get(`${mcp}/openai-images`, { headers: { Accept: 'text/event-stream' } })).status()).toBe(405);
  expect((await request.get(`${mcp}/openai-images/sse`)).status()).toBe(404);
});

test('all provider tools execute with isolated credentials; delegated mode only uses server-side keys', async ({ request }) => {
  const invoke = async (host: string, server: string, name: string, args: object, headers: Record<string, string>) => {
    const response = await rpc(request, host, server, 'tools/call', { name, arguments: args }, headers);
    expect(response.status(), await response.text()).toBe(200);
    const payload = await rpcBody(response);
    expect(payload, JSON.stringify(payload)).toHaveProperty('result');
    return payload.result;
  };
  for (const model of [undefined, 'openai/gpt_image_2_6_flare', 'openai/gpt-image-2.6-flare']) {
    const generated = await invoke(mcp, 'openai-images', 'OpenAIImages_CreateImage', { prompt: 'Test', model }, auth.openai);
    expect(generated.content[0]).toMatchObject({ type: 'image', mimeType: 'image/png' });
  }
  const edit = await invoke(mcp, 'openai-images', 'OpenAIImages_CreateImageEdit', { prompt: 'Test', fileUrl: png, model: 'gpt_image_2_6_flare' }, { ...auth.openai, ...auth.google, ...auth.anthropic });
  expect(edit.content[0]).toMatchObject({ type: 'image', mimeType: 'image/png', data: png.split(',')[1] });
  const ask = await invoke(mcp, 'openai-images', 'OpenAIImages_AskImages', { question: 'Test', imageUrls: [png] }, auth.openai);
  expect(ask.content[0].text).toBe('OpenAI sees an image.');
  for (const inputs of [{}, { model: 'google/models/gemini-nano-banana-2.1', fileUrl: png, referenceImageUrls: [png] }]) {
    const generated = await invoke(mcp, 'google-images', 'GoogleNanoBanana_CreateImage', { prompt: 'Test', ...inputs }, { ...auth.google, ...auth.openai });
    expect(generated.content[0].type).toBe('image');
  }
  const badGoogle = await invoke(mcp, 'google-images', 'GoogleNanoBanana_CreateImage', { prompt: 'Test', model: 'gemini-flash-latest' }, auth.google);
  expect(badGoogle).toMatchObject({ isError: true, content: [{ type: 'text', text: 'Google request failed (HTTP 400) [INVALID_ARGUMENT, field: model]: Select a Gemini image model. Key: [redacted]' }] });
  const google = await invoke(mcp, 'google-images', 'GoogleNanoBanana_AskImages', { question: 'Test', imageUrls: [png] }, auth.google);
  expect(google.content[0].text).toBe('Google sees an image.');
  const keyMissing = await invoke(mcp, 'anthropic-skills', 'AnthropicSkills_List', {}, auth.openai);
  expect(keyMissing).toMatchObject({ isError: true, content: [{ text: 'The provider credential is missing.' }] });
  const list = await invoke(mcp, 'anthropic-skills', 'AnthropicSkills_List', {}, auth.anthropic);
  expect(list.content[0].text).toContain('Fixture Skill');
  const unauthorized = await rpc(request, delegated, 'anthropic-skills', 'tools/list', {}, auth.openai);
  expect(unauthorized.status()).toBe(401);
  const detail = await invoke(delegated, 'anthropic-skills', 'AnthropicSkills_Get', { skillId: 'skill_test' },
    { ...auth.anthropic, Authorization: 'Bearer test-mcp-token' });
  expect(detail.content[0].text).toContain('Fixture Skill');
});
