import { expect, test } from '@playwright/test';
import type { Locator, Page, Route } from '@playwright/test';
import { appAgents } from '../samples/shared/appAgents';
import { exportSkillZip } from '../packages/chat/src/skillBundles';
import { faviconEndpoint, iconResponse, openAiFavicon } from './icon-fixtures';
import { selectKeyProvider } from './provider-key-picker';

test.beforeEach(async ({ page }) => {
  await page.route(faviconEndpoint, route => route.fulfill(iconResponse));
});

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

test('agent Skills keeps Local copies and Central links separate and saves only on submit', async ({ page }) => {
  const remote = { id: 'openai/skill_notes', name: 'provider-notes', description: 'A Central skill.', default_version: '1', latest_version: '2' };
  const zip = await exportSkillZip({ metadata: { name: remote.name, description: remote.description }, instructions: 'Use the provider template.', files: [] });
  let downloads = 0;
  let rejectDownload = true;
  await page.route('**/gateway/v1/models', route => route.fulfill({ json: { data: [{ id: 'openai/gpt-6-luna' }] } }));
  await page.route('**/gateway/v1/skills?*', route => route.fulfill({ json: { data: [remote], has_more: false } }));
  await page.route('**/gateway/v1/skills/openai/skill_notes/versions/2/content', route => {
    downloads++;
    return rejectDownload ? route.fulfill({ status: 500, body: '' }) : zip.arrayBuffer().then(bytes =>
      route.fulfill({ contentType: 'application/zip', body: Buffer.from(bytes) }));
  });
  await page.goto('/');
  await enableOpenAI(page);
  await page.getByRole('button', { name: 'Skills', exact: true }).click();
  await page.getByRole('button', { name: 'Add skill', exact: true }).click();
  await page.getByRole('menuitem', { name: 'New', exact: true }).click();
  const skillEditor = page.getByRole('dialog', { name: 'Create skill' });
  await skillEditor.getByLabel('Name', { exact: true }).fill('local-notes');
  await skillEditor.getByLabel('Description', { exact: true }).fill('A local skill.');
  await skillEditor.getByRole('button', { name: 'Create', exact: true }).click();
  await expect(skillEditor).toBeHidden();

  await agents(page).click();
  const editor = await create(page, 'Skill Agent');
  const openSkills = async (dialog = editor) => {
    await dialog.getByRole('tab', { name: 'Skills', exact: true }).click();
    const panel = dialog.getByRole('tabpanel', { name: 'Skills', exact: true });
    return { panel, central: panel.getByRole('region', { name: 'Central', exact: true }), local: panel.getByRole('region', { name: 'Local', exact: true }) };
  };
  const { panel, central, local } = await openSkills();
  const localSkill = local.getByRole('switch', { name: 'local-notes', exact: true });
  const providerSkill = central.getByRole('switch', { name: remote.name, exact: true });
  const search = panel.getByRole('searchbox', { name: 'Search skills', exact: true });
  await expect(panel.getByRole('searchbox')).toHaveCount(1);
  await expect(localSkill).toBeEnabled();
  await expect(providerSkill).toBeEnabled();
  await expect(panel).not.toContainText(/A local skill\.|A Central skill\.|Attach a copy of a skill|Link to a catalog skill/);

  await search.fill(' PROVIDER ');
  await expect(providerSkill).toBeVisible();
  await expect(localSkill).toHaveCount(0);
  await expect(local.getByText('No matching skills.')).toBeVisible();
  await search.press('Enter');
  await expect(editor).toBeVisible();
  await search.fill('local-notes');
  await expect(localSkill).toBeVisible();
  await expect(providerSkill).toHaveCount(0);
  await expect(central.getByText('No matching skills.')).toBeVisible();
  await localSkill.click();
  await expect(localSkill).toBeChecked();
  await search.fill('provider');
  await expect(localSkill).toBeChecked();
  await providerSkill.check();
  const attachment = central.getByLabel(`Attachment for ${remote.name}`, { exact: true });
  await expect(attachment).toHaveValue('reference');
  await expect(central.getByLabel(`Version for ${remote.name}`, { exact: true })).toHaveValue('latest');
  expect(downloads).toBe(0);
  await attachment.selectOption('inline');
  await expect(panel.getByRole('alert')).toContainText('No selection was changed');
  await expect(attachment).toHaveValue('reference');
  rejectDownload = false;
  await attachment.selectOption('inline');
  await expect(attachment).toHaveValue('inline');
  expect(downloads).toBe(2);
  await editor.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(card(page, 'Skill Agent')).toBeVisible();

  await page.reload();
  await expect(card(page, 'Skill Agent')).toBeVisible();
  const dialog = page.getByRole('dialog', { name: 'Agent', exact: true });
  await card(page, 'Skill Agent').getByRole('button', { name: 'Edit', exact: true }).click();
  const reopened = await openSkills(dialog);
  const reopenedLocal = reopened.local.getByRole('switch', { name: 'local-notes', exact: true });
  await expect(reopenedLocal).toBeChecked();
  await expect(reopened.central.getByLabel(`Attachment for ${remote.name}`, { exact: true })).toHaveValue('inline');
  // Local search still works when the BYOK connection is locked after reload.
  await expect(reopened.central.getByText('Connect to a Gateway to browse Central skills.')).toBeVisible();
  const offlineSearch = reopened.panel.getByRole('searchbox', { name: 'Search skills', exact: true });
  await offlineSearch.fill('no-match');
  await reopenedLocal.click();
  await expect(reopenedLocal).toHaveCount(0);
  await offlineSearch.clear();
  await expect(reopenedLocal).not.toBeChecked();
  // Removing the disconnected Central attachment also removes its row.
  const centralSkill = reopened.central.getByRole('switch', { name: remote.name, exact: true });
  await centralSkill.click();
  await expect(centralSkill).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await card(page, 'Skill Agent').getByRole('button', { name: 'Edit', exact: true }).click();
  await openSkills(dialog);
  await expect(reopened.central.getByRole('switch', { name: remote.name, exact: true })).toBeChecked();
  await reopened.central.getByLabel(`Attachment for ${remote.name}`, { exact: true }).selectOption('reference');
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  const saved = await page.evaluate(() => {
    const key = Object.keys(localStorage).find(key => key.startsWith('streaik.agents.v1:'))!;
    return JSON.parse(localStorage.getItem(key)!).local[0].definition.skills;
  });
  expect(saved).toEqual([{ type: 'inline', name: 'local-notes', description: 'A local skill.', source: {
    type: 'base64', media_type: 'application/zip', data: expect.any(String),
  } }, { type: 'skill_reference', skill_id: remote.id, version: 'latest' }]);
});

test('agent tool configuration preserves portable fields and auto-attaches only after MCP installation', async ({ page }) => {
  await page.route('**/gateway/v1/models', route => route.fulfill({ json: { data: [{ id: replyModel, name: 'Answer model', type: 'language' }] } }));
  let discoveries = 0;
  await page.route('**/mcp-agent-inventory', route => {
    const { id, method } = route.request().postDataJSON();
    const reply = (result: unknown) => route.fulfill({ json: { jsonrpc: '2.0', id, result } });
    if (method === 'server/discover') {
      discoveries++;
      return reply({ supportedVersions: ['2026-07-28'], capabilities: { tools: {} } });
    }
    expect(method).toBe('tools/list');
    return reply({ resultType: 'complete', ttlMs: 0, cacheScope: 'private', tools: ['lookup', 'excluded'].map(name => ({ name,
      inputSchema: { type: 'object', properties: {} } })) });
  });
  await page.goto('/');
  const url = new URL('/mcp-agent-inventory', page.url()).href;
  await enableOpenAI(page);
  await agents(page).click();
  const editor = await create(page, 'Inventory helper');
  await editor.getByRole('tab', { name: 'Tools', exact: true }).click();
  const tools = editor.getByRole('tabpanel', { name: 'Tools', exact: true });
  await expect(tools.getByRole('button', { name: 'Add by URL' })).toHaveCount(0);
  const toolSearch = tools.getByRole('switch', { name: 'Tool search', exact: true });
  const resourceSearch = tools.getByRole('switch', { name: 'Resource search', exact: true });
  await expect(toolSearch).toBeEnabled();
  await resourceSearch.check();
  await resourceSearch.uncheck();
  await toolSearch.check();
  await expect(tools.getByRole('combobox', { name: 'Execution', exact: true })).toHaveText('Default');
  await editor.getByRole('tab', { name: 'Model Context', exact: true }).click();
  const contextPanel = editor.getByRole('tabpanel', { name: 'Model Context', exact: true });
  const addByUrl = contextPanel.getByRole('button', { name: 'Add by URL' });
  await expect(addByUrl).toHaveText('');
  await addByUrl.click();
  const addServer = page.getByRole('dialog', { name: 'Add MCP server', exact: true });
  await addServer.getByLabel('Name', { exact: true }).fill('Inventory');
  await addServer.getByLabel('URL', { exact: true }).fill(url);
  await addServer.getByRole('button', { name: 'Add MCP server' }).click();
  await expect(addServer).toBeHidden();
  const server = contextPanel.getByRole('article').filter({ has: page.getByRole('heading', { name: 'Inventory', exact: true }) });
  await server.getByRole('switch', { name: 'Search', exact: true }).check();
  await expect(server.getByRole('button', { name: 'Allowed tools', exact: true })).toBeDisabled();
  await expect(server.getByRole('textbox')).toHaveCount(0);
  await editor.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(card(page, 'Inventory helper')).toBeVisible();

  const roles = await settings(page);
  await roles.getByRole('combobox', { name: 'Chat', exact: true }).click();
  await page.getByRole('option', { name: 'Inventory helper', exact: true }).click();
  await roles.getByRole('button', { name: 'Close', exact: true }).click();
  await page.getByRole('button', { name: 'New chat', exact: true }).click();
  const picker = page.getByRole('button', { name: 'Model', exact: true });
  await picker.click();
  await page.getByRole('option', { name: 'Answer model', exact: true }).click();
  const composer = page.getByRole('textbox', { name: 'Message', exact: true });
  await composer.fill('Look up inventory');
  await expect(page.getByRole('button', { name: 'Send', exact: true })).toBeEnabled();
  expect(discoveries).toBe(0);

  await page.getByRole('button', { name: 'Add to message', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Model Context', exact: true }).click();
  const context = page.getByRole('dialog', { name: 'Model Context', exact: true });
  await context.getByRole('tab', { name: 'Installed', exact: true }).click();
  await context.getByRole('button', { name: 'Add by URL' }).click();
  const install = page.getByRole('dialog', { name: 'Add MCP server' });
  await install.getByLabel('Name', { exact: true }).fill('Authorized Inventory');
  await install.getByLabel('URL', { exact: true }).fill(url);
  await install.getByRole('button', { name: 'Save', exact: true }).click();
  await context.getByRole('button', { name: 'Close', exact: true }).click();
  await expect.poll(() => discoveries).toBeGreaterThan(0);

  await agents(page).click();
  const item = card(page, 'Inventory helper');
  const reopened = page.getByRole('dialog', { name: 'Agent', exact: true });
  const openModelContext = async (): Promise<Locator> => {
    await item.getByRole('button', { name: 'Edit', exact: true }).click();
    await reopened.getByRole('tab', { name: 'Model Context', exact: true }).click();
    return reopened.getByRole('tabpanel', { name: 'Model Context', exact: true });
  };
  const reopenedPanel = await openModelContext();
  const footer = reopenedPanel.locator('.mcp-card-footer');
  const connect = footer.getByRole('button', { name: 'Connect Model Context', exact: true });
  await expect(connect).toHaveText('');
  await connect.click();
  const connected = footer.getByRole('button', { name: 'Connected', exact: true });
  await expect(connected).toBeDisabled();
  await expect(connected).toHaveText('');
  await reopenedPanel.getByRole('combobox', { name: 'Execution', exact: true }).click();
  await page.getByRole('option', { name: 'Client', exact: true }).click();
  const selected = reopenedPanel.getByRole('button', { name: 'Allowed tools', exact: true });
  await expect(selected).toHaveText('All tools');
  await selected.click();
  const options = page.getByRole('listbox', { name: 'Allowed tools', exact: true });
  await expect(options.getByRole('option')).toHaveText(['All tools', 'No tools', 'excluded', 'lookup']);
  await options.getByRole('option', { name: 'No tools' }).click();
  await expect(selected).toHaveText('No tools');
  await options.getByRole('option', { name: 'All tools' }).click();
  await page.getByRole('option', { name: 'lookup', exact: true }).click();
  await page.keyboard.press('Escape');
  await expect(selected).toHaveText('lookup');
  await reopened.getByRole('tab', { name: 'Tool configuration', exact: true }).click();
  const configuration = reopened.getByRole('tabpanel', { name: 'Tool configuration' });
  await configuration.getByRole('switch', { name: 'Search for lookup', exact: true }).uncheck();
  await configuration.locator('summary[aria-label="Usage method for lookup"]').click();
  await configuration.getByRole('checkbox', { name: 'Direct', exact: true }).check();
  await reopened.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(reopened).toBeHidden();
  const saved = await page.evaluate(() => {
    const key = Object.keys(localStorage).find(value => value.startsWith('streaik.agents.v1:'));
    return key ? JSON.parse(localStorage.getItem(key)!).local.find((item: { definition: { name: string } }) => item.definition.name === 'Inventory helper')?.definition : undefined;
  });
  expect(saved).toMatchObject({ tools: [{ type: 'tool_search' },
    { type: 'mcp', server_label: 'Inventory', server_url: url, allowed_tools: ['lookup'], defer_loading: true, execution: 'client' },
    { type: 'function', name: 'lookup', allowed_callers: ['direct'], defer_loading: false }] });
  expect(saved).not.toHaveProperty('mcpServers');

  await openModelContext();
  await expect(selected).toBeDisabled();
  await expect(selected).toHaveText('lookup');
  await reopened.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.getByRole('button', { name: 'New chat', exact: true }).click();
  await picker.click();
  await page.getByRole('option', { name: 'Answer model', exact: true }).click();
  await composer.fill('Look up inventory');

  await page.route('**/gateway/api/chat', route => {
    const body = route.request().postDataJSON();
    expect(body).not.toHaveProperty('clientToolResultApproval');
    const lookup = body.tools.find((tool: { name: string }) => /lookup$/.test(tool.name));
    expect(lookup).toMatchObject({ name: expect.stringMatching(/lookup$/), allowed_callers: ['direct'] });
    expect(lookup).not.toHaveProperty('defer_loading');
    expect(body.tools.some((tool: { name: string }) => /excluded$/.test(tool.name))).toBe(false);
    return finishText(route, 'Inventory attached');
  });
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(page.getByText('Inventory attached', { exact: true })).toBeVisible();
  expect(discoveries).toBeGreaterThan(0);
});

test('agent Model Context saves portable settings and catalog selections only on agent save', async ({ page }) => {
  const endpoint = 'https://inventory.example.test/mcp';
  await page.route('**/test-mcp-registry*', route => route.fulfill({ json: { servers: [{ server: {
    name: 'example/catalog-inventory', title: 'Catalog Inventory', description: 'Find inventory in a catalog.',
    remotes: [{ type: 'streamable-http', url: endpoint, headers: [{ name: 'Authorization', isRequired: true, isSecret: true }] }],
  } }] } }));
  await page.goto('http://localhost:15175/');
  await agents(page).click();
  const editor = await create(page, 'Model Context sample');
  await editor.getByRole('tab', { name: 'Model Context', exact: true }).click();
  const panel = editor.getByRole('tabpanel', { name: 'Model Context', exact: true });
  await expect(panel.getByRole('heading')).toHaveText(['Policy', 'Capabilities']);
  await panel.getByRole('switch', { name: 'Open world', exact: true }).check();
  const form = panel.getByRole('switch', { name: 'Form', exact: true });
  const url = panel.getByRole('switch', { name: 'URL', exact: true });
  await expect(form).toBeDisabled();
  const elicitation = panel.getByRole('switch', { name: 'Elicitation', exact: true });
  await expect(panel.getByText('Elicitation', { exact: true })).toHaveCount(0);
  await elicitation.check();
  await form.check();
  await expect(url).toBeDisabled();

  const entryActions = panel.locator('.agent-mcp-actions').getByRole('button');
  await expect(entryActions.first()).toHaveAccessibleName('Add by URL');
  await expect(entryActions.last()).toHaveAccessibleName('Catalog');
  await expect(entryActions).toHaveText(['', '']);
  await entryActions.last().click();
  const catalog = page.getByRole('dialog', { name: 'MCP catalog', exact: true });
  await catalog.getByRole('button', { name: 'Add Catalog Inventory to agent', exact: true }).click();
  await expect(catalog.getByRole('button', { name: 'Already on this agent', exact: true })).toBeDisabled();
  await catalog.getByRole('button', { name: 'Close', exact: true }).click();
  const server = panel.getByRole('article').filter({ hasText: 'Catalog Inventory' });
  await expect(server).toContainText('Find inventory in a catalog.');
  await server.getByRole('switch', { name: 'Namespace', exact: true }).check();
  const execution = server.getByRole('combobox', { name: 'Execution', exact: true });
  await expect(execution).toHaveText('Default');
  await execution.click();
  await page.getByRole('option', { name: 'Hosted', exact: true }).click();
  const approval = server.getByRole('combobox', { name: 'Require approval', exact: true });
  await expect(approval).toHaveText('Default');
  await approval.click();
  await page.getByRole('option', { name: 'Always', exact: true }).click();
  const saved = () => page.evaluate(() => {
    const key = Object.keys(localStorage).find(value => value.startsWith('streaik.agents.v1:'));
    return key ? JSON.parse(localStorage.getItem(key)!).local[0]?.definition : undefined;
  });
  expect(await saved()).toBeUndefined();
  await editor.getByRole('button', { name: 'Save', exact: true }).click();
  const item = card(page, 'Model Context sample');
  await expect(item).toBeVisible();
  expect(await saved()).toMatchObject({ mcpClient: { policy: { openWorldHint: true }, capabilities: { elicitation: { form: {} } } }, tools: [{
    type: 'mcp', server_label: 'Catalog Inventory', server_url: endpoint, namespace: true, require_approval: 'always', execution: 'server',
  }] });
  expect((await saved()).tools[0]).not.toHaveProperty('headers');

  await item.getByRole('button', { name: 'Edit', exact: true }).click();
  const reopened = page.getByRole('dialog', { name: 'Agent', exact: true });
  await reopened.getByRole('tab', { name: 'Model Context', exact: true }).click();
  const reopenedExecution = reopened.getByRole('combobox', { name: 'Execution', exact: true });
  await expect(reopenedExecution).toHaveText('Hosted');
  await reopenedExecution.click();
  await page.getByRole('option', { name: 'Default', exact: true }).click();
  const reopenedApproval = reopened.getByRole('combobox', { name: 'Require approval', exact: true });
  await expect(reopenedApproval).toHaveText('Always');
  await reopenedApproval.click();
  await page.getByRole('option', { name: 'Default', exact: true }).click();
  await reopened.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(reopened).toBeHidden();
  expect((await saved()).tools[0]).not.toHaveProperty('require_approval');
  expect((await saved()).tools[0]).not.toHaveProperty('execution');
});

test('agent Tools cards show per-search Execution only when enabled and omit Default', async ({ page }) => {
  await page.goto('/');
  await agents(page).click();
  const editor = await create(page, 'Search execution sample');
  const openTools = async (dialog: Locator) => {
    await dialog.getByRole('tab', { name: 'Tools', exact: true }).click();
    return dialog.getByRole('tabpanel', { name: 'Tools', exact: true });
  };
  const panel = await openTools(editor);
  const searchTypes = ['Tool search', 'Resource search'];
  for (const [index, title] of searchTypes.entries()) {
    const section = panel.getByRole('region', { name: title, exact: true });
    const header = section.locator('header');
    const toggle = header.getByRole('switch', { name: title, exact: true });
    const execution = section.getByRole('combobox', { name: 'Execution', exact: true });
    await expect(header).toHaveText(title);
    await expect(execution).toHaveCount(0);
    await toggle.check();
    await expect(execution).toHaveText('Default');
    await execution.click();
    await page.getByRole('option', { name: index === 0 ? 'Hosted' : 'Client', exact: true }).click();
  }
  await editor.getByRole('button', { name: 'Save', exact: true }).click();
  const savedTools = () => page.evaluate(() => {
    const key = Object.keys(localStorage).find(value => value.startsWith('streaik.agents.v1:'))!;
    return JSON.parse(localStorage.getItem(key)!).local[0].definition.tools;
  });
  expect(await savedTools()).toEqual([{ type: 'tool_search', execution: 'server' }, { type: 'resource_search', execution: 'client' }]);

  await card(page, 'Search execution sample').getByRole('button', { name: 'Edit', exact: true }).click();
  const reopened = page.getByRole('dialog', { name: 'Agent', exact: true });
  const reopenedPanel = await openTools(reopened);
  for (const [index, title] of searchTypes.entries()) {
    const section = reopenedPanel.getByRole('region', { name: title, exact: true });
    const execution = section.getByRole('combobox', { name: 'Execution', exact: true });
    await expect(execution).toHaveText(index === 0 ? 'Hosted' : 'Client');
    await execution.click();
    await page.getByRole('option', { name: 'Default', exact: true }).click();
  }
  await reopened.getByRole('button', { name: 'Save', exact: true }).click();
  expect(await savedTools()).toEqual([{ type: 'tool_search' }, { type: 'resource_search' }]);
});

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
  await selectKeyProvider(keys, 'OpenAI');
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
    expect(body.messages[0].parts[0].text).toContain(appAgents.defaults.find(({ id }) => id === 'welcome-message')!.definition.instructions);
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
  await editor.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(editor.getByRole('alert')).toHaveText('Name, description, and instructions are required.');
  await expect(editor.getByRole('tab', { name: 'General' })).toHaveAttribute('aria-selected', 'true');
  await editor.getByLabel('Description', { exact: true }).fill('A local definition.');
  await editor.getByRole('button', { name: 'Save', exact: true }).click();
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
  const edit = page.getByRole('dialog', { name: 'Agent', exact: true });
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
  await editor.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(realtime).toHaveAttribute('aria-selected', 'true');
  await expect(editor.getByRole('alert')).toHaveText('Speech speed must be a positive number.');
  await editor.getByLabel('Speed', { exact: true }).fill('1.15');
  await editor.getByRole('button', { name: 'Save', exact: true }).click();
  const local = card(page, 'Audio agent');
  await expect(local.locator('.catalog-mark img')).toHaveAttribute('src', openAiFavicon);

  available = false;
  await page.reload();
  await agents(page).click();
  await local.getByRole('button', { name: 'Edit', exact: true }).click();
  const edit = page.getByRole('dialog', { name: 'Agent', exact: true });
  await expect(edit.getByLabel('Argument hint')).toHaveValue('Describe the result');
  await expect(edit.getByRole('listitem')).toHaveText([/anthropic\/router/, /openai\/chat-example/]);
  await edit.getByRole('tab', { name: 'Realtime' }).click();
  await expect(edit.getByRole('button', { name: 'Transcription model' })).toContainText('openai/live-transcribe (saved, unavailable)');
  await expect(edit.getByRole('button', { name: 'Speech model' })).toContainText('openai/example-tts (saved, unavailable)');
  for (const [label, value] of [['Voice', 'alloy'], ['Speech instructions', 'Speak clearly.'], ['Language', 'en'], ['Speed', '1.15'],
    ['Audio format', 'audio/pcm'], ['Sample rate (Hz)', '24000']]) await expect(edit.getByLabel(label, { exact: true })).toHaveValue(value);
  await edit.getByRole('button', { name: 'Save', exact: true }).click();
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
  const editor = page.getByRole('dialog', { name: 'Agent', exact: true });
  const tab = (name: string) => editor.getByRole('tab', { name, exact: true });
  const modelTabs = editor.getByRole('tablist', { name: 'Models', exact: true });
  const firstModelLabel = textAgentModel.slice('openai/'.length);
  const alternateLabel = alternate.slice('openai/'.length);
  const tier = editor.getByRole('combobox', { name: 'Service tier', exact: true });
  await tab('OpenAI').click();
  await expect(modelTabs).toHaveAttribute('aria-orientation', 'vertical');
  await expect(modelTabs.getByRole('tab')).toHaveText(['All', firstModelLabel, alternateLabel]);
  await expect(tab('All')).toHaveAttribute('aria-selected', 'true');
  await expect(editor.getByRole('combobox', { name: 'Model', exact: true })).toHaveCount(0);
  await expect(tier).toHaveValue('');
  await expect(editor.getByText(/Add ordered native context management rules/)).toHaveCount(0);
  await tier.selectOption('scale');
  await tab('All').press('ArrowDown');
  await expect(tab(firstModelLabel)).toBeFocused();
  await expect(tab(firstModelLabel)).toHaveAttribute('aria-selected', 'true');
  await expect(tier).toHaveValue('scale');
  await tab(firstModelLabel).press('End');
  await expect(tab(alternateLabel)).toBeFocused();
  await expect(tier).toHaveValue('scale');
  await tier.selectOption('priority');
  await editor.getByRole('button', { name: 'Add compaction rule' }).click();
  await editor.getByRole('spinbutton', { name: 'Compaction threshold' }).fill('4096');
  await editor.getByRole('switch', { name: 'Enable multi-agent responses' }).check();
  await tab(alternateLabel).press('Home');
  await expect(tab('All')).toBeFocused();
  await expect(tier).toHaveValue('');
  await tab('All').press('ArrowUp');
  await expect(tab(alternateLabel)).toBeFocused();

  await tab('Cerebras').click();
  await expect(modelTabs).toHaveCount(0);
  await expect(editor.getByRole('combobox', { name: 'Reasoning effort' })).toHaveValue('high');
  await expect(editor.getByRole('spinbutton', { name: 'Seed', exact: true })).toHaveValue('0');
  await tab('Together AI').click();
  await expect(editor.getByRole('combobox', { name: 'Reasoning effort' })).toHaveValue('low');
  await tab('General').click();
  await editor.getByRole('button', { name: `Remove model ${together}` }).click();
  await expect(tab('Together AI')).toHaveCount(0);
  await editor.getByRole('button', { name: `Move ${alternate} up` }).click();
  await tab('OpenAI').click();
  await expect(modelTabs.getByRole('tab')).toHaveText(['All', alternateLabel, firstModelLabel]);
  await expect(tier).toHaveValue('priority');
  await tab(firstModelLabel).click();
  await expect(tier).toHaveValue('scale');
  await editor.getByRole('button', { name: 'Save', exact: true }).click();

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
  await expect(tab('All')).toHaveAttribute('aria-selected', 'true');
  await tab(firstModelLabel).click();
  await expect(tier).toHaveValue('scale');
  await tab(alternateLabel).click();
  await expect(tier).toHaveValue('priority');
  await expect(editor.getByRole('spinbutton', { name: 'Compaction threshold' })).toHaveValue('4096');
  await expect(tab('Together AI')).toHaveCount(0);
});

test('agent cards share provider icons and fall back when themed icons fail or are removed', async ({ page }) => {
  await page.route('**/agent-mark.svg', (route) => route.fulfill(iconResponse));
  await page.route('**/agent-light.svg', (route) => route.fulfill(iconResponse));
  await page.route('**/agent-dark.svg', (route) => route.fulfill({ status: 404 }));
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto('/');
  await agents(page).click();
  const sample = card(page, welcome);
  const icon = sample.locator('.catalog-mark img');
  await expect(icon).toHaveAttribute('src', openAiFavicon);
  await sample.getByRole('button', { name: 'Edit', exact: true }).click();
  const edit = page.getByRole('dialog', { name: 'Agent', exact: true });
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
  await edit.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(icon).toHaveAttribute('src', '/agent-light.svg');
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect(icon).toHaveAttribute('src', '/agent-mark.svg');

  await sample.getByRole('button', { name: 'Edit', exact: true }).click();
  await details.click();
  await edit.getByRole('button', { name: 'Remove icon 1', exact: true }).click();
  await edit.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(icon).toHaveAttribute('src', openAiFavicon);
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
  const editor = page.getByRole('dialog', { name: 'Agent', exact: true });
  await expect(editor.getByLabel('Name', { exact: true })).toHaveAttribute('readonly', '');
  await editor.getByLabel('Description', { exact: true }).fill('Custom sample description.');
  await editor.getByRole('button', { name: 'Save', exact: true }).click();

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
    body: `export const readMcpScopes = () => undefined;
    export async function createEntraAuth() {
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
  await (await create(page, 'Alpha only')).getByRole('button', { name: 'Save', exact: true }).click();
  await expect(card(page, 'Alpha only')).toBeVisible();
  await card(page, welcome).getByRole('button', { name: 'Edit', exact: true }).click();
  const editor = page.getByRole('dialog', { name: 'Agent', exact: true });
  await editor.getByLabel('Description', { exact: true }).fill('Alpha override.');
  await editor.getByRole('button', { name: 'Save', exact: true }).click();
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
    await expect(editor.getByRole('tabpanel', { name: 'Tool configuration', exact: true })).toBeVisible();
    await page.keyboard.press('Home');
    await expect(general).toBeFocused();
    await expect(editor.getByLabel('Instructions', { exact: true })).toHaveValue('Write something helpful.');
    await page.keyboard.press('Escape');
    await expect(editor).toBeHidden();
    await expect(page.getByRole('button', { name: 'Create agent', exact: true })).toBeFocused();
    await expect(card(page, `${theme} unsaved`)).toHaveCount(0);
  });
}
