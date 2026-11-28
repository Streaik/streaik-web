import { expect, test } from '@playwright/test';
import type { Locator } from '@playwright/test';
import { selectKeyProvider } from './provider-key-picker';

const themes = ['html', 'fluent', 'shadcn'] as const;

async function expectThemedSwitch(control: Locator, theme: typeof themes[number]) {
  if (theme === 'html') {
    await expect(control).toHaveAttribute('type', 'checkbox');
    await expect(control).not.toHaveAttribute('role', 'switch');
    await expect(control).toHaveCSS('appearance', 'auto');
  } else if (theme === 'fluent') {
    await expect(control).toHaveClass(/\bfui-Switch__input\b/);
  } else {
    await expect(control).toHaveClass(/\bshadcn-switch\b/);
    await expect(control.locator('.shadcn-switch-thumb')).toBeVisible();
  }
}

for (const theme of themes) {
  test(`${theme} renders on/off settings with its own control`, async ({ page }) => {
    await page.addInitScript(theme => localStorage.setItem('streaik.theme', theme), theme);
    await page.route('**/gateway/v1/models', route => route.fulfill({ json: { data: [{ id: 'openai/gpt-4.1-mini' }] } }));
    await page.goto('/');

    const role = theme === 'html' ? 'checkbox' : 'switch';
    await page.getByRole('button', { name: 'Account menu', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Settings', exact: true }).click();
    const settings = page.getByRole('dialog', { name: 'Settings', exact: true });
    await settings.getByRole('tab', { name: 'Theme', exact: true }).click();
    const themeName = { html: 'HTML', fluent: 'Fluent', shadcn: 'shadcn' }[theme];
    await expect(settings.getByRole('group', { name: `${themeName} settings`, exact: true })).toBeVisible({ timeout: 15_000 });
    await settings.getByRole('tab', { name: 'Model Context', exact: true }).click();
    const disabled = settings.getByRole('tabpanel', { name: 'Client', exact: true }).getByRole(role, { name: 'URL', exact: true });
    await expectThemedSwitch(disabled, theme);
    await expect(disabled).toBeDisabled();
    await expect(disabled).toHaveAccessibleDescription('URL elicitation is not supported yet.');

    await settings.getByRole('tab', { name: 'API keys', exact: true }).click();
    const keys = settings.getByRole('tabpanel', { name: 'API keys', exact: true });
    await keys.getByRole('button', { name: 'Add API key', exact: true }).click();
    await selectKeyProvider(keys, 'OpenAI');
    await keys.getByLabel('OpenAI API key', { exact: true }).fill('test-openai-key');
    await keys.getByRole('button', { name: 'Save OpenAI key', exact: true }).click();
    await expect(keys.getByRole('status')).toHaveText('Provider key saved.');
    await settings.getByRole('button', { name: 'Close', exact: true }).click();

    const model = page.getByRole('button', { name: 'Model', exact: true });
    await expect(model).toBeEnabled();
    if (await model.textContent() !== 'gpt-4.1-mini') {
      await model.click();
      await page.getByRole('option', { name: 'gpt-4.1-mini', exact: true }).click();
    }

    const chatSettings = page.getByRole('dialog', { name: 'Chat settings', exact: true });
    const openChatSettings = () => page.getByRole('button', { name: 'Chat settings', exact: true }).click();
    const openTab = (name: string) => chatSettings.getByRole('tab', { name, exact: true }).click();
    await openChatSettings();
    await openTab('Tools');
    const tools = chatSettings.getByRole('tabpanel', { name: 'Tools', exact: true });
    const ai = tools.getByRole(role, { name: 'Artificial Intelligence', exact: true });
    await expect(tools.getByRole(role)).toHaveCount(4);
    await expectThemedSwitch(ai, theme);
    await expect(ai).not.toBeChecked();
    await ai.press('Space');
    await expect(ai).toBeChecked();
    await tools.locator('label').getByText('Artificial Intelligence', { exact: true }).click();
    await expect(ai).not.toBeChecked();
    await ai.click();
    await expect(ai).toBeChecked();

    await openTab('Tool configuration');
    const config = chatSettings.getByRole('tabpanel', { name: 'Tool configuration', exact: true });
    await expectThemedSwitch(config.getByRole(role, { name: 'Search for All tools', exact: true }), theme);
    await config.locator('summary[aria-label="Usage method for All tools"]').click();
    const direct = config.getByRole('checkbox', { name: 'Direct', exact: true });
    await expect(direct).toHaveCSS('appearance', 'auto');
    await direct.check();

    await openTab('OpenAI');
    const provider = chatSettings.getByRole('tabpanel', { name: 'OpenAI', exact: true });
    const reasoning = provider.getByRole(role, { name: 'Include encrypted reasoning', exact: true });
    await expectThemedSwitch(reasoning, theme);
    await expect(reasoning).toBeChecked();
    await reasoning.press('Space');
    await expect(reasoning).not.toBeChecked();
    await chatSettings.getByRole('button', { name: /^(Close|Save)$/ }).click();

    await openChatSettings();
    await openTab('Tools');
    await expect(ai).toBeChecked();
    await openTab('OpenAI');
    await expect(reasoning).not.toBeChecked();
  });
}
