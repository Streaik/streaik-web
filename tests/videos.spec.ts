import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

const model = 'google/veo-3.1-generate';
const openVideos = (page: Page) => page.getByRole('button', { name: 'Videos', exact: true }).click();
const videoPrompt = (page: Page) => page.getByRole('textbox', { name: 'Video prompt' });
const send = (page: Page) => page.getByRole('form', { name: 'Video composer' }).getByRole('button', { name: 'Send', exact: true });

async function mockCatalog(page: Page) {
  await page.route('**/gateway/v1/models', route => route.fulfill({ json: { data: [
    { id: 'google/gemini-flash', name: 'Gemini Flash', type: 'language' },
    { id: 'google/imagen-4', name: 'Imagen', type: 'image' },
    { id: model, name: 'Veo', type: 'video' },
  ] } }));
  await page.route('**/gateway/v1/skills?*', route => route.fulfill({ json: { data: [], has_more: false } }));
}

async function addKey(page: Page) {
  await page.getByRole('button', { name: 'Account menu', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Settings', exact: true }).click();
  const settings = page.getByRole('dialog', { name: 'Settings', exact: true });
  await settings.getByRole('tab', { name: 'API keys' }).click();
  await settings.getByRole('button', { name: 'Add API key' }).click();
  await settings.getByLabel('Provider', { exact: true }).selectOption('google');
  await settings.getByLabel('Google Gemini API key', { exact: true }).fill('fixture-video-key');
  await settings.getByRole('button', { name: 'Save Google Gemini key' }).click();
  await expect(settings.getByRole('status')).toHaveText('Provider key saved.');
  await settings.getByRole('button', { name: 'Close', exact: true }).click();
}

async function recordFixture(page: Page) {
  const bytes = await page.evaluate(async () => {
    const canvas = document.createElement('canvas');
    canvas.width = 32;
    canvas.height = 24;
    const ctx = canvas.getContext('2d')!;
    const stream = canvas.captureStream(20);
    const recorder = new MediaRecorder(stream, { mimeType: 'video/webm;codecs=vp8' });
    const chunks: Blob[] = [];
    recorder.ondataavailable = ({ data }) => chunks.push(data);
    const stopped = new Promise<void>(resolve => { recorder.onstop = () => resolve(); });
    recorder.start();
    for (let frame = 0; frame < 5; frame++) {
      ctx.fillStyle = frame % 2 ? 'green' : 'blue';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      await new Promise(resolve => setTimeout(resolve, 70));
    }
    recorder.stop();
    await stopped;
    stream.getTracks().forEach(track => track.stop());
    return [...new Uint8Array(await new Blob(chunks).arrayBuffer())];
  });
  return Buffer.from(bytes).toString('base64');
}

test('a pending video resumes after reload and its playable result is saved', async ({ page }) => {
  await mockCatalog(page);
  const prompt = 'A paper boat on a pond';
  let submissions = 0;
  let checks = 0;
  let clip: string | undefined;
  await page.route('**/gateway/api/videos', async route => {
    expect(route.request().method()).toBe('POST');
    expect(await route.request().headerValue('X-Google-Key')).toBe('fixture-video-key');
    expect(route.request().postDataJSON()).toEqual({ model, prompt });
    submissions++;
    return route.fulfill({ json: { operation: 'google/protected_ref' } });
  });
  await page.route('**/gateway/api/videos/google/protected_ref', async route => {
    expect(route.request().method()).toBe('GET');
    expect(await route.request().headerValue('X-Google-Key')).toBe('fixture-video-key');
    checks++;
    return route.fulfill({ json: clip ? { status: 'completed', videos: [{ type: 'base64', data: clip, mediaType: 'video/webm' }] } : { status: 'pending' } });
  });
  await page.goto('/');
  await addKey(page);
  await openVideos(page);
  await page.getByRole('button', { name: 'Model', exact: true }).click();
  await expect(page.getByRole('listbox', { name: 'Model', exact: true }).getByRole('option')).toHaveText(['Veo']);
  await expect(page.getByRole('option', { name: 'Veo', exact: true })).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('form', { name: 'Video composer' }).getByRole('button', { name: 'Add attachments' })).toHaveCount(0);
  await videoPrompt(page).fill(`  ${prompt}  `);
  await send(page).click();
  await expect(page.getByText('Generating video…', { exact: true })).toBeVisible();
  await expect(page.locator('.video-preview.image-shimmer')).toBeVisible();
  await expect.poll(() => checks).toBeGreaterThanOrEqual(1);
  const fixture = await recordFixture(page);

  await page.reload();
  await openVideos(page);
  await expect(page.getByText('Waiting for the gateway…')).toBeVisible();
  await expect(page.getByText(prompt, { exact: true })).toBeVisible();
  const beforeResume = checks;
  clip = fixture;
  await addKey(page);
  const player = page.locator('video[aria-label="Generated video"]');
  await expect(player).toBeVisible();
  await expect(player).toHaveJSProperty('controls', true);
  await expect.poll(() => player.evaluate(video => (video as HTMLVideoElement).videoWidth)).toBe(32);
  await expect(page.locator('.video-preview.image-shimmer')).toHaveCount(0);
  expect(checks).toBe(beforeResume + 1);
  expect(submissions).toBe(1);

  await page.reload();
  await openVideos(page);
  await expect.poll(() => player.evaluate(video => (video as HTMLVideoElement).videoWidth)).toBe(32);
  expect(checks).toBe(beforeResume + 1);
  expect(submissions).toBe(1);
});

test('transient status errors retry without a new submission; terminal failures stop the shimmer', async ({ page }) => {
  await page.clock.install();
  await mockCatalog(page);
  let checks = 0;
  await page.route('**/gateway/api/videos', route => route.fulfill({ json: { operation: 'google/failing_ref' } }));
  await page.route('**/gateway/api/videos/google/failing_ref', route => ++checks === 1
    ? route.fulfill({ status: 503 }) : route.fulfill({ json: { status: 'error', error: 'Provider could not finish this video.' } }));
  await page.goto('/');
  await addKey(page);
  await openVideos(page);
  await videoPrompt(page).fill('A windy night');
  await send(page).click();
  await expect(page.getByText('Could not check video status. Retrying…')).toBeVisible();
  await expect(page.locator('.video-preview.image-shimmer')).toBeVisible();
  await page.clock.fastForward(10_100);
  await expect(page.getByRole('alert')).toHaveText('Provider could not finish this video.');
  await expect(page.locator('.video-preview.image-shimmer')).toHaveCount(0);
  await page.clock.fastForward(20_000);
  expect(checks).toBe(2);
  await page.reload();
  await openVideos(page);
  await expect(page.getByRole('alert')).toHaveText('Provider could not finish this video.');
});
