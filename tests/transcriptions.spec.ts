import { expect, test } from '@playwright/test';
import type { Locator, Page, WebSocketRoute } from '@playwright/test';
import { selectKeyProvider } from './provider-key-picker';

const batchModel = 'openai/gpt-4o-transcribe';
const liveModel = 'openai/gpt-realtime-transcribe';
const googleModel = 'google/gemini-3.5-transcribe-live';
const googleSocket = 'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContentConstrained';
const deepgramModel = 'deepgram/nova-3';
const deepgramSocket = 'wss://api.deepgram.com/v1/listen?model=nova-3';
const assemblyAIModel = 'assemblyai/assemblyai-stt-3-7-realtime';
const assemblyAISocket = 'wss://streaming.assemblyai.com/v3/ws?sample_rate=16000&speech_model=assemblyai-stt-3-7-realtime';
const file = { name: 'interview.wav', mimeType: 'audio/wav', buffer: Buffer.from('audio fixture') };
const start = (page: Page) => page.getByRole('button', { name: 'Real-time', exact: true });
const stop = (page: Page) => page.getByRole('button', { name: 'Stop Real-time', exact: true });
const preview = (page: Page) => page.getByRole('article', { name: 'Streaming transcript' });

async function expectIconOnly(control: Locator) {
  await expect(control).toHaveText('');
  await expect(control.locator('svg')).toBeVisible();
}

type FixtureModel = { id: string; type: string; tags?: string[] };
async function connectFixture(page: Page, provider: string, models: FixtureModel[]) {
  await page.route('**/gateway/v1/models', route => route.fulfill({ json: { data: models } }));
  await page.route('**/gateway/v1/skills?*', route => route.fulfill({ json: { data: [], has_more: false } }));
  await page.goto('/');
  await saveFixtureKey(page, provider);
}

async function saveFixtureKey(page: Page, provider: string) {
  const dialog = await appSettings(page, 'API keys');
  await dialog.getByRole('button', { name: 'Add API key' }).click();
  await selectKeyProvider(dialog, provider);
  await dialog.getByLabel(`${provider} API key`, { exact: true }).fill('fixture-provider-key');
  await dialog.getByRole('button', { name: `Save ${provider} key` }).click();
  await expect(dialog.getByRole('status')).toHaveText('Provider key saved.');
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();
}

async function appSettings(page: Page, tab: string) {
  await page.getByRole('button', { name: 'Account menu' }).click();
  await page.getByRole('menuitem', { name: 'Settings' }).click();
  const dialog = page.getByRole('dialog', { name: 'Settings', exact: true });
  await dialog.getByRole('tab', { name: tab, exact: true }).click();
  return dialog;
}

async function openTranscriptions(page: Page, provider = 'OpenAI', models: FixtureModel[] = [
  { id: batchModel, type: 'transcription' }, { id: liveModel, type: 'transcription', tags: ['realtime'] },
  { id: 'gladia/solaria-1', type: 'transcription', tags: ['realtime'] },
]) {
  await connectFixture(page, provider, models);
  await page.getByRole('button', { name: 'Transcriptions', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Transcriptions', exact: true })).toBeVisible();
  if (models.some(({ id }) => id === batchModel)) await chooseModel(page, batchModel);
}

async function chooseRoute(page: Page, path: string) {
  await page.getByRole('button', { name: 'Account menu' }).click();
  await page.getByRole('menuitem', { name: 'Route', exact: true }).hover();
  await page.getByRole('menuitemradio', { name: path, exact: true }).click();
}

const modelPicker = (page: Page) => page.getByRole('button', { name: 'Model', exact: true });
async function chooseModel(page: Page, model: string) {
  await modelPicker(page).click();
  await page.getByRole('option', { name: model.split('/').at(-1), exact: true }).click();
}

const transcriptionComposer = (page: Page) => page.getByRole('form', { name: 'Transcription composer' });
const transcriptionSettingsButton = (page: Page) => transcriptionComposer(page).getByRole('button', { name: 'Transcription settings', exact: true });
async function transcriptionSettings(page: Page) {
  await transcriptionSettingsButton(page).click();
  return page.getByRole('dialog', { name: 'Settings', exact: true });
}

test('only the native OpenAI route uses General; Vercel routes keep provider settings separate', async ({ page }) => {
  await openTranscriptions(page);
  let dialog = await transcriptionSettings(page);
  await expect(dialog.getByRole('tab', { name: 'OpenAI', selected: true })).toBeVisible();
  await expect(dialog.getByRole('tab', { name: 'General' })).toHaveCount(0);
  await expect(dialog.getByRole('heading', { name: 'General', exact: true })).toBeVisible();
  await expect(dialog.getByLabel('Response format')).toHaveCount(0);
  await expect(dialog.getByRole('switch', { name: 'Split large audio files' })).toHaveCount(0);
  await dialog.getByLabel('Transcription prompt').fill('Spell Streaik exactly.');
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();

  await chooseRoute(page, '/api/transcriptions/stream');
  dialog = await transcriptionSettings(page);
  await expect(dialog.getByRole('tab', { name: 'OpenAI', selected: true })).toBeVisible();
  await expect(dialog.getByLabel('Transcription prompt')).toHaveValue('Spell Streaik exactly.');
  await expect(dialog.getByLabel('Response format')).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Cancel' }).click();

  await chooseRoute(page, '/v1/audio/transcriptions');
  dialog = await transcriptionSettings(page);
  await expect(dialog.getByRole('tab', { name: 'General', selected: true })).toBeVisible();
  await expect(dialog.getByRole('tab', { name: 'OpenAI' })).toHaveCount(0);
  await dialog.getByLabel('Response format').selectOption('text');
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  await page.route('**/gateway/v1/audio/transcriptions', async route => {
    expect(route.request().postData()).toMatch(/name="response_format"\r\n\r\ntext/);
    expect(route.request().postData()).toContain('Spell Streaik exactly.');
    await route.fulfill({ contentType: 'text/plain', body: 'Plain text transcript' });
  });
  const composer = transcriptionComposer(page);
  await composer.locator('input[type=file]').setInputFiles(file);
  await composer.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(page.getByText('Plain text transcript', { exact: true })).toBeVisible();
});

test('transcription settings are disabled without a form for the selected model and route', async ({ page }) => {
  const googleBatchModel = 'google/gemini-2.5-flash';
  const modelWithoutForm = 'openrouter/transcription-model';
  await openTranscriptions(page, 'Google Gemini', [
    { id: googleBatchModel, type: 'transcription' },
    { id: googleModel, type: 'transcription', tags: ['realtime'] },
    { id: modelWithoutForm, type: 'transcription' },
  ]);
  const button = transcriptionSettingsButton(page);
  await expect(button).toBeDisabled();
  await chooseModel(page, modelWithoutForm);
  await expect(button).toBeDisabled();

  await chooseModel(page, googleBatchModel);
  const dialog = await transcriptionSettings(page);
  await expect(dialog.getByRole('heading', { name: 'General', exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await chooseRoute(page, '/v1/audio/transcriptions');
  await expect(modelPicker(page)).toContainText('gemini-2.5-flash');
  await expect(button).toBeDisabled();

  await chooseModel(page, googleModel);
  await expect(await transcriptionSettings(page)).toHaveText(/Language codes/);
});

test('settings split a 100 MB WAV in the browser and save one merged transcript', async ({ page }) => {
  test.setTimeout(90_000);
  await page.addInitScript(() => {
    const fetchOriginal = window.fetch.bind(window);
    let count = 0;
    window.fetch = async (input, init) => {
      if (new URL(input instanceof Request ? input.url : String(input), location.href).pathname !== '/gateway/api/transcriptions') return fetchOriginal(input, init);
      const body = JSON.parse(String(init?.body));
      if (body.mediaType !== 'audio/wav' || atob(body.audio).length > 10 * 1024 * 1024) throw new Error('Unexpected chunk size or encoding');
      document.documentElement.dataset.chunks = String(++count);
      return Response.json({ text: count === 1 ? 'First shared phrase' : `shared phrase part ${count} shared phrase`, segments: [] });
    };
  });
  await openTranscriptions(page);
  const settings = await appSettings(page, 'Transcriptions');
  await expect(settings.getByRole('switch', { name: 'Split large audio files' })).toBeChecked();
  const overlap = settings.getByRole('slider', { name: 'Chunk overlap', exact: true });
  const maxChunkSize = settings.getByRole('slider', { name: 'Max chunk size', exact: true });
  await expect(overlap).toHaveAttribute('aria-valuetext', '5 s');
  await expect(maxChunkSize).toHaveAttribute('aria-valuetext', '15 MB');
  await expect(settings.getByText('5 s', { exact: true })).toBeVisible();
  await expect(settings.getByText('15 MB', { exact: true })).toBeVisible();
  await settings.getByRole('switch', { name: 'Split large audio files' }).uncheck();
  await expect(maxChunkSize).toBeDisabled();
  await settings.getByRole('switch', { name: 'Split large audio files' }).check();
  await maxChunkSize.fill('10');
  await expect(settings.getByText('10 MB', { exact: true })).toBeVisible();
  await settings.getByRole('button', { name: 'Close', exact: true }).click();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Transcriptions', exact: true })).toBeVisible();
  const persisted = await appSettings(page, 'Transcriptions');
  await expect(persisted.getByRole('slider', { name: 'Max chunk size', exact: true })).toHaveValue('10');
  await persisted.getByRole('button', { name: 'Close', exact: true }).click();
  await saveFixtureKey(page, 'OpenAI');
  await expect(modelPicker(page)).toContainText('gpt-4o-transcribe');
  const composer = transcriptionComposer(page);
  await composer.locator('input[type=file]').evaluate(input => {
    const size = 100 * 1024 * 1024;
    const wav = new DataView(new ArrayBuffer(44));
    wav.setUint32(0, 0x52494646); wav.setUint32(4, size - 8, true);
    wav.setUint32(8, 0x57415645); wav.setUint32(12, 0x666d7420); wav.setUint32(16, 16, true);
    wav.setUint16(20, 1, true); wav.setUint16(22, 1, true); wav.setUint32(24, 48000, true);
    wav.setUint32(28, 96000, true); wav.setUint16(32, 2, true); wav.setUint16(34, 16, true);
    wav.setUint32(36, 0x64617461); wav.setUint32(40, size - 44, true);
    const transfer = new DataTransfer();
    transfer.items.add(new File([wav.buffer, new Uint8Array(size - 44)], 'long-meeting.wav', { type: 'audio/wav' }));
    (input as HTMLInputElement).files = transfer.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await composer.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(page.getByText('First shared phrase part 2 shared phrase part 3 shared phrase part 4 shared phrase', { exact: true })).toBeVisible({ timeout: 60_000 });
  await expect(page.locator('html')).toHaveAttribute('data-chunks', '4');
  await expect(page.getByRole('heading', { name: 'long-meeting.wav' })).toHaveCount(1);
});

const composerModel = 'openai/gpt-transcribe';
const composerCatalog = [
  { id: 'openai/gpt-6.1-terra', type: 'language' },
  { id: 'openai/gpt-image-2.6-sunburst', type: 'image' },
  { id: 'google/gemini-omni-1.2-flash', type: 'video' },
];
const chatComposer = (page: Page) => page.getByRole('form', { name: 'Message composer' });
const dictateButton = (composer: Locator) => composer.getByRole('button', { name: 'Dictate', exact: true });
const stopDictate = (composer: Locator) => composer.getByRole('button', { name: 'Stop Dictate', exact: true });

test('composer dictation requires an assigned agent and an available configured model', async ({ page }) => {
  const catalog = [{ id: batchModel, type: 'transcription' }];
  await connectFixture(page, 'OpenAI', catalog);
  const dictate = dictateButton(chatComposer(page));
  const refresh = page.getByRole('button', { name: 'Refresh models' });
  await expect(refresh).toBeVisible();
  await expect(dictate).toBeDisabled(); // A different transcription model is not an implicit default.
  catalog.push({ id: composerModel, type: 'transcription' });
  await refresh.click();
  await expect(dictate).toBeEnabled();
  const settings = await appSettings(page, 'Agents');
  await settings.getByRole('combobox', { name: 'Create a transcription', exact: true }).click();
  await settings.getByRole('option', { name: 'None', exact: true }).click();
  await settings.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(dictate).toBeDisabled();
  const chatSettings = await appSettings(page, 'Chat');
  await chatSettings.getByRole('switch', { name: 'Dictate', exact: true }).uncheck();
  await chatSettings.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(dictate).toHaveCount(0);
});

test('recorded composer dictation streams only after Stop and preserves the prompt in Chat, Images, and Videos', async ({ page }) => {
  await mockAudio(page);
  await watchRecordedAudio(page);
  await page.addInitScript(() => {
    const nativeFetch = window.fetch.bind(window);
    window.fetch = async (input, init) => {
      const path = new URL(input instanceof Request ? input.url : String(input), location.href).pathname;
      if (path !== '/gateway/api/transcriptions/stream') return nativeFetch(input, init);
      const { model, audio, inputAudioFormat } = JSON.parse(String(init?.body));
      document.documentElement.dataset.dictationRequest = JSON.stringify({ model, bytes: atob(audio).length, format: inputAudioFormat.type });
      const body = new ReadableStream({ start(controller) {
        const send = (event: object) => controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(event)}\n\n`));
        send({ type: 'transcript-delta', delta: 'Interim words' });
        window.addEventListener('fixture-dictation-finish', event => {
          send(event instanceof CustomEvent && event.detail ? { type: 'error' } : { type: 'finish', text: 'Final words.' });
          controller.close();
        }, { once: true });
      } });
      return new Response(body, { headers: { 'Content-Type': 'text/event-stream' } });
    };
  });
  await connectFixture(page, 'OpenAI', [...composerCatalog, { id: composerModel, type: 'transcription' }]);
  let unexpectedRequests = 0;
  await page.route(/\/gateway\/(api\/(chat|images?|videos?|transcriptions)|v1\/(images\/generations|videos|audio\/transcriptions))$/, route => {
    unexpectedRequests++; return route.abort();
  });
  await chatComposer(page).locator('input[type="file"]').setInputFiles({ name: 'context.txt', mimeType: 'text/plain', buffer: Buffer.from('context') });
  for (const [view, name] of [[undefined, 'Message composer'], ['Images', 'Image composer'], ['Videos', 'Video composer']] as const) {
    if (view) await page.getByRole('button', { name: view, exact: true }).click();
    await page.evaluate(() => {
      delete document.documentElement.dataset.dictationRequest;
      delete document.documentElement.dataset.audioRecorded;
    });
    const composer = page.getByRole('form', { name });
    const input = composer.getByRole('textbox');
    const send = composer.getByRole('button', { name: 'Send', exact: true });
    await input.fill('Existing draft');
    await expect(send).toBeEnabled();
    await expectIconOnly(dictateButton(composer));
    await dictateButton(composer).click();
    await expect(page.locator('html')).toHaveAttribute('data-track', 'active');
    await expect(input).not.toBeEditable();
    await expect(send).toBeDisabled();
    await input.press('Enter');
    await expect(page.locator('html')).toHaveAttribute('data-audio-recorded', 'yes');
    expect(await page.locator('html').getAttribute('data-dictation-request')).toBeNull();
    await stopDictate(composer).click();
    await expect(page.locator('html')).toHaveAttribute('data-track', 'stopped');
    await expect(input).toHaveValue('Existing draft Interim words');
    await expect(input).not.toBeEditable();
    await expect(send).toBeDisabled();
    const request = JSON.parse((await page.locator('html').getAttribute('data-dictation-request'))!);
    expect(request).toEqual({
      model: composerModel, bytes: expect.any(Number), format: expect.stringMatching(/^audio\/(webm|mp4|ogg)$/),
    });
    expect(request.bytes).toBeGreaterThan(0);
    await page.evaluate(() => window.dispatchEvent(new Event('fixture-dictation-finish')));
    await expect(input).toHaveValue('Existing draft Final words.');
    await expect(input).toBeEditable();
    await expect(send).toBeEnabled();
    if (!view) await expect(composer.getByText('context.txt', { exact: true })).toBeVisible();
  }
  const video = page.getByRole('form', { name: 'Video composer' });
  await page.evaluate(() => { delete document.documentElement.dataset.audioRecorded; });
  await dictateButton(video).click();
  await expect(page.locator('html')).toHaveAttribute('data-audio-recorded', 'yes');
  await stopDictate(video).click();
  const prompt = video.getByRole('textbox');
  await expect(prompt).toHaveValue('Existing draft Final words. Interim words');
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('fixture-dictation-finish', { detail: 'error' })));
  await expect(video.getByRole('alert')).toHaveText('The transcription stream failed.');
  await expect(prompt).toHaveValue('Existing draft Final words.');
  await expect(prompt).toBeEditable();
  await expect(video.getByRole('button', { name: 'Send' })).toBeEnabled();
  expect(unexpectedRequests).toBe(0);
});

test('composer prefers a configured realtime model, reports failures without retry, and stops capture on navigation', async ({ page }) => {
  const model = 'openai/gpt-live-transcribe';
  await mockAudio(page);
  let tokens = 0, recorded = 0;
  await page.route('**/gateway/v1/realtime/client_secrets', async route => {
    expect(route.request().postDataJSON().session.audio.input.transcription.model).toBe(model);
    if (++tokens === 2) return route.fulfill({ status: 503 });
    await route.fulfill({ json: { value: 'fixture-ephemeral-secret' } });
  });
  await page.route('**/gateway/api/transcriptions/stream', route => { recorded++; return route.abort(); });
  let sockets = 0;
  const closed = new Set<string>();
  await page.routeWebSocket('wss://api.openai.com/v1/realtime?intent=transcription', socket => {
    const id = `live-${++sockets}`;
    let started = false;
    socket.onClose(() => { closed.add(id); });
    socket.onMessage(raw => {
      const { type } = JSON.parse(String(raw));
      const event = (name: string, data = {}) => socket.send(JSON.stringify({ type: name, item_id: id, ...data }));
      if (type === 'input_audio_buffer.append' && !started) {
        started = true;
        event('conversation.item.input_audio_transcription.delta', { delta: 'Live preview' });
      } else if (type === 'input_audio_buffer.commit') {
        event('input_audio_buffer.committed');
        event('conversation.item.input_audio_transcription.completed', { transcript: 'Final realtime.' });
      }
    });
  });
  await connectFixture(page, 'OpenAI', [...composerCatalog, { id: composerModel, type: 'transcription' }, { id: model, type: 'transcription', tags: ['realtime'] }]);
  await page.getByRole('button', { name: 'Agents', exact: true }).click();
  await page.getByRole('article', { name: 'TranscriptionAgent', exact: true }).getByRole('button', { name: 'Edit', exact: true }).click();
  const editor = page.getByRole('dialog', { name: 'Agent', exact: true });
  await editor.getByRole('button', { name: 'Add model', exact: true }).click();
  await editor.getByRole('option', { name: /gpt-live-transcribe/ }).click();
  await editor.getByRole('button', { name: 'Save', exact: true }).click();
  await page.getByRole('button', { name: 'New chat', exact: true }).click();
  const composer = chatComposer(page);
  const input = composer.getByRole('textbox');
  await input.fill('Draft');
  await dictateButton(composer).click();
  await expect(input).toHaveValue('Draft Live preview');
  await stopDictate(composer).click();
  await expect(input).toHaveValue('Draft Final realtime.');
  await expect(input).toBeEditable();
  await expect.poll(() => closed.has('live-1')).toBe(true);

  await dictateButton(composer).click();
  await expect(composer.getByRole('alert')).toBeVisible();
  await expect(input).toHaveValue('Draft Final realtime.');
  await expect(input).toBeEditable();
  await expect(page.locator('html')).toHaveAttribute('data-track', 'stopped');
  expect(tokens).toBe(2);

  await dictateButton(composer).click();
  await expect(input).toHaveValue('Draft Final realtime. Live preview');
  await page.getByRole('button', { name: 'Images', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-track', 'stopped');
  await expect.poll(() => closed.has('live-2')).toBe(true);
  await page.goBack();
  await expect(input).toHaveValue('Draft Final realtime.');
  await expect(input).toBeEditable();
  expect(recorded).toBe(0);
});

test('composer dictation can use Deepgram live audio and appends the final result after Stop', async ({ page }) => {
  await mockAudio(page);
  await page.route(`**/gateway/api/realtime/token/${deepgramModel}`, route => route.fulfill({ json: {
    url: deepgramSocket, token: 'temporary-deepgram-token', expiresAt: Math.floor(Date.now() / 1000) + 30,
  } }));
  await page.routeWebSocket(/^wss:\/\/api\.deepgram\.com\/v1\/listen\?/, socket => {
    let sent = false;
    const result = (transcript: string, is_final: boolean) => socket.send(JSON.stringify({
      type: 'Results', is_final, start: 0, duration: 1, channel: { alternatives: [{ transcript }] },
    }));
    socket.onMessage(raw => {
      if (typeof raw !== 'string' && !sent) { sent = true; result('Live preview', false); }
      if (typeof raw === 'string' && JSON.parse(raw).type === 'CloseStream') {
        result('Confirmed text.', true);
        socket.send(JSON.stringify({ type: 'Metadata', duration: 1 }));
      }
    });
  });
  await connectFixture(page, 'Deepgram', [...composerCatalog, { id: deepgramModel, type: 'transcription', tags: ['realtime'] }]);
  await page.getByRole('button', { name: 'Agents', exact: true }).click();
  await page.getByRole('article', { name: 'TranscriptionAgent', exact: true }).getByRole('button', { name: 'Edit', exact: true }).click();
  const editor = page.getByRole('dialog', { name: 'Agent', exact: true });
  await editor.getByRole('button', { name: 'Add model', exact: true }).click();
  await editor.getByRole('option', { name: /nova-3/ }).click();
  await editor.getByRole('button', { name: 'Save', exact: true }).click();
  await page.getByRole('button', { name: 'New chat', exact: true }).click();
  const composer = chatComposer(page), input = composer.getByRole('textbox');
  await input.fill('Draft');
  await dictateButton(composer).click();
  await expect(input).toHaveValue('Draft Live preview');
  await stopDictate(composer).click();
  await expect(input).toHaveValue('Draft Confirmed text.');
  await expect(input).toBeEditable();
});

test('Real-time follows the transcription picker and explains tagged models without a live adapter', async ({ page }) => {
  const unsupported = 'assemblyai/unsupported';
  await openTranscriptions(page, 'OpenAI', [
    { id: batchModel, type: 'transcription' },
    { id: googleModel, type: 'transcription', tags: ['real-time'] },
    { id: unsupported, type: 'transcription', tags: ['realtime'] },
    { id: liveModel, type: 'audio', tags: ['realtime'] },
    { id: 'openai/gpt-live-transcribe', type: 'transcription' },
  ]);
  await expect(modelPicker(page)).toContainText('gpt-4o-transcribe');
  await expect(start(page)).toBeDisabled();
  const reason = 'The selected model does not support real-time transcription.';
  await expect(start(page)).toHaveAccessibleDescription(reason);
  await expect(page.getByText(reason, { exact: true })).toHaveCount(0);
  const trigger = page.getByRole('group', { name: 'Real-time', exact: true });
  const tooltip = page.getByRole('tooltip', { name: reason, exact: true });
  await trigger.hover();
  await expect(tooltip).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(tooltip).toBeHidden();
  await page.keyboard.press('Tab');
  await trigger.focus();
  await expect(tooltip).toBeVisible();
  await modelPicker(page).click();
  await expect(page.getByRole('option')).toHaveCount(3);
  await expect(page.getByRole('option', { name: 'gemini-3.5-transcribe-live', exact: true })).toBeVisible();
  await expect(page.getByRole('option', { name: 'gpt-4o-transcribe', exact: true })).toBeVisible();
  await page.getByRole('option', { name: 'unsupported', exact: true }).click();
  await expect(start(page)).toBeDisabled();
  await expect(start(page)).toHaveAccessibleDescription('This app cannot start a live session for the selected model.');
  await chooseModel(page, googleModel);
  await expect(modelPicker(page)).toContainText('gemini-3.5-transcribe-live');
  await expect(start(page)).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Dictate', exact: true })).toBeDisabled();
  const composer = page.getByRole('form', { name: 'Transcription composer' });
  await composer.locator('input[type=file]').setInputFiles(file);
  const send = composer.getByRole('button', { name: 'Send', exact: true });
  await expect(send).toBeDisabled();
  await chooseModel(page, batchModel);
  await expect(send).toBeEnabled();
  await expect(start(page)).toBeDisabled();
});

test('Deepgram microphone drains confirmed audio after Stop and reports a disconnect without saving interim text', async ({ page }) => {
  await mockAudio(page);
  await page.route(`**/gateway/api/realtime/token/${deepgramModel}`, async route => {
    expect(await route.request().headerValue('x-deepgram-key')).toBe('fixture-provider-key');
    expect(route.request().postDataJSON()).toEqual({});
    await route.fulfill({ json: { url: deepgramSocket, token: 'temporary-deepgram-token', expiresAt: Math.floor(Date.now() / 1000) + 30 } });
  });
  let socket: WebSocketRoute | undefined, bytes = 0, end = '';
  const result = (transcript: string, is_final: boolean, start = 0) => JSON.stringify({
    type: 'Results', is_final, start, duration: 1, channel: { alternatives: [{ transcript }] },
  });
  await page.routeWebSocket(/^wss:\/\/api\.deepgram\.com\/v1\/listen\?/, ws => {
    socket = ws;
    bytes = 0;
    const query = new URL(ws.url()).searchParams;
    expect(query.get('encoding')).toBe('linear16');
    expect(query.get('sample_rate')).toBe('16000');
    expect(query.get('interim_results')).toBe('true');
    expect(query.has('token')).toBe(false);
    ws.onMessage(raw => { if (typeof raw === 'string') end = JSON.parse(raw).type; else bytes += raw.length; });
  });
  await openTranscriptions(page, 'Deepgram', [{ id: deepgramModel, type: 'transcription', tags: ['realtime'] }]);
  await chooseModel(page, deepgramModel);
  await start(page).click();
  await expect.poll(() => bytes).toBeGreaterThan(0);
  socket!.send(result('Unconfirmed draft', false));
  await expect(preview(page)).toContainText('Unconfirmed draft');
  socket!.send(result('First result.', true));
  await expect(preview(page)).not.toContainText('Unconfirmed draft');
  await stop(page).click();
  await expect.poll(() => end).toBe('CloseStream');
  await expect(page.locator('html')).toHaveAttribute('data-track', 'stopped');
  socket!.send(result('Final result.', true, 1));
  socket!.send(JSON.stringify({ type: 'Metadata', duration: 2 }));
  await expect(start(page)).toBeEnabled();
  await page.getByRole('tab', { name: 'Finished', exact: true }).click();
  await expect(page.getByRole('article').filter({ hasText: 'First result. Final result.' })).toHaveCount(1);

  const previous = socket;
  await start(page).click();
  await expect.poll(() => socket !== previous && bytes > 0).toBe(true);
  socket!.send(result('Lost connection draft', false));
  await expect(preview(page)).toContainText('Lost connection draft');
  await socket!.close({ code: 1011 });
  await expect(page.getByRole('alert')).toContainText('Deepgram microphone transcription disconnected');
  await expect(page.locator('html')).toHaveAttribute('data-track', 'stopped');
  await page.getByRole('tab', { name: 'Finished', exact: true }).click();
  await expect(page.getByRole('article').filter({ hasText: 'Lost connection draft' })).toHaveCount(0);
});

test('AssemblyAI waits for Begin, accepts formatted turns through Termination, and cancels setup', async ({ page }) => {
  await mockAudio(page);
  await page.route(`**/gateway/api/realtime/token/${assemblyAIModel}`, async route => {
    expect(await route.request().headerValue('x-assemblyai-key')).toBe('fixture-provider-key');
    await route.fulfill({ json: { url: assemblyAISocket, token: 'temporary-assemblyai-token', expiresAt: Math.floor(Date.now() / 1000) + 60 } });
  });
  let socket: WebSocketRoute | undefined, frames = 0, ended = false, closed = false;
  const turn = (transcript: string, extra = {}) => JSON.stringify({ type: 'Turn', turn_order: 0, transcript, ...extra });
  await page.routeWebSocket(/^wss:\/\/streaming\.assemblyai\.com\/v3\/ws\?/, ws => {
    expect(new URL(ws.url()).searchParams.get('token')).toBe('temporary-assemblyai-token');
    socket = ws;
    closed = false;
    ws.onClose(() => { closed = true; });
    ws.onMessage(raw => {
      if (typeof raw === 'string') ended = JSON.parse(raw).type === 'Terminate';
      else { expect(raw.length).toBeGreaterThanOrEqual(640); frames++; }
    });
  });
  await openTranscriptions(page, 'AssemblyAI', [{ id: assemblyAIModel, type: 'transcription', tags: ['realtime'] }]);
  await chooseModel(page, assemblyAIModel);
  await start(page).click();
  await expect.poll(() => !!socket).toBe(true);
  await expect(page.getByText('Connecting microphone…', { exact: true })).toBeVisible();
  expect(frames).toBe(0);
  socket!.send(JSON.stringify({ type: 'Begin', id: 'fixture-session' }));
  await expect.poll(() => frames).toBeGreaterThan(0);
  socket!.send(turn('AssemblyAI draft'));
  await expect(preview(page)).toContainText('AssemblyAI draft');
  socket!.send(turn('assemblyai final', { end_of_turn: true }));
  await stop(page).click();
  await expect.poll(() => ended).toBe(true);
  await expect(page.locator('html')).toHaveAttribute('data-track', 'stopped');
  socket!.send(turn('AssemblyAI final.', { end_of_turn: true, turn_is_formatted: true, words: [{ start: 100, end: 800 }] }));
  socket!.send(JSON.stringify({ type: 'Termination', audio_duration_seconds: 1 }));
  await expect(start(page)).toBeEnabled();
  await page.getByRole('tab', { name: 'Finished', exact: true }).click();
  await expect(page.getByRole('article').filter({ hasText: 'AssemblyAI final.' })).toHaveCount(1);
  await expect(page.getByRole('article').filter({ hasText: 'assemblyai final AssemblyAI final.' })).toHaveCount(0);

  const previous = socket;
  await start(page).click();
  await expect.poll(() => socket !== previous).toBe(true);
  await expect(page.getByText('Connecting microphone…', { exact: true })).toBeVisible();
  await stop(page).click();
  await expect(page.locator('html')).toHaveAttribute('data-track', 'stopped');
  await expect.poll(() => closed).toBe(true);
  await expect(start(page)).toBeEnabled();
  await expect(page.getByRole('alert')).toHaveCount(0);
});

test('all file routes, drag and drop, interrupted SSE, and scoped finished cards', async ({ page }) => {
  const paths: string[] = [];
  let streamingAttempt = 0;
  await page.route(/\/gateway\/(api\/transcriptions(?:\/stream)?|v1\/audio\/transcriptions)$/, async route => {
    const request = route.request();
    const path = new URL(request.url()).pathname.split('/gateway')[1];
    paths.push(path);
    expect(await request.headerValue('X-OpenAI-Key')).toBe('fixture-provider-key');
    if (path.startsWith('/v1')) {
      expect(await request.headerValue('content-type')).toContain('multipart/form-data; boundary=');
      expect(request.postData()).toContain('filename="interview.wav"');
      expect(request.postData()).toContain(batchModel);
      return route.fulfill({ json: { text: 'Multipart transcript' } });
    }
    expect(request.postDataJSON()).toMatchObject({ model: batchModel, audio: file.buffer.toString('base64') });
    if (path === '/api/transcriptions') {
      expect(request.postDataJSON().mediaType).toBe('audio/wav');
      return route.fulfill({ json: { text: 'JSON transcript', segments: [{ text: 'JSON transcript', startSecond: 0, endSecond: 1 }],
        providerMetadata: { openai: { segments: [{ text: 'JSON transcript', start: 0, end: 1, speaker: 'A' }] } } } });
    }
    expect(request.postDataJSON().inputAudioFormat).toEqual({ type: 'audio/wav' });
    return route.fulfill({ contentType: 'text/event-stream', body: 'data: {"type":"transcript-delta","delta":"Incoming transcript"}\r\n\r\n' +
      (++streamingAttempt > 1 ? 'data: {"type":"finish","text":"Final stream transcript"}\n\n' : '') });
  });
  await openTranscriptions(page);
  const composer = page.getByRole('form', { name: 'Transcription composer' });
  await expectIconOnly(composer.getByRole('button', { name: 'Dictate', exact: true }));
  await expectIconOnly(start(page));
  const send = composer.getByRole('button', { name: 'Send' });
  const upload = async () => { await composer.locator('input[type=file]').setInputFiles(file); await send.click(); };
  await upload();
  await expect(page.getByText('JSON transcript', { exact: true }).first()).toBeVisible();
  await page.getByText('Segments', { exact: true }).click();
  await expect(page.getByText('0.0–1.0 s · Speaker A')).toBeVisible();

  await chooseRoute(page, '/v1/audio/transcriptions');
  const dropped = await page.evaluateHandle(({ name, bytes, type }) => {
    const data = new DataTransfer(); data.items.add(new File([new Uint8Array(bytes)], name, { type })); return data;
  }, { name: file.name, bytes: [...file.buffer], type: file.mimeType });
  await composer.dispatchEvent('drop', { dataTransfer: dropped });
  await send.click();
  await expect(page.getByText('Multipart transcript', { exact: true })).toBeVisible();

  await chooseRoute(page, '/api/transcriptions/stream');
  await upload();
  await expect(preview(page)).toContainText('Incoming transcript');
  await expect(composer.getByRole('alert')).toContainText('ended before a final transcript');
  await send.click(); // Failed item remains queued and can be retried.
  await expect(preview(page)).toContainText('Final stream transcript');
  await page.getByRole('tab', { name: 'Finished', exact: true }).click();
  await expect(page.getByRole('tabpanel', { name: 'Finished' }).getByRole('article')).toHaveCount(3);
  expect(paths).toEqual(['/api/transcriptions', '/v1/audio/transcriptions', '/api/transcriptions/stream', '/api/transcriptions/stream']);
  await page.reload();
  await page.getByRole('button', { name: 'Transcriptions', exact: true }).click();
  const cards = page.getByRole('tabpanel', { name: 'Finished' }).getByRole('article');
  await expect(cards).toHaveCount(3);
  const card = cards.filter({ hasText: 'Final stream transcript' });
  const copy = card.getByRole('button', { name: 'Copy', exact: true });
  const download = card.getByRole('button', { name: 'Download', exact: true });
  const more = card.locator('header').getByRole('button', { name: 'More actions for interview.wav', exact: true });
  const deleteAction = page.getByRole('menuitem', { name: 'Delete', exact: true });
  for (const control of [copy, download, more]) await expectIconOnly(control);
  await expect(more.locator('svg.lucide-ellipsis-vertical')).toBeVisible();

  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await copy.click();
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe('Final stream transcript');
  const downloaded = page.waitForEvent('download');
  await download.click();
  expect((await downloaded).suggestedFilename()).toBe('interview.txt');

  await expect(card.getByRole('button', { name: 'Delete', exact: true })).toHaveCount(0);
  await expect(deleteAction).toBeHidden();
  await more.press('Enter');
  await expect(deleteAction).toHaveText('Delete');
  await expect(deleteAction.locator('svg')).toBeVisible();
  await expect(deleteAction).toBeFocused();
  await deleteAction.press('Enter');
  await expect(card).toHaveCount(0);
  await expect(cards).toHaveCount(2);
});

test('Finished searches transcript text and filenames, including when new results arrive', async ({ page }) => {
  const texts = ['The café migration plan.', 'We discussed the budget.'];
  let uploaded = 0;
  await page.route('**/gateway/api/transcriptions', route => route.fulfill({ json: { text: texts[uploaded++] } }));
  await openTranscriptions(page);
  const composer = page.getByRole('form', { name: 'Transcription composer' });
  const send = composer.getByRole('button', { name: 'Send', exact: true });
  const upload = async (name: string) => {
    await composer.locator('input[type=file]').setInputFiles({ ...file, name });
    await send.click();
    await expect(send).toBeVisible();
  };
  const finished = page.getByRole('tabpanel', { name: 'Finished', exact: true });
  const search = finished.getByRole('searchbox', { name: 'Search transcriptions', exact: true });
  const titles = finished.getByRole('article').getByRole('heading');
  await expect(search).toHaveAttribute('placeholder', 'Search transcriptions…');
  await expect(finished.getByRole('status')).toHaveText('No finished transcriptions yet.');

  await upload('interview.wav');
  await expect(titles).toHaveText(['interview.wav']);
  await search.fill('budget');
  await expect(finished.getByRole('status')).toHaveText('No matching transcriptions.');
  await expect(titles).toHaveCount(0);
  await upload('roadmap.wav');
  await expect(titles).toHaveText(['roadmap.wav']);
  await search.clear();
  await expect(titles).toHaveText(['roadmap.wav', 'interview.wav']);

  await page.reload();
  await page.getByRole('button', { name: 'Transcriptions', exact: true }).click();
  await expect(titles).toHaveCount(2);
  await search.fill('CAFÉ migr');
  await expect(titles).toHaveText(['interview.wav']);
  await search.fill('roadmap');
  await expect(titles).toHaveText(['roadmap.wav']);
  await page.getByRole('tab', { name: 'Streaming', exact: true }).click();
  await expect(page.getByRole('searchbox')).toHaveCount(0);
  await expect(preview(page)).toBeVisible();
  await page.getByRole('tab', { name: 'Finished', exact: true }).click();
  await expect(search).toHaveValue('roadmap');
  await expect(titles).toHaveText(['roadmap.wav']);
});

test.describe('Dutch regional settings with English interface', () => {
  test.use({ locale: 'nl-NL' });

  test('transcription durations and segment timestamps use regional formatting', async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('streaik.language', 'en'));
    await page.route('**/gateway/api/transcriptions', route => route.fulfill({ json: {
      text: 'Timed transcript', durationInSeconds: 1234.2,
      segments: [{ text: 'Timed transcript', startSecond: 1233.5, endSecond: 1234 }],
    } }));
    await openTranscriptions(page);
    const composer = page.getByRole('form', { name: 'Transcription composer' });
    await composer.locator('input[type=file]').setInputFiles(file);
    await composer.getByRole('button', { name: 'Send', exact: true }).click();
    const card = page.getByRole('tabpanel', { name: 'Finished' }).getByRole('article');
    await expect(card).toContainText('1.234 s');
    await card.getByText('Segments', { exact: true }).click();
    await expect(card.getByText('1.233,5–1.234,0 s', { exact: true })).toBeVisible();
  });
});

test('the icon-only Stop button cancels a file transcription and keeps the audio queued', async ({ page }) => {
  await page.addInitScript(() => {
    const original = window.fetch.bind(window);
    window.fetch = (input, init) => {
      if (!String(input).endsWith('/gateway/api/transcriptions')) return original(input, init);
      const { dataset } = document.documentElement;
      const signal = init?.signal;
      dataset.transcriptionUpload = 'pending';
      return new Promise<Response>((_, reject) => {
        signal?.addEventListener('abort', () => {
          dataset.transcriptionUpload = 'aborted';
          reject(signal.reason);
        }, { once: true });
      });
    };
  });
  await openTranscriptions(page);
  const composer = page.getByRole('form', { name: 'Transcription composer' });
  const send = composer.getByRole('button', { name: 'Send', exact: true });
  const stopUpload = composer.getByRole('button', { name: 'Stop', exact: true });
  await composer.locator('input[type=file]').setInputFiles(file);
  await send.click();
  await expect(page.locator('html')).toHaveAttribute('data-transcription-upload', 'pending');
  await expect(stopUpload).toHaveText('');
  await expect(stopUpload.locator('svg.lucide-square')).toBeVisible();
  await page.mouse.move(0, 0); // Leave the Send/Stop slot before hovering the new control.
  await stopUpload.hover();
  await expect(page.getByRole('tooltip', { name: 'Stop', exact: true })).toBeVisible();
  await stopUpload.click();
  await expect(page.locator('html')).toHaveAttribute('data-transcription-upload', 'aborted');
  await expect(send).toBeEnabled();
  await expect(composer.getByRole('list', { name: 'Audio attachments' })).toContainText(file.name);
  await expect(composer.getByRole('alert')).toHaveCount(0);
});

async function mockAudio(page: Page) {
  await page.addInitScript(() => {
    const active = new AudioContext();
    const output = active.createMediaStreamDestination();
    const oscillator = active.createOscillator(); oscillator.connect(output); oscillator.start();
    Object.defineProperty(navigator.mediaDevices, 'getUserMedia', { value: async () => {
      if (document.documentElement.dataset.denyMic) throw new DOMException('Denied', 'NotAllowedError');
      await active.resume();
      const stream = output.stream.clone();
      document.documentElement.dataset.track = 'active';
      for (const track of stream.getTracks()) {
        const stop = track.stop.bind(track);
        track.stop = () => { stop(); document.documentElement.dataset.track = 'stopped'; };
      }
      return stream;
    } });
  });
}

test('OpenAI microphone uses only the ephemeral secret, saves confirmed turns and releases capture', async ({ page }) => {
  await mockAudio(page);
  await page.addInitScript(() => {
    class Events extends EventTarget {
      readyState = 'connecting';
      close() { this.readyState = 'closed'; }
      send() {}
    }
    class Peer extends EventTarget {
      channel = new Events();
      createDataChannel() { return this.channel; }
      addTrack() {}
      async createOffer() { return { sdp: 'fixture-offer' }; }
      async setLocalDescription() {}
      async setRemoteDescription() {
        this.channel.readyState = 'open';
        window.addEventListener('fixture-openai', event => this.channel.dispatchEvent(new MessageEvent('message', {
          data: JSON.stringify((event as CustomEvent).detail),
        })));
      }
      close() { document.documentElement.dataset.peer = 'closed'; }
    }
    Object.defineProperty(window, 'RTCPeerConnection', { value: Peer });
  });
  let expired = false;
  let secretRequests = 0;
  await page.route('**/gateway/v1/realtime/client_secrets', async route => {
    secretRequests++;
    expect(await route.request().headerValue('x-openai-key')).toBe('fixture-provider-key');
    expect(route.request().postDataJSON()).toMatchObject({ session: { type: 'transcription', audio: { input: { transcription: { model: liveModel } } } } });
    await route.fulfill({ json: { value: 'test-ephemeral-secret', expires_at: expired ? 1 : Math.floor(Date.now() / 1000) + 60 } });
  });
  await page.route('https://api.openai.com/v1/realtime/calls', async route => {
    const headers = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'authorization, content-type', 'access-control-allow-methods': 'POST, OPTIONS' };
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
    expect(await route.request().headerValue('authorization')).toBe('Bearer test-ephemeral-secret');
    expect(await route.request().headerValue('x-openai-key')).toBeNull();
    expect(route.request().postData()).toBe('fixture-offer');
    return route.fulfill({ contentType: 'application/sdp', headers, body: 'fixture-answer' });
  });
  await openTranscriptions(page);
  await expect(start(page)).toBeDisabled();
  await chooseModel(page, liveModel);
  await start(page).click();
  await expect(page.getByText('Listening…', { exact: true })).toBeVisible();
  async function event(type: string, fields: Record<string, string>) {
    await page.evaluate(detail => window.dispatchEvent(new CustomEvent('fixture-openai', { detail })), { type, ...fields });
  }
  await event('conversation.item.input_audio_transcription.delta', { item_id: 'one', delta: 'Draft words' });
  await expect(preview(page)).toContainText('Draft words');
  await event('conversation.item.input_audio_transcription.completed', { item_id: 'one', transcript: 'Confirmed words' });
  await expectIconOnly(stop(page));
  await stop(page).click();
  await expect(page.locator('html')).toHaveAttribute('data-track', 'stopped');
  await expect(page.locator('html')).toHaveAttribute('data-peer', 'closed');
  await page.getByRole('tab', { name: 'Finished', exact: true }).click();
  await expect(page.getByRole('article').filter({ hasText: 'Confirmed words' })).toHaveCount(1);

  expired = true;
  await start(page).click();
  await expect(page.getByRole('alert')).toContainText('credential expired');
  await expect(page.locator('html')).toHaveAttribute('data-track', 'stopped');
  await page.evaluate(() => { document.documentElement.dataset.denyMic = 'true'; });
  await start(page).click();
  await expect(page.getByRole('alert')).toContainText('Allow microphone access');
  expect(secretRequests).toBe(2);
});

test('Gladia consumes the gateway session URL, streams PCM and drains the final transcript on stop', async ({ page }) => {
  await mockAudio(page);
  await page.route('**/gateway/api/realtime/token/gladia/solaria-1', async route => {
    expect(await route.request().headerValue('x-gladia-key')).toBe('fixture-provider-key');
    expect(route.request().postDataJSON()).toMatchObject({ sessionConfig: { providerOptions: { gladia: { sample_rate: 16000, channels: 1, bit_depth: 16 } } } });
    await route.fulfill({ json: { url: 'wss://api.gladia.io/v2/live?token=fixture-ephemeral', token: 'fixture-session' } });
  });
  let pcm = false, closeSocket: (() => void) | undefined;
  await page.routeWebSocket('wss://api.gladia.io/v2/live?token=fixture-ephemeral', socket => {
    closeSocket = () => socket.close({ code: 1011 });
    let previewSent = false;
    socket.onMessage(body => {
      if (typeof body !== 'string') {
        pcm = true;
        if (!previewSent) socket.send(JSON.stringify({ type: 'transcript', data: { is_final: false, utterance: { text: 'Gladia draft' } } }));
        previewSent = true;
      } else if (JSON.parse(body).type === 'stop_recording') {
        socket.send(JSON.stringify({ type: 'transcript', data: { is_final: true, utterance: { text: 'Gladia final', start: 0, end: 1, speaker: 0 } } }));
        socket.send(JSON.stringify({ type: 'post_final_transcript' }));
      }
    });
  });
  await openTranscriptions(page, 'Gladia');
  await chooseModel(page, 'gladia/solaria-1');
  await start(page).click();
  await expect(preview(page)).toContainText('Gladia draft');
  expect(pcm).toBe(true);
  await stop(page).click();
  await expect(preview(page)).toContainText('Gladia final');
  await expect(page.locator('html')).toHaveAttribute('data-track', 'stopped');
  await page.getByRole('tab', { name: 'Finished', exact: true }).click();
  await expect(page.getByRole('article').filter({ hasText: 'Gladia final' })).toHaveCount(1);
  await start(page).click();
  await expect(page.getByText('Listening…', { exact: true })).toBeVisible();
  closeSocket?.();
  await expect(page.getByRole('alert')).toContainText('Gladia microphone transcription disconnected');
  await expect(page.locator('html')).toHaveAttribute('data-track', 'stopped');
  await start(page).click();
  await expect(page.getByText('Listening…', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Images', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-track', 'stopped');
});

for (const [model, languageOptions] of [
  ['openai/gpt-live-transcribe', { languages: ['nl'] }],
  ['openai/gpt-realtime-whisper', { language: 'nl' }],
] as const) test(`${model} stays enabled with no file model and uses ephemeral WebSocket transcription`, async ({ page }) => {
  await mockAudio(page);
  await page.route('**/gateway/v1/realtime/client_secrets', async route => {
    expect(route.request().postDataJSON()).toEqual({ session: { type: 'transcription', audio: { input: {
      format: { type: 'audio/pcm', rate: 24000 }, transcription: { model, ...languageOptions }, turn_detection: null,
    } } } });
    await route.fulfill({ json: { value: 'test-ephemeral-secret', expires_at: Math.floor(Date.now() / 1000) + 60 } });
  });
  let frames = 0;
  await page.routeWebSocket('wss://api.openai.com/v1/realtime?intent=transcription', socket => {
    socket.onMessage(raw => {
      const message = JSON.parse(String(raw));
      if (message.type === 'input_audio_buffer.append') {
        expect(Buffer.from(message.audio, 'base64').length).toBeGreaterThan(0);
        if (++frames === 1) socket.send(JSON.stringify({ type: 'conversation.item.input_audio_transcription.delta', item_id: 'live1', delta: 'Preview before stop' }));
      } else if (message.type === 'input_audio_buffer.commit') {
        socket.send(JSON.stringify({ type: 'input_audio_buffer.committed', item_id: 'live1' }));
        socket.send(JSON.stringify({ type: 'conversation.item.input_audio_transcription.completed', item_id: 'live1', transcript: 'Final live transcript' }));
      }
    });
  });
    await openTranscriptions(page, 'OpenAI', [{ id: model, type: 'transcription', tags: ['realtime'] }]);
    await chooseModel(page, model);
    await expect(start(page)).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Dictate', exact: true })).toBeDisabled();
  await expect(page.getByText('Dictate needs a file transcription model.')).toBeVisible();
  const dialog = await transcriptionSettings(page);
  await expect(dialog.getByLabel('Real-time model')).toHaveCount(0);
  await dialog.getByLabel('Language', { exact: true }).fill('nl');
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  // Wrap Playwright's routed WebSocket after its init script has installed it.
  await page.evaluate(() => {
    const RoutedWebSocket = window.WebSocket;
    window.WebSocket = class extends RoutedWebSocket {
      constructor(url: string | URL, protocols?: string | string[]) {
        super(url, protocols);
        if (String(url).startsWith('wss://api.openai.com')) {
          document.documentElement.dataset.micAuth = JSON.stringify(protocols) === JSON.stringify(['realtime', 'openai-insecure-api-key.test-ephemeral-secret']) ? 'ephemeral' : 'invalid';
        }
      }
    };
  });
  await start(page).click();
  await expect(page.locator('html')).toHaveAttribute('data-mic-auth', 'ephemeral');
  await expect(preview(page)).toContainText('Preview before stop');
  await stop(page).click();
  await expect(page.locator('html')).toHaveAttribute('data-track', 'stopped');
  await expect(preview(page)).toContainText('Final live transcript');
  await page.getByRole('tab', { name: 'Finished', exact: true }).click();
  await expect(page.getByRole('article').filter({ hasText: 'Final live transcript' })).toHaveCount(1);
});

test('Google Live Transcribe waits for setup, streams PCM, and saves only finalized microphone input', async ({ page }) => {
  await mockAudio(page);
  const setup = { model: 'models/gemini-3.5-transcribe-live', generationConfig: { responseModalities: ['TEXT'] },
    inputAudioTranscription: { languageCodes: ['nl-NL'], customVocabulary: ['Streaik', 'Gemini'], mode: 'SMART' } };
  const token = 'auth_tokens/temporary-google-token';
  await page.route(`**/gateway/api/realtime/token/${googleModel}`, async route => {
    expect(await route.request().headerValue('x-google-key')).toBe('fixture-provider-key');
    expect(route.request().postDataJSON()).toEqual({ sessionConfig: { providerOptions: { google: { uses: 1, bidiGenerateContentSetup: setup } } } });
    await route.fulfill({ json: { token, url: googleSocket, expiresAt: Math.floor(Date.now() / 1000) + 60 } });
  });
  let acknowledge: (() => void) | undefined, frames = 0, ended = false, closed = false;
  await page.routeWebSocket(`${googleSocket}?access_token=${encodeURIComponent(token)}`, socket => {
    socket.onClose(() => { closed = true; });
    const send = (serverContent: object) => socket.send(JSON.stringify({ serverContent }));
    socket.onMessage(raw => {
      const message = JSON.parse(String(raw));
      if (message.setup) {
        expect(message.setup).toEqual(setup);
        acknowledge = () => socket.send(Buffer.from('{"setupComplete":{}}'));
      } else if (message.realtimeInput?.audio) {
        expect(message.realtimeInput.audio.mimeType).toBe('audio/pcm;rate=16000');
        expect(Buffer.from(message.realtimeInput.audio.data, 'base64').length).toBeGreaterThan(0);
        if (++frames === 1) {
          send({ inputTranscription: { text: 'Eerste zin.' } });
          send({ interimInputTranscription: { text: 'Concept' }, outputTranscription: { text: 'Not the microphone' },
            modelTurn: { parts: [{ text: 'Not a transcript' }] } });
        }
      } else if (message.realtimeInput?.audioStreamEnd) {
        ended = true;
        send({ turnComplete: true }); // Google can deliver the final input transcript after this event.
        send({ inputTranscription: { text: 'Tweede zin.' } });
      } else throw new Error('Unexpected message in transcription-only session.');
    });
  });
  await openTranscriptions(page, 'Google Gemini', [
    { id: 'google/gemini-2.5-flash-native-audio-preview', type: 'audio', tags: ['realtime'] },
    { id: googleModel, type: 'transcription', tags: ['realtime'] },
  ]);
  await chooseModel(page, googleModel);
  await expect(start(page)).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Dictate', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Transcription settings' }).click();
  await page.getByLabel('Language codes').fill('nl-NL');
  await page.getByLabel('Custom vocabulary').fill('Streaik, Gemini');
  await page.getByLabel('Transcription mode').selectOption('SMART');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await start(page).click();
  await expect.poll(() => !!acknowledge).toBe(true);
  await expect(page.getByText('Connecting microphone…', { exact: true })).toBeVisible();
  expect(frames).toBe(0);
  acknowledge?.();
  await expect(preview(page)).toContainText('Eerste zin. Concept');
  await expect(preview(page)).not.toContainText('Not the microphone');
  await stop(page).click();
  await expect(page.locator('html')).toHaveAttribute('data-track', 'stopped');
  await expect(preview(page)).toContainText('Eerste zin. Tweede zin.');
  await expect.poll(() => ended && closed).toBe(true);
  await page.getByRole('tab', { name: 'Finished', exact: true }).click();
  await expect(page.getByRole('tabpanel', { name: 'Finished' }).getByText('Eerste zin. Tweede zin.', { exact: true })).toBeVisible();
});

test('Google Live Transcribe rejects untrusted socket targets, cleans up on cancel, and retains confirmed text on disconnect', async ({ page }) => {
  await mockAudio(page);
  let valid = false;
  const token = 'auth_tokens/cancel-test';
  await page.route(`**/gateway/api/realtime/token/${googleModel}`, route => route.fulfill({ json: {
    token, expiresAt: Math.floor(Date.now() / 1000) + 60, url: valid ? googleSocket : `${googleSocket}?unexpected=true`,
  } }));
  let sockets = 0, closed = false;
  await page.routeWebSocket(`${googleSocket}**`, socket => {
    sockets++;
    socket.onClose(() => { closed = true; });
    if (sockets === 1) return; // Leave the first setup pending so the user can cancel it.
    socket.onMessage(raw => {
      const message = JSON.parse(String(raw));
      if (message.setup) socket.send(JSON.stringify({ setupComplete: {} }));
      if (!message.realtimeInput?.audio) return;
      socket.send(JSON.stringify({ serverContent: { inputTranscription: { text: 'Confirmed before disconnect' },
        interimInputTranscription: { text: 'Unconfirmed before disconnect' } } }));
      socket.close({ code: 1011 });
    });
  });
  await openTranscriptions(page, 'Google Gemini', [{ id: googleModel, type: 'transcription', tags: ['realtime'] }]);
  await chooseModel(page, googleModel);
  await start(page).click();
  await expect(page.getByRole('alert')).toContainText('did not return a valid microphone session credential');
  await expect(page.locator('html')).toHaveAttribute('data-track', 'stopped');
  expect(sockets).toBe(0);

  valid = true;
  await start(page).click();
  await expect.poll(() => sockets).toBe(1);
  await stop(page).click();
  await expect(page.locator('html')).toHaveAttribute('data-track', 'stopped');
  await expect.poll(() => closed).toBe(true);
  await expect(start(page)).toBeEnabled();
  await expect(page.getByRole('alert')).toHaveCount(0);

  await start(page).click();
  await expect(page.getByRole('alert')).toContainText('Google microphone transcription disconnected');
  await expect(page.locator('html')).toHaveAttribute('data-track', 'stopped');
  await page.getByRole('tab', { name: 'Finished', exact: true }).click();
  const finished = page.getByRole('tabpanel', { name: 'Finished' });
  await expect(finished.getByText('Confirmed before disconnect', { exact: true })).toBeVisible();
  await expect(finished).not.toContainText('Unconfirmed before disconnect');
});

async function watchRecordedAudio(page: Page) {
  await page.addInitScript(() => {
    const start = MediaRecorder.prototype.start;
    MediaRecorder.prototype.start = function (timeslice?: number) {
      delete document.documentElement.dataset.audioRecorded;
      this.addEventListener('dataavailable', event => {
        if (event.data.size) document.documentElement.dataset.audioRecorded = 'yes';
      });
      return start.call(this, timeslice);
    };
  });
}

test('Dictate warns, records only on confirmation, submits on Stop, and keeps a failed recording for retry', async ({ page }) => {
  await mockAudio(page);
  await watchRecordedAudio(page);
  let uploads = 0;
  await page.route('**/gateway/api/transcriptions', async route => {
    expect(await route.request().headerValue('x-openai-key')).toBe('fixture-provider-key');
    const request = route.request().postDataJSON();
    expect(request.model).toBe(batchModel);
    expect(request.mediaType).toMatch(/^audio\/(webm|mp4|ogg)$/);
    expect(Buffer.from(request.audio, 'base64').length).toBeGreaterThan(0);
    if (++uploads === 1) return route.fulfill({ status: 502 });
    await route.fulfill({ json: { text: 'Finished dictation' } });
  });
  await openTranscriptions(page);
  await chooseRoute(page, '/api/transcriptions/stream');
  const dictate = page.getByRole('button', { name: 'Dictate', exact: true });
  const warning = page.getByRole('dialog', { name: 'Dictate is for short messages' });
  await dictate.click();
  await expect(warning).toBeVisible();
  await warning.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(warning).not.toBeVisible();
  await expect(page.locator('html')).not.toHaveAttribute('data-track', 'active');
  expect(uploads).toBe(0);

  await dictate.click();
  await warning.getByLabel('Do not show again').check();
  await warning.getByRole('button', { name: 'Continue recording' }).click();
  await expect(page.getByText('Recording dictation…', { exact: true })).toBeVisible();
  await expect(start(page)).toBeDisabled();
  await expect(page.locator('html')).toHaveAttribute('data-audio-recorded', 'yes');
  expect(uploads).toBe(0);
  await page.getByRole('button', { name: 'Stop Dictate' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-track', 'stopped');
  await expect(page.getByRole('list', { name: 'Audio attachments' }).getByRole('alert')).toBeVisible();
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(page.getByRole('tabpanel', { name: 'Finished' }).getByText('Finished dictation', { exact: true })).toBeVisible();
  expect(uploads).toBe(2);

  await page.getByRole('button', { name: 'Images', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Images', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Transcriptions', exact: true }).click();
  await page.evaluate(() => { document.documentElement.dataset.denyMic = 'true'; });
  await dictate.click();
  await expect(warning).not.toBeVisible();
  await expect(page.getByRole('alert')).toContainText('Allow microphone access');
  expect(uploads).toBe(2);

  await page.evaluate(() => { delete document.documentElement.dataset.denyMic; });
  await dictate.click();
  await expect(page.getByText('Recording dictation…', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Images', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-track', 'stopped');
  expect(uploads).toBe(2);
});
