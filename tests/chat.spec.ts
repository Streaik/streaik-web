import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import type { TokenRates } from '@streaik/gateway';
import { readFileSync } from 'node:fs';
import { BlobWriter, TextReader, ZipWriter } from '@zip.js/zip.js';
import { faviconEndpoint, iconResponse, openAiFavicon } from './icon-fixtures';

const directory = JSON.parse(readFileSync(new URL('../packages/chat/src/provider-directory.json', import.meta.url), 'utf8')) as {
  providers: { id: string; country?: string; regions?: string[]; tokenPricing?: Partial<Record<string, TokenRates>> }[];
};

const model = 'openai/gpt-4.1-mini';
const fakeKey = 'test-openai-key';
const passphrase = 'a test-only passphrase';

test.beforeEach(async ({ page }) => {
  await page.route(faviconEndpoint, route => route.fulfill(iconResponse));
  page.on('pageerror', (error) => console.error(error.stack ?? error.message));
  page.on('response', (response) => {
    if (response.status() >= 400 && !response.url().includes('/gateway/')) console.error(response.status(), response.url());
  });
});

async function showSettings(page: Page, tab?: string) {
  await page.getByRole('button', { name: 'Account menu', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Settings', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Settings' });
  await expect(dialog).toBeVisible();
  if (tab) await dialog.getByRole('tab', { name: tab, exact: true }).click();
  return dialog;
}
async function closeSettings(page: Page) { await page.getByRole('button', { name: 'Close', exact: true }).click(); }
async function enableChatMetrics(page: Page) {
  const settings = await showSettings(page, 'Chat');
  await settings.getByRole('switch', { name: 'Show metrics', exact: true }).check();
  await closeSettings(page);
}
const railMore = (page: Page) => page.getByRole('button', { name: 'More pages', exact: true });
const pagesMenu = (page: Page) => page.getByRole('menu', { name: 'More pages', exact: true });
async function openCatalog(page: Page, name: 'Models' | 'Providers') {
  await railMore(page).click();
  await pagesMenu(page).getByRole('menuitem', { name, exact: true }).click();
}
async function showChatSkills(page: Page) {
  await page.getByRole('button', { name: 'Chat settings', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Chat settings', exact: true });
  await dialog.getByRole('tab', { name: 'Skills', exact: true }).click();
  return dialog;
}
const modelPicker = (page: Page) => page.getByRole('button', { name: 'Model', exact: true });
async function chooseModel(page: Page, name: string) {
  const picker = modelPicker(page);
  await expect(picker).toBeEnabled();
  if (await picker.textContent() !== name) {
    await picker.click();
    await page.getByRole('option', { name, exact: true }).click();
    const search = page.getByRole('searchbox', { name: 'Search models', exact: true });
    if (await search.isVisible()) await search.press('Escape');
  }
  await expect(picker).toHaveText(name);
}
const chooseChatModel = (page: Page) => chooseModel(page, 'gpt-4.1-mini');
async function addKey(page: Page, provider = 'OpenAI', key = fakeKey) {
  await page.getByRole('tab', { name: 'API keys', exact: true }).click();
  const panel = page.getByRole('tabpanel', { name: 'API keys', exact: true });
  await panel.getByRole('button', { name: 'Add API key', exact: true }).click();
  await panel.getByLabel('Provider', { exact: true }).selectOption({ label: provider });
  await panel.getByLabel(`${provider} API key`, { exact: true }).fill(key);
  await panel.getByRole('button', { name: `Save ${provider} key`, exact: true }).click();
  await expect(panel.getByRole('status')).toHaveText('Provider key saved.');
  await expect(panel.getByLabel(`${provider} API key`, { exact: true })).toHaveCount(0);
}

async function mockModels(page: Page) {
  await page.route('**/gateway/v1/models', async (route) => {
    expect(await route.request().headerValue('x-openai-key')).toBe(fakeKey);
    await route.fulfill({ json: { data: [{ id: model }, { id: 'imagerouter/a/b', type: 'image' }] } });
  });
}

test('OpenAI voice uses the existing model picker, composer slot, and conversation', async ({ page }) => {
  const realtime = 'openai/gpt-realtime', live = 'openai/gpt-live-1';
  await page.addInitScript(() => {
    const probe = { sent: [] as Record<string, unknown>[], captures: 0, stops: 0, deliver: (_event: object) => {} };
    Object.defineProperty(window, 'voiceProbe', { value: probe });
    Object.defineProperty(navigator.mediaDevices, 'getUserMedia', { value: async () => {
      probe.captures++;
      const track = { enabled: true, stop() { probe.stops++; } };
      return { getTracks: () => [track], getAudioTracks: () => [track] };
    } });
    class Channel {
      readyState = 'connecting';
      bufferedAmount = 0;
      onopen?: () => void;
      onmessage?: (ev: { data: string }) => void;
      constructor() { probe.deliver = event => this.onmessage?.({ data: JSON.stringify(event) }); }
      send(value: string) {
        const event = JSON.parse(value);
        probe.sent.push(event);
        if (event.type === 'session.close') setTimeout(() => probe.deliver({ type: 'session.closed' }), 0);
      }
      close() { this.readyState = 'closed'; }
    }
    class Peer {
      channel = new Channel();
      localDescription?: { sdp: string };
      createDataChannel() { return this.channel; }
      addTrack() {}
      async createOffer() { return { sdp: 'fixture-offer' }; }
      async setLocalDescription(offer: { sdp: string }) { this.localDescription = offer; }
      async setRemoteDescription() { this.channel.readyState = 'open'; this.channel.onopen?.(); }
      close() {}
    }
    Object.defineProperty(window, 'RTCPeerConnection', { value: Peer });
  });
  await page.route('**/gateway/v1/models', route => route.fulfill({ json: { data: [{ id: model },
    { id: realtime, type: 'audio', tags: ['realtime'] }, { id: live, type: 'audio', tags: ['realtime'] },
    { id: 'openai/gpt-live-transcribe', type: 'transcription', tags: ['realtime'] }] } }));
  await page.route('**/gateway/api/chat', route => route.fulfill({ contentType: 'text/event-stream',
    headers: { 'x-vercel-ai-ui-message-stream': 'v1' }, body: sse('Earlier text reply', 1) }));
  await page.route(`**/gateway/api/realtime/session/${realtime}`, route => {
    expect(route.request().postDataJSON()).toMatchObject({ sdp: 'fixture-offer', sessionConfig: { providerOptions: { openai: {
      audio: { output: { voice: 'cedar' } },
    } } } });
    return route.fulfill({ json: { sessionId: 'fixture', sdp: 'fixture-answer' } });
  });
  await page.route('**/gateway/v1/live/sessions', route => {
    expect(route.request().postDataJSON()).toMatchObject({ session: { model: live, store: false, delegation: {
      type: 'responses', responses: { model: 'gpt-4.1-mini', parallel_tool_calls: false, tools: expect.arrayContaining([
        { type: 'web_search' }, { type: 'code_interpreter', container: { type: 'auto' } },
        { type: 'file_search', vector_store_ids: ['vs_fixture'] },
      ]) },
    } }, transport: { type: 'webrtc', sdp: 'fixture-offer' } });
    expect(JSON.stringify(route.request().postDataJSON().session.input)).toContain('Earlier text reply');
    return route.fulfill({ json: { session: { id: 'fixture' }, transport: { type: 'webrtc', sdp: 'fixture-answer' } } });
  });
  type Probe = { sent: object[]; captures: number; stops: number; deliver: (event: object) => void };
  const checkProbe = () => page.evaluate(() => {
    const { sent, captures, stops } = (window as unknown as { voiceProbe: Probe }).voiceProbe;
    return { sent, captures, stops };
  });
  const deliver = (...events: object[]) => page.evaluate((events: object[]) => {
    const probe = (window as unknown as { voiceProbe: Probe }).voiceProbe;
    for (const event of events) probe.deliver(event);
  }, events);
  await page.goto('/');
  await showSettings(page); await addKey(page); await closeSettings(page);
  await chooseChatModel(page);
  const chatDialog = page.getByRole('dialog', { name: 'Chat settings', exact: true });
  const openChatSettings = () => page.getByRole('button', { name: 'Chat settings', exact: true }).click();
  const openAiTab = chatDialog.getByRole('tab', { name: 'OpenAI', exact: true });
  const openAiPanel = chatDialog.getByRole('tabpanel', { name: 'OpenAI', exact: true });
  async function checkTextSettings() {
    await openChatSettings();
    await expect(openAiTab).toHaveCount(1);
    await expect(chatDialog.getByRole('tab', { name: 'OpenAI Realtime', exact: true })).toHaveCount(0);
    await openAiTab.click();
    await expect(chatDialog.getByRole('button', { name: 'Reset provider settings', exact: true })).toBeVisible();
    await expect(openAiPanel.getByRole('heading', { name: /^GPT (Live|Realtime)$/ })).toHaveCount(0);
    await chatDialog.getByRole('button', { name: 'Close chat settings', exact: true }).click();
  }
  await checkTextSettings();
  const send = page.getByRole('button', { name: 'Send', exact: true });
  await expect(send.locator('svg')).toHaveCSS('width', '18px');
  await expect(send.locator('svg')).toHaveCSS('height', '18px');
  const composer = page.getByRole('textbox', { name: 'Message', exact: true });
  await composer.fill('Earlier user message'); await composer.press('Enter');
  await expect(page.getByText('Earlier text reply', { exact: true }).first()).toBeVisible();
  const voiceStart = page.getByRole('button', { name: 'Start voice session', exact: true });
  const voiceStop = page.getByRole('button', { name: 'Stop voice session', exact: true });
  await modelPicker(page).click();
  await expect(page.getByRole('option', { name: 'gpt-live-transcribe', exact: true })).toHaveCount(0);
  await page.getByRole('option', { name: 'gpt-realtime', exact: true }).click();
  await expect(voiceStart).toBeVisible();
  await expect(voiceStart.locator('svg')).toHaveCSS('width', '18px');
  await expect(voiceStart.locator('svg')).toHaveCSS('height', '18px');
  expect((await checkProbe()).captures).toBe(0);
  await openChatSettings();
  await openAiTab.click();
  await expect(openAiPanel.getByRole('heading', { name: 'GPT Realtime', exact: true })).toBeVisible();
  await expect(openAiPanel.getByRole('heading', { name: 'GPT Live', exact: true })).toHaveCount(0);
  await openAiPanel.getByRole('combobox', { name: 'Voice', exact: true }).selectOption('cedar');
  await chatDialog.getByRole('button', { name: 'Save', exact: true }).click();
  await voiceStart.click(); await expect(voiceStop).toBeVisible();
  expect(JSON.stringify((await checkProbe()).sent)).toContain('Earlier user message');
  await deliver({ type: 'input_audio_buffer.committed', item_id: 'u' },
    { type: 'conversation.item.input_audio_transcription.completed', item_id: 'u', transcript: 'Voice question' },
    { type: 'response.output_audio_transcript.done', response_id: 'r', transcript: 'Realtime voice reply' });
  await expect(page.getByText('Realtime voice reply', { exact: true })).toBeVisible();
  await voiceStop.click(); await expect(voiceStart).toBeVisible();
  await chooseModel(page, 'gpt-live-1');
  await openChatSettings();
  await openAiTab.click();
  await expect(openAiPanel.getByRole('heading', { name: 'GPT Live', exact: true })).toBeVisible();
  await expect(openAiPanel.getByRole('heading', { name: 'GPT Realtime', exact: true })).toHaveCount(0);
  await openAiPanel.getByLabel('Responses model', { exact: true }).fill(model);
  const parallel = openAiPanel.getByRole('switch', { name: 'Parallel backend tool calls', exact: true });
  await expect(parallel).toBeChecked();
  await expect(parallel).toHaveCSS('appearance', 'none');
  await expect(parallel.locator('..')).toHaveCSS('display', 'flex');
  await parallel.uncheck();
  for (const name of ['Web search', 'Code interpreter', 'File search']) {
    const tool = openAiPanel.getByRole('switch', { name, exact: true });
    await expect(tool).toHaveCSS('appearance', 'none');
    await tool.check();
  }
  await openAiPanel.getByLabel('Vector store IDs (comma-separated)', { exact: true }).fill('vs_fixture');
  await chatDialog.getByRole('button', { name: 'Save', exact: true }).click();
  await voiceStart.click(); await expect(voiceStop).toBeVisible();
  await deliver({ type: 'session.output_transcript.delta', delta: 'Live voice reply' });
  await expect(page.getByText('Live voice reply', { exact: true })).toBeVisible();
  await voiceStop.click(); await expect(voiceStart).toBeVisible();
  await chooseChatModel(page);
  await expect(send).toBeVisible();
  await checkTextSettings();
  await expect(page.getByText('Voice question', { exact: true })).toBeVisible();
  await expect(page.getByText('Live voice reply', { exact: true })).toBeVisible();
  expect((await checkProbe()).stops).toBeGreaterThanOrEqual(2);
});

test('Gemini Live and Grok Voice switch in the same composer and save portable turns', async ({ page }) => {
  const google = 'google/gemini-2.5-flash-native-audio-preview';
  const xai = 'xai/grok-voice-latest';
  const googleUrl = 'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContentConstrained';
  const xaiUrl = 'wss://api.x.ai/v1/realtime?model=grok-voice-latest';
  const received = { googleAudio: false, xaiAudio: false, geminiHistoryInGrok: false };
  await page.addInitScript(() => {
    Object.defineProperty(navigator.mediaDevices, 'getUserMedia', { value: async () => {
      const context = new AudioContext();
      const destination = context.createMediaStreamDestination();
      const oscillator = context.createOscillator();
      oscillator.connect(destination);
      oscillator.start();
      await context.resume();
      const track = destination.stream.getAudioTracks()[0];
      const stop = track.stop.bind(track);
      track.stop = () => { stop(); oscillator.stop(); void context.close(); };
      return destination.stream;
    } });
  });
  await page.route('**/gateway/v1/models', route => route.fulfill({ json: { data: [{ id: model },
    { id: google, type: 'audio', tags: ['realtime'] }, { id: xai, type: 'audio', tags: ['realtime'] },
    { id: 'google/gemini-3.5-transcribe-live', type: 'transcription', tags: ['realtime'] },
  ] } }));
  await page.route(`**/gateway/api/realtime/token/${google}`, route => {
    expect(route.request().headers()['x-google-key']).toBe('test-google-key');
    expect(route.request().headers()['x-openai-key']).toBeUndefined();
    expect(route.request().postDataJSON().sessionConfig.providerOptions).toMatchObject({ google: { bidiGenerateContentSetup: {
      model: 'models/gemini-2.5-flash-native-audio-preview', generationConfig: { responseModalities: ['AUDIO'],
        speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Puck' } } } },
      inputAudioTranscription: {}, outputAudioTranscription: {},
    } } });
    return route.fulfill({ json: { url: googleUrl, token: 'auth_tokens/temporary' } });
  });
  await page.route(`**/gateway/api/realtime/token/${xai}`, route => {
    expect(route.request().headers()['x-xai-key']).toBe('test-xai-key');
    expect(route.request().headers()['x-google-key']).toBeUndefined();
    expect(route.request().postDataJSON()).toEqual({ sessionConfig: { providerOptions: { xai: { expires_after: { anchor: 'created_at', seconds: 60 } } } } });
    return route.fulfill({ json: { url: xaiUrl, token: 'temporary-xai' } });
  });
  await page.routeWebSocket(`${googleUrl}*`, socket => {
    const send = (data: object) => socket.send(JSON.stringify(data));
    socket.onMessage(data => {
      const message = JSON.parse(String(data));
      if (message.setup) send({ setupComplete: {} });
      if (message.realtimeInput?.audio && !received.googleAudio) {
        received.googleAudio = typeof message.realtimeInput.audio.data === 'string' && message.realtimeInput.audio.mimeType === 'audio/pcm;rate=16000';
        send({ serverContent: { inputTranscription: { text: 'Gemini question' }, outputTranscription: { text: 'Gemini answer' }, turnComplete: true } });
      }
      if (message.realtimeInput?.audioStreamEnd) send({ serverContent: { turnComplete: true } });
    });
  });
  await page.routeWebSocket(url => url.origin === 'wss://api.x.ai' && url.pathname === '/v1/realtime', socket => {
    const send = (data: object) => socket.send(JSON.stringify(data));
    socket.onMessage(data => {
      const message = JSON.parse(String(data));
      if (message.type === 'session.update') {
        expect(message.session.voice).toBe('rex');
        send({ type: 'session.updated' });
      }
      if (message.type === 'conversation.item.create' && message.item.role === 'assistant' && message.item.content[0]?.text === 'Gemini answer')
        received.geminiHistoryInGrok = true;
      if (message.type === 'input_audio_buffer.append' && !received.xaiAudio) {
        received.xaiAudio = typeof message.audio === 'string' && message.audio.length > 0;
        send({ type: 'input_audio_buffer.committed', item_id: 'grok-input' });
        send({ type: 'conversation.item.input_audio_transcription.completed', item_id: 'grok-input', transcript: 'Grok question' });
        send({ type: 'response.created', response: { id: 'grok-output' } });
        send({ type: 'response.output_audio_transcript.done', transcript: 'Grok answer' });
        send({ type: 'response.done', response: { id: 'grok-output', status: 'completed' } });
      }
    });
  });
  await page.goto('/');
  await showSettings(page);
  await addKey(page);
  await addKey(page, 'Google Gemini', 'test-google-key');
  await addKey(page, 'xAI', 'test-xai-key');
  await closeSettings(page);
  await modelPicker(page).click();
  await expect(page.getByRole('option', { name: 'gemini-3.5-transcribe-live', exact: true })).toHaveCount(0);
  await page.getByRole('option', { name: 'gemini-2.5-flash-native-audio-preview', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Chat settings', exact: true });
  const settings = () => page.getByRole('button', { name: 'Chat settings', exact: true }).click();
  const start = page.getByRole('button', { name: 'Start voice session', exact: true });
  const stop = page.getByRole('button', { name: 'Stop voice session', exact: true });
  await settings();
  await expect(dialog.getByRole('tab', { name: 'xAI', exact: true })).toHaveCount(0);
  await dialog.getByRole('tab', { name: 'Google', exact: true }).click();
  await dialog.getByRole('combobox', { name: 'Voice', exact: true }).selectOption('Puck');
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  await start.click(); await expect(stop).toBeVisible();
  await expect(page.getByText('Gemini answer', { exact: true })).toBeVisible();
  await stop.click(); await expect(start).toBeVisible();
  await chooseModel(page, 'grok-voice-latest');
  await settings();
  await expect(dialog.getByRole('tab', { name: 'Google', exact: true })).toHaveCount(0);
  await dialog.getByRole('tab', { name: 'xAI', exact: true }).click();
  await dialog.getByRole('combobox', { name: 'Voice', exact: true }).selectOption('rex');
  await dialog.getByRole('spinbutton', { name: 'Token TTL seconds', exact: true }).fill('60');
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  await start.click(); await expect(stop).toBeVisible();
  await expect(page.getByText('Grok answer', { exact: true })).toBeVisible();
  await stop.click(); await expect(start).toBeVisible();
  expect(received).toEqual({ googleAudio: true, xaiAudio: true, geminiHistoryInGrok: true });
  await page.reload();
  await expect(page.getByText('Gemini question', { exact: true })).toBeVisible();
  await expect(page.getByText('Grok answer', { exact: true })).toBeVisible();
  await chooseChatModel(page);
  await expect(page.getByRole('button', { name: 'Send', exact: true })).toBeVisible();
  await settings();
  await expect(dialog.getByRole('tab', { name: 'Google', exact: true })).toHaveCount(0);
  await expect(dialog.getByRole('tab', { name: 'xAI', exact: true })).toHaveCount(0);
});

for (const action of ['accept', 'decline', 'cancel'] as const) {
  test(`Echo asks for provider input and continues with ${action}`, async ({ page }) => {
    const echo = 'echo/echo-input-required';
    const toolCallId = 'call_echo_input_test';
    const input = { mode: 'form', message: 'What should I echo?', requestedSchema: {
      type: 'object', properties: { message: { type: 'string', title: 'Echo message' } }, required: ['message'],
    } };
    const requests: { model: string; messages: { parts: Record<string, unknown>[] }[] }[] = [];
    await page.route('**/gateway/v1/models', route => route.fulfill({ json: { data: [{ id: echo, name: 'Echo Input Required', type: 'language' }] } }));
    await page.route('**/gateway/v1/skills?*', route => route.fulfill({ json: { data: [], has_more: false } }));
    await page.route('**/gateway/api/chat', async route => {
      requests.push(route.request().postDataJSON());
      expect(await route.request().headerValue('x-echo-key')).toBeNull();
      const events = [
        { type: 'start', messageId: 'echo-form-reply' }, { type: 'start-step' },
        { type: 'tool-input-available', toolCallId, toolName: 'ai_input_required', input, dynamic: true, providerExecuted: false },
        { type: 'tool-approval-request', toolCallId, approvalId: 'echo-review', signature: 'fixture-signature' },
        { type: 'finish-step' }, { type: 'finish', finishReason: 'tool-calls' },
      ];
      return route.fulfill({ contentType: 'text/event-stream', headers: { 'x-vercel-ai-ui-message-stream': 'v1' },
        body: requests.length === 1 ? events.map(event => `data: ${JSON.stringify(event)}\n\n`).join('') + 'data: [DONE]\n\n'
          : sse(`Echo continued: ${action}`, requests.length, echo) });
    });
    await page.goto('/');
    // The BYOK sample gates chat on its vault setup; the Echo provider itself has no key.
    await showSettings(page); await addKey(page); await closeSettings(page);
    await chooseModel(page, 'Echo Input Required');
    const composer = page.getByRole('textbox', { name: 'Message', exact: true });
    await composer.fill('Ask for input'); await composer.press('Enter');
    const form = page.getByRole('dialog', { name: 'Elicitation' });
    await expect(form.getByText('What should I echo?')).toBeVisible();
    await form.getByRole('textbox', { name: 'Echo message' }).fill('round trip');
    if (action === 'cancel') await form.press('Escape');
    else await form.getByRole('button', { name: action === 'accept' ? 'Accept' : 'Decline', exact: true }).click();
    await expect(page.getByText(`Echo continued: ${action}`)).toBeVisible();
    expect(requests).toHaveLength(2);
    expect(requests[1].model).toBe(echo);
    expect(requests[1].messages.flatMap(message => message.parts).find(part => part.toolCallId === toolCallId)).toMatchObject({
      toolName: 'ai_input_required', input, state: 'output-available', approval: { id: 'echo-review', signature: 'fixture-signature', approved: true },
      output: action === 'accept' ? { action, content: { message: 'round trip' } } : { action },
    });
    if (action !== 'accept') expect(JSON.stringify(requests[1])).not.toContain('round trip');
    await composer.fill('Start a new turn'); await composer.press('Enter');
    await expect.poll(() => requests.length).toBe(3);
    expect(JSON.stringify(requests[2])).not.toContain(toolCallId);
  });
}

test('chat tool configuration sends namespaced options and defaults leave the tools attached', async ({ page }) => {
  await mockModels(page);
  const requests: Record<string, unknown>[] = [];
  await page.route('**/gateway/api/chat', route => {
    requests.push(route.request().postDataJSON());
    return route.fulfill({ contentType: 'text/event-stream', headers: { 'x-vercel-ai-ui-message-stream': 'v1' },
      body: sse(`Tool configuration reply ${requests.length}`, requests.length) });
  });
  await page.goto('/');
  await showSettings(page); await addKey(page); await closeSettings(page);
  await chooseChatModel(page);
  const settings = page.getByRole('dialog', { name: 'Chat settings', exact: true });
  const open = () => page.getByRole('button', { name: 'Chat settings', exact: true }).click();
  const tab = () => settings.getByRole('tab', { name: 'Tool configuration', exact: true }).click();
  await open();
  await settings.getByRole('tab', { name: 'Tools', exact: true }).click();
  await settings.getByRole('switch', { name: 'Artificial Intelligence', exact: true }).check();
  await tab();
  const panel = settings.getByRole('tabpanel', { name: 'Tool configuration' });
  await panel.getByRole('switch', { name: 'Use namespaces' }).check();
  await panel.locator('summary[aria-label="Usage method for All tools"]').click();
  await panel.getByRole('checkbox', { name: 'Programmatic', exact: true }).check();
  await panel.getByRole('switch', { name: 'Search for local_ai_models_search', exact: true }).check();
  await settings.getByRole('button', { name: 'Close', exact: true }).click();
  const composer = page.getByRole('textbox', { name: 'Message', exact: true });
  await composer.fill('Send configured tools'); await composer.press('Enter');
  await expect(page.getByText('Tool configuration reply 1')).toBeVisible();
  expect(requests[0]).toMatchObject({ providerMetadata: { openai: { tools: [
    { type: 'namespace', name: 'local', tools: expect.arrayContaining([
      expect.objectContaining({ name: 'local_ai_models_search', allowed_callers: ['programmatic'], defer_loading: true }),
      expect.objectContaining({ name: 'local_ai_providers_list', allowed_callers: ['programmatic'] }),
    ]) },
  ] } } });
  expect(requests[0]).not.toHaveProperty('clientToolResultApproval');
  expect(requests[0]).not.toHaveProperty('tools');
  await open(); await tab();
  await settings.getByRole('button', { name: 'Defaults', exact: true }).click();
  await expect(panel.getByRole('switch', { name: 'Use namespaces' })).not.toBeChecked();
  await expect(panel.getByRole('switch', { name: 'Search for local_ai_models_search', exact: true })).not.toBeChecked();
  await settings.getByRole('button', { name: 'Close', exact: true }).click();
  await composer.fill('Send default tools'); await composer.press('Enter');
  await expect(page.getByText('Tool configuration reply 2')).toBeVisible();
  expect(requests[1].tools).toContainEqual(expect.objectContaining({ name: 'local_ai_models_search' }));
  expect(JSON.stringify(requests[1].tools)).not.toMatch(/allowed_callers|defer_loading/);
});

for (const policy of ['unlimited', 'maximum', 'stop tool'] as const) {
  test(`browser tool batches retain approvals and respect the ${policy} setting`, async ({ page }) => {
    await mockModels(page);
    const toolName = 'local_ai_models_search';
    const callCount = policy === 'unlimited' ? 9 : 2;
    const requests: { toolChoice?: string; messages: { parts: Record<string, unknown>[] }[] }[] = [];
    await page.route('**/gateway/api/chat', route => {
      requests.push(route.request().postDataJSON());
      const events = [
        { type: 'start', messageId: 'tool-policy-reply' }, { type: 'start-step' },
        ...Array.from({ length: callCount }, (_, index) => [
          { type: 'tool-input-available', toolCallId: `call-${index}`, toolName, input: { query: 'gpt' }, dynamic: true },
          { type: 'tool-approval-request', toolCallId: `call-${index}`, approvalId: `approval-${index}`, signature: `signature-${index}` },
        ]).flat(),
        { type: 'finish-step' }, { type: 'finish', finishReason: 'tool-calls' },
      ];
      return route.fulfill({ contentType: 'text/event-stream', headers: { 'x-vercel-ai-ui-message-stream': 'v1' },
        body: requests.length === 1 ? events.map(event => `data: ${JSON.stringify(event)}\n\n`).join('') + 'data: [DONE]\n\n'
          : sse('Tool batch complete.', requests.length) });
    });
    await page.goto('/');
    await showSettings(page); await addKey(page); await closeSettings(page);
    await chooseChatModel(page);
    const settings = page.getByRole('dialog', { name: 'Chat settings', exact: true });
    const open = () => page.getByRole('button', { name: 'Chat settings', exact: true }).click();
    await open();
    await settings.getByRole('tab', { name: 'Tools', exact: true }).click();
    await settings.getByRole('switch', { name: 'Artificial Intelligence', exact: true }).check();
    await settings.getByRole('tab', { name: 'General', exact: true }).click();
    const maximum = settings.getByRole('spinbutton', { name: 'Maximum tool calls', exact: true });
    const stopTools = settings.getByRole('button', { name: 'Tools that end the turn', exact: true });
    await expect(maximum).toHaveValue('');
    if (policy === 'maximum') await maximum.fill('1');
    if (policy === 'stop tool') {
      await stopTools.click();
      await settings.getByRole('option', { name: toolName, exact: true }).click();
      await settings.getByRole('searchbox', { name: 'Search tools', exact: true }).press('Escape');
    }
    if (policy !== 'unlimited') {
      const choice = settings.getByRole('combobox', { name: 'Tool choice', exact: true });
      if (await choice.evaluate(node => node instanceof HTMLSelectElement)) await choice.selectOption('required');
      else {
        await choice.click();
        await page.getByRole('option', { name: 'Required', exact: true }).click();
      }
    }
    await settings.getByRole('button', { name: 'Close', exact: true }).click();
    const composer = page.getByRole('textbox', { name: 'Message', exact: true });
    await composer.fill('Look up the model catalog.'); await composer.press('Enter');
    const approval = page.getByRole('dialog', { name: 'Review tool result', exact: true })
      .getByRole('button', { name: 'Approve and share', exact: true });
    for (let index = 0; index < callCount; index++) await approval.click();
    await expect(page.getByText('Tool batch complete.', { exact: true })).toBeVisible();
    expect(requests.map(request => request.toolChoice)).toEqual(policy === 'unlimited' ? [undefined, undefined] : ['required', 'none']);
    const results = requests[1].messages.at(-1)?.parts.filter(part => part.type === 'dynamic-tool');
    expect(results).toHaveLength(callCount);
    for (let index = 0; index < callCount; index++) {
      expect(results).toContainEqual(expect.objectContaining({ toolCallId: `call-${index}`, state: 'output-available',
        approval: { id: `approval-${index}`, signature: `signature-${index}`, approved: true } }));
    }
    if (policy !== 'unlimited') {
      await open();
      await settings.getByRole('button', { name: 'Defaults', exact: true }).click();
      await expect(maximum).toHaveValue('');
      await expect(stopTools).toBeDisabled();
      await settings.getByRole('button', { name: 'Close', exact: true }).click();
      await composer.fill('Use defaults next turn.'); await composer.press('Enter');
      await expect.poll(() => requests.length).toBe(3);
      expect(requests[2]).not.toHaveProperty('toolChoice');
    }
  });
}

test('app agent defaults select only available models, and transcription clearing survives reload', async ({ page }) => {
  const alternatives = [{ id: model }, { id: 'openai/gpt-image-1', type: 'image' },
    { id: 'openai/other-video', type: 'video' }, { id: 'openai/gpt-4o-transcribe', type: 'transcription' }];
  const defaults = [{ id: 'openai/gpt-6.2-sol' }, { id: 'openai/gpt-6.1-terra' },
    { id: 'openai/gpt-image-2.6-flare', type: 'image' }, { id: 'openai/gpt-image-2.6-sunburst', type: 'image' },
    { id: 'openai/gemini-omni-1.2-flash', type: 'video' }, { id: 'openai/gpt-transcribe', type: 'transcription' }];
  let available = false;
  await page.route('**/gateway/v1/models', route => route.fulfill({ json: { data: available ? [...alternatives, ...defaults] : alternatives } }));
  await page.route('**/gateway/v1/skills?*', route => route.fulfill({ json: { data: [], has_more: false } }));
  const connect = async () => { await showSettings(page); await addKey(page); await closeSettings(page); };
  await page.goto('/');
  await connect();
  const picker = modelPicker(page);
  await expect(picker).toHaveText('Select models');
  for (const [view, placeholder] of [['Images', 'Select models'], ['Videos', 'Select a model'], ['Transcriptions', 'Select a model']]) {
    await page.getByRole('button', { name: view, exact: true }).click();
    await expect(picker).toBeEnabled();
    await expect(picker).toHaveText(placeholder);
  }
  available = true;
  await page.goto('/');
  await connect();
  await expect(picker).toHaveText('gpt-6.1-terra, gpt-6.2-sol');
  await openRoute(page, 'Decisions');
  await page.getByRole('menuitemradio', { name: 'Off', exact: true }).click();
  await expect(picker).toHaveText('gpt-6.1-terra');
  await chooseChatModel(page);
  await page.getByRole('button', { name: 'New chat', exact: true }).click();
  await expect(picker).toHaveText('gpt-6.1-terra');
  await page.getByRole('button', { name: 'Images', exact: true }).click();
  await expect(picker).toHaveText('gpt-image-2.6-sunburst');
  await page.getByRole('button', { name: 'Videos', exact: true }).click();
  await expect(picker).toHaveText('gemini-omni-1.2-flash');
  await chooseModel(page, 'other-video');
  await page.getByRole('button', { name: 'Transcriptions', exact: true }).click();
  await expect(picker).toHaveText('gpt-transcribe');
  await chooseModel(page, 'gpt-4o-transcribe');
  await picker.click();
  await page.getByRole('option', { name: 'gpt-4o-transcribe', exact: true }).click();
  await expect(picker).toHaveText('Select a model');
  const transcription = page.getByRole('form', { name: 'Transcription composer' });
  for (const name of ['Send', 'Dictate', 'Real-time']) {
    await expect(transcription.getByRole('button', { name, exact: true })).toBeDisabled();
  }
  await expect(page.getByText('The selected model does not support file transcription on this route.')).toHaveCount(0);
  await expect(page.getByText('Dictate needs a file transcription model.')).toHaveCount(0);
  await page.reload();
  await connect();
  await expect(picker).toBeEnabled();
  await expect(picker).toHaveText('Select a model');
});

test('edited chat agent instructions are visible and sent as system context after a model override', async ({ page }) => {
  const instructions = 'Keep replies brief.\nEnd with a summary.';
  await page.addInitScript(({ instructions, model }) => {
    const scope = JSON.stringify([new URL('/gateway/api/chat', location.href).href, 'byok']);
    const key = `streaik.agents.v1:${scope}`;
    if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify({ version: 1, assignments: {}, local: [],
      overrides: [{ id: 'chat', definition: { name: 'ChatAgent', description: 'Chat', instructions, model: { id: model } } }] }));
  }, { instructions, model });
  const alternate = 'openai/gpt-5-nano';
  await page.route('**/gateway/v1/models', route => route.fulfill({ json: { data: [{ id: model }, { id: alternate }] } }));
  await page.route('**/gateway/v1/skills?*', route => route.fulfill({ json: { data: [], has_more: false } }));
  let replies = 0;
  await page.route('**/gateway/api/chat', async route => {
    const body = route.request().postDataJSON();
    expect(body.model).toBe(replies ? alternate : model);
    expect(body.messages[0]).toMatchObject({ role: 'system', parts: expect.arrayContaining([{ type: 'text', text: instructions }]) });
    expect(body.messages.slice(1).every(({ role }: { role: string }) => role !== 'system')).toBe(true);
    await route.fulfill({ contentType: 'text/event-stream', headers: { 'x-vercel-ai-ui-message-stream': 'v1' },
      body: sse(`Instruction reply ${++replies}`, replies, body.model) });
  });
  await page.goto('/');
  await showSettings(page); await addKey(page); await closeSettings(page);
  await expect(modelPicker(page)).toHaveText('gpt-4.1-mini');
  const composer = page.getByRole('textbox', { name: 'Message', exact: true });
  await composer.fill('First turn'); await composer.press('Enter');
  await expect(page.getByText('Instruction reply 1', { exact: true })).toBeVisible();

  await modelPicker(page).click();
  await page.getByRole('option', { name: 'gpt-4.1-mini', exact: true }).click();
  await page.getByRole('option', { name: 'gpt-5-nano', exact: true }).click();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'View context', exact: true }).click();
  const context = page.getByRole('dialog', { name: 'Context', exact: true });
  await expect(context.getByRole('tabpanel', { name: 'System', exact: true }).getByText(instructions, { exact: true })).toBeVisible();
  await context.getByRole('button', { name: 'Close', exact: true }).click();
  await composer.fill('Continue with an override'); await composer.press('Enter');
  await expect(page.getByText('Instruction reply 2', { exact: true })).toBeVisible();
  await page.reload();
  await showSettings(page); await addKey(page); await closeSettings(page);
  await expect(modelPicker(page)).toHaveText('gpt-5-nano');
});

test('page URLs support direct loads, reload, and Back and Forward without losing the draft', async ({ page }) => {
  await page.goto('/');
  const composer = page.getByRole('textbox', { name: 'Message', exact: true });
  await composer.fill('An unsent draft');
  await openCatalog(page, 'Providers');
  await expect(page).toHaveURL(/\/providers$/);
  await openCatalog(page, 'Models');
  await expect(page).toHaveURL(/\/models$/);
  await openCatalog(page, 'Models');
  await page.getByRole('button', { name: 'Images', exact: true }).click();
  await expect(page).toHaveURL(/\/images$/);

  for (const view of ['models', 'providers', 'chat']) {
    await page.goBack();
    await expect(page.locator('.chat-shell')).toHaveAttribute('data-view', view);
  }
  await expect(composer).toHaveValue('An unsent draft');
  await page.goForward();
  await expect(page).toHaveURL(/\/providers$/);
  await page.reload();
  await expect(page.locator('.chat-shell')).toHaveAttribute('data-view', 'providers');

  for (const view of ['models', 'images', 'videos', 'transcriptions', 'agents', 'skills']) {
    const response = await page.goto(`/${view}`);
    expect(response?.status()).toBe(200);
    await expect(page.locator('.chat-shell')).toHaveAttribute('data-view', view);
  }
  await page.goto('http://localhost:15174/providers');
  await expect(page.locator('.chat-shell')).toHaveAttribute('data-view', 'providers');
  await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible();
  await page.goto('http://localhost:15174/c/locked');
  await expect(page.getByText('This conversation is not available in this browser or profile.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible();
  await expect(page).toHaveURL(/\/c\/locked$/);
});

test('conversation URLs survive reload, switch through browser history, and stay profile-local', async ({ page, browser }) => {
  await mockModels(page);
  let release!: () => void;
  const firstReply = new Promise<void>(resolve => { release = resolve; });
  let calls = 0;
  await page.route('**/gateway/api/chat', async route => {
    const current = ++calls;
    if (current === 1) await firstReply;
    const events = [
      { type: 'start', messageId: `route-reply-${current}` },
      { type: 'text-start', id: 't' },
      { type: 'text-delta', id: 't', delta: `Route reply ${current}` },
      { type: 'text-end', id: 't' },
      { type: 'finish', finishReason: 'stop' },
    ];
    await route.fulfill({ headers: { 'content-type': 'text/event-stream', 'x-vercel-ai-ui-message-stream': 'v1' },
      body: events.map(event => `data: ${JSON.stringify(event)}\n\n`).join('') + 'data: [DONE]\n\n' });
  });
  await page.goto('/');
  await showSettings(page); await addKey(page); await closeSettings(page);
  await chooseChatModel(page);
  const composer = page.getByRole('textbox', { name: 'Message', exact: true });
  await composer.fill('First linked conversation');
  await composer.press('Enter');
  const conversationUrl = /\/c\/[0-9a-f-]{36}$/;
  await expect(page).toHaveURL(conversationUrl);
  const first = page.url();
  const toggleHistory = page.getByRole('button', { name: 'Toggle navigation' });
  await toggleHistory.click();
  await page.getByRole('button', { name: 'Search chats', exact: true }).click();
  const historySearch = page.getByRole('dialog', { name: 'Search chats' });
  const historyQuery = historySearch.getByRole('searchbox');
  await historyQuery.fill('First linked');
  await expect(historySearch.getByRole('button', { name: 'First linked conversation', exact: true })).toBeDisabled();
  await historyQuery.press('Enter');
  await expect(historySearch).toBeVisible();
  await historyQuery.press('Escape');
  await expect(historySearch).not.toBeVisible();
  await toggleHistory.click();
  await page.getByRole('button', { name: 'Images', exact: true }).click();
  await expect(page).toHaveURL(/\/images$/);
  release();
  await page.goBack();
  await expect(page).toHaveURL(first);
  await expect(page.getByText('Route reply 1')).toBeVisible();

  const newChat = page.getByRole('button', { name: 'New chat', exact: true });
  await newChat.click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByText('Route reply 1')).toHaveCount(0);
  await chooseChatModel(page);
  await composer.fill('Second linked conversation');
  await composer.press('Enter');
  await expect(page.getByText('Route reply 2')).toBeVisible();
  await expect(page).toHaveURL(conversationUrl);
  const second = page.url();
  expect(second).not.toBe(first);
  await page.goBack();
  await expect(page).toHaveURL(first);
  await expect(page.getByText('First linked conversation')).toBeVisible();
  await page.goForward();
  await expect(page).toHaveURL(second);
  await expect(page.getByText('Second linked conversation')).toBeVisible();

  const response = await page.goto(first);
  expect(response?.status()).toBe(200);
  await expect(page.getByText('First linked conversation')).toBeVisible();
  await expect(page.getByText('Second linked conversation')).toHaveCount(0);
  await page.reload();
  await expect(page.getByText('First linked conversation')).toBeVisible();

  const isolated = await browser.newPage();
  try {
    await isolated.goto(first);
    await expect(isolated.getByText('This conversation is not available in this browser or profile.')).toBeVisible();
    await expect(isolated.getByText('First linked conversation')).toHaveCount(0);
    await expect(isolated).toHaveURL(first);
  } finally { await isolated.close(); }

  await page.goto('/');
  await expect(page).toHaveURL(second);
  await expect(page.getByText('Route reply 2')).toBeVisible();
  await page.goto(first);
  await page.getByRole('button', { name: 'Toggle navigation' }).click();
  await page.getByRole('button', { name: 'Second linked conversation', exact: true }).click();
  await expect(page).toHaveURL(second);
  await expect(page.getByText('Route reply 2')).toBeVisible();
  const more = page.getByRole('button', { name: 'More actions for Second linked conversation' });
  await more.press('ArrowDown');
  await page.getByRole('menuitem', { name: 'Delete', exact: true }).press('Enter');
  await expect(page).toHaveURL(/\/$/);
  await expect(composer).toBeVisible();
  await expect(page.getByText('Second linked conversation')).toHaveCount(0);
  await page.goto(second);
  await expect(page.getByText('This conversation is not available in this browser or profile.')).toBeVisible();
});

test('local Skills tabs persist versions and chat progressively discloses approved instructions and resources', async ({ page }) => {
  const marker = 'Prefer a concise five-line digest.';
  const resource = 'List the team’s three accomplishments.';
  const description = 'Write a short digest from the user’s notes.';
  const requests: any[] = [];
  await mockModels(page);
  await page.route('**/gateway/v1/skills?*', route => route.fulfill({ json: { data: [], has_more: false } }));
  await page.route('**/gateway/api/chat', async route => {
    const body = route.request().postDataJSON(); requests.push(body);
    const [skillText, systemText, userText, instructions] = body.messages[0].parts.map(({ text }: { text: string }) => text);
    const [skills, system, user] = [skillText, systemText, userText].map(text => JSON.parse(text));
    expect(body.messages[0].role).toBe('system');
    expect(instructions).toBe('Chat');
    const skillId = skills.skills[0].skill_id;
    expect(skillId).toMatch(/^local:/);
    expect(skills).toEqual({ skills: [{ name: 'weekly-digest', skill_id: skillId, description }] });
    expect(system).toEqual({ systemInformation: { appName: expect.any(String), timezone: expect.any(String) } });
    expect(user).toEqual({ preferredLanguage: 'en', darkMode: expect.any(Boolean) });
    expect(body.tools.map((tool: { name: string }) => tool.name)).toEqual(['activate_skill', 'read_skill_resource']);
    expect(body).not.toHaveProperty('clientToolResultApproval');
    const number = requests.length;
    if (number === 1) expect(JSON.stringify(body)).not.toContain(marker);
    if (number === 2) {
      expect(JSON.stringify(body)).toContain(marker);
      expect(JSON.stringify(body)).not.toContain(resource);
    }
    if (number === 3) expect(JSON.stringify(body)).toContain(resource);
    const events: object[] = [{ type: 'start', messageId: 'skill-reply' }, { type: 'start-step' }];
    if (number <= 2) {
      const toolCallId = `skill-call-${number}`;
      events.push({ type: 'tool-input-available', toolCallId, toolName: number === 1 ? 'activate_skill' : 'read_skill_resource',
        input: { skill_id: skillId, ...(number === 2 && { path: 'references/guide.md' }) }, dynamic: true },
      { type: 'tool-approval-request', toolCallId, approvalId: `approval-${number}`, signature: `skill-signature-${number}` });
    } else events.push({ type: 'text-start', id: 'text' }, { type: 'text-delta', id: 'text', delta: 'Skill complete.' }, { type: 'text-end', id: 'text' });
    events.push({ type: 'finish-step' }, { type: 'finish', finishReason: number <= 2 ? 'tool-calls' : 'stop' });
    await route.fulfill({ headers: { 'content-type': 'text/event-stream', 'x-vercel-ai-ui-message-stream': 'v1' },
      body: events.map(event => `data: ${JSON.stringify(event)}\n\n`).join('') + 'data: [DONE]\n\n' });
  });
  await page.goto('/');
  await showSettings(page); await addKey(page); await closeSettings(page);
  await chooseChatModel(page);
  await page.getByRole('button', { name: 'Skills', exact: true }).click();
  await page.getByRole('button', { name: 'Add skill', exact: true }).click();
  await page.getByRole('menuitem', { name: 'New', exact: true }).click();
  const editor = page.getByRole('dialog', { name: 'Create skill' });
  await editor.getByLabel('Name', { exact: true }).fill('weekly-digest');
  await editor.getByLabel('Description', { exact: true }).fill(description);
  await editor.getByRole('tab', { name: 'SKILL.md' }).click();
  await editor.getByRole('textbox', { name: 'Instructions', exact: true }).fill(marker);
  await editor.getByRole('tab', { name: 'Files' }).click();
  await editor.getByLabel('Choose resource file').setInputFiles({ name: 'guide.md', mimeType: 'text/markdown', buffer: Buffer.from(resource) });
  await editor.getByLabel('Resource path').fill('references/guide.md');
  await editor.getByRole('button', { name: 'Add or replace file' }).click();
  await editor.getByRole('button', { name: 'Create', exact: true }).click();
  const card = page.getByRole('article', { name: 'weekly-digest' });
  await expect(card.getByRole('switch')).toHaveCount(0);
  const version = card.getByRole('img', { name: 'Version 1', exact: true });
  await expect(version).toHaveText('v1');
  await expect(version.locator('svg')).toBeVisible();
  await expect(card).toContainText(description);
  await expect(card).not.toContainText('Local skill');
  await card.getByRole('button', { name: 'Edit' }).click();
  const edit = page.getByRole('dialog', { name: 'Edit skill' });
  await edit.getByRole('tab', { name: 'SKILL.md' }).click();
  await edit.getByRole('textbox', { name: 'Instructions', exact: true }).fill('Second revision.');
  await edit.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(card.getByRole('img', { name: 'Version 2', exact: true })).toHaveText('v2');
  const localCardMenu = card.getByRole('button', { name: 'More actions for weekly-digest', exact: true });
  await expect(localCardMenu.locator('svg.lucide-ellipsis-vertical')).toBeVisible();
  await localCardMenu.click();
  await page.getByRole('menuitem', { name: 'Details', exact: true }).click();
  const details = page.getByRole('dialog', { name: 'weekly-digest' });
  await details.getByRole('tab', { name: 'Versions' }).click();
  await details.getByRole('combobox', { name: 'Version', exact: true }).selectOption('1');
  await details.getByRole('button', { name: 'Set as default' }).click();
  await details.getByRole('button', { name: 'Close' }).click();
  await expect(card).toContainText('v1');
  await page.getByRole('button', { name: 'New chat', exact: true }).click();
  await chooseChatModel(page);

  const settings = await showChatSkills(page);
  const toggle = settings.getByRole('switch', { name: 'weekly-digest', exact: true });
  await expect(toggle).toBeChecked();
  await toggle.uncheck();
  await settings.getByRole('button', { name: 'Close', exact: true }).click();
  const viewContext = page.getByRole('button', { name: 'View context', exact: true });
  const context = page.getByRole('dialog', { name: 'Context', exact: true });
  const system = context.getByRole('tabpanel', { name: 'System', exact: true });
  const skillsTab = context.getByRole('tab', { name: 'Skills', exact: true });
  await viewContext.click();
  await expect(skillsTab).toHaveCount(0);
  await expect(context.getByRole('tab', { name: 'Tools (0)', exact: true })).toBeVisible();
  await context.getByRole('button', { name: 'Close', exact: true }).click();

  await showChatSkills(page);
  await expect(toggle).not.toBeChecked();
  await toggle.check();
  await settings.getByRole('button', { name: 'Close', exact: true }).click();
  await viewContext.click();
  await expect(system.getByRole('heading', { name: 'System context', exact: true })).toBeVisible();
  await expect(system).not.toContainText('weekly-digest');
  await context.getByRole('tab', { name: 'System', exact: true }).press('End');
  await expect(skillsTab).toBeFocused();
  const skillPanel = context.getByRole('tabpanel', { name: 'Skills', exact: true });
  const skillCard = skillPanel.getByRole('article');
  await expect(skillCard.getByRole('heading')).toHaveText('weekly-digest');
  await expect(skillCard.locator('code')).toHaveText(/^local:/);
  const displayedSkillId = await skillCard.locator('code').textContent();
  await expect(skillCard.locator('p')).toHaveText(description);
  await expect(skillPanel).not.toContainText(/activationTool|activate_skill|read_skill_resource/);
  await expect(skillPanel).not.toContainText(marker);
  await context.getByRole('tab', { name: 'Tools (2)', exact: true }).click();
  await expect(context.getByRole('heading', { name: 'activate_skill', exact: true })).toBeVisible();
  await expect(context.getByRole('heading', { name: 'read_skill_resource', exact: true })).toBeVisible();
  await context.getByRole('button', { name: 'Close', exact: true }).click();

  const composer = page.getByRole('textbox', { name: 'Message', exact: true });
  await composer.fill('Please write a digest.'); await composer.press('Enter');
  const approve = page.getByRole('button', { name: 'Approve and share' });
  await expect(approve).toBeVisible(); expect(requests).toHaveLength(1);
  expect(JSON.parse(requests[0].messages[0].parts[0].text).skills[0].skill_id).toBe(displayedSkillId);
  await approve.click();
  await expect.poll(() => requests.length).toBe(2);
  await expect(approve).toBeVisible(); await approve.click();
  await expect(page.getByText('Skill complete.', { exact: true })).toBeVisible();
  expect(requests).toHaveLength(3);
  await page.reload();
  await showChatSkills(page);
  await expect(toggle).toBeChecked();
  await settings.getByRole('button', { name: 'Close', exact: true }).click();
  await page.getByRole('button', { name: 'Skills', exact: true }).click();
  await expect(card).toContainText('v1');
});

test('the Skills plus menu imports a ZIP without enabling the imported skill', async ({ page }) => {
  const zip = new ZipWriter(new BlobWriter('application/zip'));
  await zip.add('weekly-notes/SKILL.md', new TextReader('---\nname: weekly-notes\ndescription: Summarize weekly notes.\n---\n\n# Notes\n'), { useWebWorkers: false });
  const buffer = Buffer.from(await (await zip.close()).arrayBuffer());
  await page.goto('/');
  await page.getByRole('button', { name: 'Skills', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Import ZIP', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Add skill', exact: true }).press('Enter');
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('menuitem', { name: 'Import', exact: true }).click();
  await (await chooser).setFiles({ name: 'weekly-notes.zip', mimeType: 'application/zip', buffer });
  await expect(page.getByRole('article', { name: 'weekly-notes', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'New chat', exact: true }).click();
  const settings = await showChatSkills(page);
  await expect(settings.getByRole('switch', { name: 'weekly-notes', exact: true })).not.toBeChecked();
});

test('chat settings list and remember remote skills without downloading until the model activates one', async ({ page }) => {
  const id = 'openai/skill_digest';
  const name = 'provider-digest';
  const description = 'Prepare a project digest.';
  const instructions = 'Use short paragraphs for the project digest.';
  const resource = 'Group related milestones.';
  const path = 'references/guide.md';
  const zip = new ZipWriter(new BlobWriter('application/zip'));
  await zip.add(`${name}/SKILL.md`, new TextReader(`---\nname: ${name}\ndescription: ${description}\n---\n\n${instructions}`), { useWebWorkers: false });
  await zip.add(`${name}/${path}`, new TextReader(resource), { useWebWorkers: false });
  const zipBytes = Buffer.from(await (await zip.close()).arrayBuffer());

  const first = { id: 'openai/skill_other', name: 'other-skill', description: 'Unrelated instructions.' };
  const cursors: (string | null)[] = [];
  let downloads = 0, requests = 0;
  await mockModels(page);
  await page.route('**/gateway/v1/skills?*', route => {
    const after = new URL(route.request().url()).searchParams.get('after');
    cursors.push(after);
    if (cursors.length === 1) return route.fulfill({ status: 503, json: { error: 'Unavailable' } });
    return route.fulfill({ json: after ? { data: [{ id, name, description }], has_more: false }
      : { data: [first], has_more: true, last_id: first.id } });
  });
  await page.route(`**/gateway/v1/skills/${id}/content`, async route => {
    expect(requests).toBeGreaterThan(0);
    expect(await route.request().headerValue('x-openai-key')).toBe(fakeKey);
    downloads++;
    await route.fulfill({ contentType: 'application/zip', body: zipBytes });
  });
  await page.route('**/gateway/api/chat', async route => {
    const number = ++requests;
    const body = route.request().postDataJSON();
    const catalog = JSON.parse(body.messages[0].parts[0].text);
    expect(catalog).toEqual({ skills: [{ name, skill_id: id, description }] });
    expect(body.tools.map((tool: { name: string }) => tool.name)).toEqual(['activate_skill', 'read_skill_resource']);
    expect(body).not.toHaveProperty('clientToolResultApproval');
    const serialized = JSON.stringify(body);
    expect(downloads).toBe(number === 1 ? 0 : 1);
    if (number === 1) expect(serialized).not.toContain(instructions);
    else expect(serialized).toContain(instructions);
    if (number < 3) expect(serialized).not.toContain(resource);
    else expect(serialized).toContain(resource);
    const events: object[] = [{ type: 'start', messageId: 'remote-skill-reply' }, { type: 'start-step' }];
    if (number <= 2) {
      const toolCallId = `remote-skill-${number}`;
      events.push({ type: 'tool-input-available', toolCallId, toolName: number === 1 ? 'activate_skill' : 'read_skill_resource',
        input: { skill_id: id, ...(number === 2 && { path }) }, dynamic: true },
      { type: 'tool-approval-request', toolCallId, approvalId: `remote-approval-${number}` });
    } else events.push({ type: 'text-start', id: 'text' }, { type: 'text-delta', id: 'text', delta: 'Remote skill complete.' }, { type: 'text-end', id: 'text' });
    events.push({ type: 'finish-step' }, { type: 'finish', finishReason: number <= 2 ? 'tool-calls' : 'stop' });
    await route.fulfill({ headers: { 'content-type': 'text/event-stream', 'x-vercel-ai-ui-message-stream': 'v1' },
      body: events.map(event => `data: ${JSON.stringify(event)}\n\n`).join('') + 'data: [DONE]\n\n' });
  });

  await page.goto('/');
  await showSettings(page); await addKey(page); await closeSettings(page);
  await chooseChatModel(page);
  expect(cursors).toEqual([]);
  const settings = await showChatSkills(page);
  const remote = settings.getByRole('region', { name: 'Central', exact: true });
  await remote.getByRole('button', { name: 'Retry', exact: true }).click();
  const toggle = remote.getByRole('switch', { name, exact: true });
  await expect(toggle).not.toBeChecked();
  await expect(remote.getByRole('switch', { name: first.name, exact: true })).not.toBeChecked();
  expect(cursors).toEqual([null, null, first.id]);
  await toggle.check();
  await settings.getByRole('button', { name: 'Close', exact: true }).click();
  expect(downloads).toBe(0);

  await page.reload();
  // BYOK keys are session-only; the profile-scoped skill selections survive reconnecting.
  await showSettings(page); await addKey(page); await closeSettings(page);
  await chooseChatModel(page);
  await page.getByRole('button', { name: 'View context', exact: true }).click();
  const context = page.getByRole('dialog', { name: 'Context', exact: true });
  const skillsTab = context.getByRole('tab', { name: 'Skills', exact: true });
  await skillsTab.click();
  const cards = context.getByRole('tabpanel', { name: 'Skills', exact: true }).getByRole('article');
  await expect(cards).toHaveCount(1);
  await expect(cards.getByRole('heading')).toHaveText(name);
  await expect(cards.locator('code')).toHaveText(id);
  await expect(cards.locator('p')).toHaveText(description);
  await expect(cards).not.toContainText(instructions);
  await context.getByRole('button', { name: 'Close', exact: true }).click();
  expect(cursors).toEqual([null, null, first.id, null, first.id]);
  expect(downloads).toBe(0);

  const composer = page.getByRole('textbox', { name: 'Message', exact: true });
  await composer.fill('Prepare a digest.'); await composer.press('Enter');
  const approve = page.getByRole('button', { name: 'Approve and share' });
  await expect(approve).toBeVisible();
  expect(downloads).toBe(1);
  await approve.click();
  await expect.poll(() => requests).toBe(2);
  await approve.click();
  await expect(page.getByText('Remote skill complete.', { exact: true })).toBeVisible();
  expect(downloads).toBe(1);

  await showChatSkills(page);
  await expect(toggle).toBeChecked();
  await expect(settings.getByRole('region', { name: 'Local', exact: true }).getByRole('switch')).toHaveCount(0);
  await toggle.uncheck();
  await settings.getByRole('button', { name: 'Close', exact: true }).click();
  await page.getByRole('button', { name: 'View context', exact: true }).click();
  await expect(skillsTab).toHaveCount(0);
  await expect(context.getByRole('tab', { name: 'Tools (0)', exact: true })).toBeVisible();
  expect(downloads).toBe(1);
});

test('a pinned remote skill can be downloaded, saved locally, and uploaded using BYOK destination selection', async ({ page }) => {
  const skill = { id: 'openai/skill_source', name: 'meeting-brief', description: 'Write meeting briefs.',
    default_version: '2', latest_version: '2', created_at: 1 };
  const zip = new ZipWriter(new BlobWriter('application/zip'));
  await zip.add('meeting-brief/SKILL.md', new TextReader('---\nname: meeting-brief\ndescription: Write meeting briefs.\nmetadata:\n  author: Example team\n---\n\n# Brief\n'), { useWebWorkers: false });
  const zipBytes = Buffer.from(await (await zip.close()).arrayBuffer());
  await mockModels(page);
  let uploads = 0;
  const cursors: (string | null)[] = [];
  await page.route('**/gateway/v1/skills?*', route => {
    const after = new URL(route.request().url()).searchParams.get('after');
    cursors.push(after);
    return route.fulfill({ json: after ? {
      data: [{ ...skill, id: 'openai/skill_second', name: 'second-brief' }], has_more: false,
    } : { data: [skill], has_more: true, last_id: skill.id } });
  });
  await page.route('**/gateway/v1/skills/openai/skill_source/versions?*', route => route.fulfill({ json: {
    data: [{ id: 'v1', skill_id: skill.id, name: skill.name, description: skill.description, version: '1', created_at: 1 }], has_more: false,
  } }));
  await page.route('**/gateway/v1/skills/openai/skill_source/versions/1/content', route => route.fulfill({ contentType: 'application/zip', body: zipBytes }));
  await page.route('**/gateway/v1/skills/providers', route => route.fulfill({ json: { auth: 'provider-key', providers: ['openai'] } }));
  await page.route('**/gateway/v1/skills', async route => {
    expect(route.request().method()).toBe('POST');
    expect(await route.request().headerValue('x-openai-key')).toBe(fakeKey);
    expect(await route.request().headerValue('x-streaik-provider')).toBeNull();
    expect(route.request().postDataBuffer()?.includes('meeting-brief/SKILL.md')).toBe(true);
    uploads++;
    await route.fulfill({ json: { ...skill, id: 'openai/skill_uploaded' } });
  });
  await page.goto('/');
  await showSettings(page); await addKey(page); await closeSettings(page);
  await page.getByRole('button', { name: 'Skills', exact: true }).click();
  const search = page.getByRole('searchbox', { name: 'Search skills', exact: true });
  await expect(search).toHaveAttribute('placeholder', 'Search skills…');
  expect(await search.evaluate(input => Math.abs(input.getBoundingClientRect().width - input.parentElement!.getBoundingClientRect().width))).toBeLessThan(1);
  const central = page.getByRole('tab', { name: 'Central', exact: true });
  const local = page.getByRole('tab', { name: 'Local', exact: true });
  const centralPanel = page.getByRole('tabpanel', { name: 'Central', exact: true });
  const localPanel = page.getByRole('tabpanel', { name: 'Local', exact: true });
  await expect(local).toHaveAttribute('aria-selected', 'true');
  expect(cursors).toEqual([]);
  await central.click();
  const card = page.getByRole('article', { name: 'meeting-brief', exact: true });
  await expect(card).toBeVisible();
  expect(cursors).toEqual([null]);
  await expect(page.getByRole('button', { name: /^(Browse providers|Refresh)$/ })).toHaveCount(0);
  await search.fill('second openai');
  await expect(centralPanel.getByText('No matching skills.')).toBeVisible();
  expect(cursors).toEqual([null]);
  await page.getByRole('button', { name: 'Load more', exact: true }).click();
  await expect(page.getByRole('article', { name: 'second-brief', exact: true })).toBeVisible();
  await expect(card).toHaveCount(0);
  expect(cursors).toEqual([null, skill.id]);
  await search.clear();
  await expect(card.getByRole('button', { name: 'Details and download' })).toHaveCount(0);
  const providerCardMenu = card.getByRole('button', { name: 'More actions for meeting-brief', exact: true });
  await expect(providerCardMenu.locator('svg.lucide-ellipsis-vertical')).toBeVisible();
  await providerCardMenu.click();
  await page.getByRole('menuitem', { name: 'Details and download', exact: true }).click();
  const details = page.getByRole('dialog', { name: 'meeting-brief' });
  await details.getByRole('tab', { name: 'Versions' }).click();
  await details.getByRole('combobox', { name: 'Version', exact: true }).selectOption('1');
  const download = page.waitForEvent('download');
  await details.getByRole('button', { name: 'Download ZIP' }).click();
  expect((await download).suggestedFilename()).toBe('meeting-brief-1.zip');
  await details.getByRole('button', { name: 'Save locally' }).click();
  await expect(details).toBeHidden();
  await search.fill('source openai');
  await expect(card).toBeVisible();
  await local.click();
  await expect(localPanel.getByText('No matching skills.')).toBeVisible();
  await search.clear();
  await card.getByRole('button', { name: 'Edit', exact: true }).click();
  const edit = page.getByRole('dialog', { name: 'Edit skill', exact: true });
  await edit.getByRole('textbox', { name: 'Description', exact: true }).fill('Write concise meeting briefs.');
  await edit.getByRole('button', { name: 'Save', exact: true }).click();
  await search.fill('brief concise');
  await expect(card).toContainText('v2');
  await card.getByRole('button', { name: 'More actions for meeting-brief' }).click();
  await page.getByRole('menuitem', { name: 'Details', exact: true }).click();
  await details.getByRole('tab', { name: 'SKILL.md', exact: true }).click();
  await expect(details.getByRole('tabpanel', { name: 'SKILL.md', exact: true })).toContainText('metadata:\n  author: Example team');
  await details.getByRole('button', { name: 'Close', exact: true }).click();
  await card.getByRole('button', { name: 'More actions for meeting-brief' }).click();
  await page.getByRole('menuitem', { name: 'Upload to…' }).click();
  const upload = page.getByRole('dialog', { name: 'Upload skill' });
  await upload.getByRole('combobox', { name: 'Destination provider', exact: true }).selectOption('openai');
  await upload.getByRole('button', { name: 'Upload', exact: true }).click();
  await expect(page.getByText('Uploaded meeting-brief as openai/skill_uploaded.')).toBeVisible();
  expect(uploads).toBe(1);
  await page.getByRole('button', { name: 'New chat', exact: true }).click();
  const settings = await showChatSkills(page);
  await expect(settings.getByRole('region', { name: 'Local', exact: true }).getByRole('switch', { name: 'meeting-brief', exact: true })).not.toBeChecked();
  await settings.getByRole('button', { name: 'Close', exact: true }).click();
  await page.getByRole('button', { name: 'Skills', exact: true }).click();
  await central.click();
  await expect(centralPanel.getByText('openai/skill_uploaded', { exact: true })).toBeVisible();
  await expect(page.getByRole('article', { name: 'second-brief', exact: true })).toBeVisible();
  expect(cursors).toEqual([null, skill.id]);
});

test('above-composer spinner clears and a failed provider favicon leaves the full model ID', async ({ page }) => {
  await mockModels(page);
  await page.route(openAiFavicon, (route) => route.abort());
  const delay = Promise.withResolvers<void>();
  await page.route('**/gateway/api/chat', async (route) => {
    await delay.promise;
    const events = [{ type: 'start', messageId: 'timed-reply' }, { type: 'text-start', id: 'text' },
      { type: 'text-delta', id: 'text', delta: 'Here is the reply.' }, { type: 'text-end', id: 'text' }, { type: 'finish', finishReason: 'stop' }];
    await route.fulfill({ headers: { 'content-type': 'text/event-stream', 'x-vercel-ai-ui-message-stream': 'v1' },
      body: events.map(event => `data: ${JSON.stringify(event)}\n\n`).join('') + 'data: [DONE]\n\n' });
  });
  await page.goto('/');
  await showSettings(page); await addKey(page); await closeSettings(page);
  await chooseChatModel(page);
  const composer = page.getByRole('textbox', { name: 'Message', exact: true });
  const progress = page.locator('.chat-progress');
  await composer.fill('When will you respond?');
  await composer.press('Enter');
  try {
    await expect(progress).toHaveText('Assistant is responding…');
    await expect(progress).toHaveCSS('justify-content', 'center');
    await expect(progress.locator('.chat-spinner')).toBeVisible();
    const bounds = await progress.boundingBox();
    expect(bounds!.y + bounds!.height).toBeLessThanOrEqual((await composer.boundingBox())!.y);
  } finally { delay.resolve(); }
  const reply = page.getByRole('article', { name: 'Assistant', exact: true });
  await expect(reply.getByText('Here is the reply.')).toBeVisible();
  await expect(reply.locator('.chat-provider-logo')).toHaveCount(0);
  await expect(reply.locator('.chat-speaker')).toHaveText(model);
  await expect(reply.locator('time')).toHaveText('Just now');
  await expect(progress).toBeEmpty();
});

test('tooltips follow the theme without changing trigger names or modal layering', async ({ page }) => {
  await page.goto('/');
  const navigation = page.getByRole('button', { name: 'Toggle navigation', exact: true });
  const tooltip = page.getByRole('tooltip', { name: 'Show chat history', exact: true });
  await navigation.hover();
  await expect(tooltip).toBeVisible();
  await expect(navigation).toHaveAccessibleName('Toggle navigation');
  await expect(navigation).not.toHaveAttribute('title', /./);

  for (const theme of ['fluent', 'html']) {
    const dialog = await showSettings(page, 'Theme');
    const panel = dialog.getByRole('tabpanel', { name: 'Theme', exact: true });
    await panel.getByRole('combobox', { name: 'Theme', exact: true }).selectOption(theme);
    await expect(panel.getByRole('group', { name: `${theme === 'fluent' ? 'Fluent' : 'HTML'} settings` })).toBeVisible();
    const close = dialog.getByRole('button', { name: 'Close', exact: true });
    await close.hover();
    if (theme === 'fluent') {
      await expect(dialog.getByRole('tooltip', { name: 'Close', exact: true })).toBeVisible();
      await expect(close).not.toHaveAttribute('title', /./);
    } else {
      await expect(close).toHaveAttribute('title', 'Close');
      await expect(dialog.getByRole('tooltip')).toHaveCount(0);
    }
    await closeSettings(page);
    if (theme === 'fluent') {
      await page.mouse.move(300, 300);
      // Switch Fluent to keyboard modality before moving focus to the trigger.
      await page.keyboard.press('Tab');
      await navigation.focus();
      await expect(tooltip).toBeVisible();
      await expect(navigation).toHaveAccessibleName('Toggle navigation');
    } else await expect(navigation).toHaveAttribute('title', 'Show chat history');
  }
});

test('shadcn restores modal trigger focus without reopening its tooltip', async ({ page }) => {
  await page.goto('/');
  const trigger = page.getByRole('button', { name: 'Chat settings', exact: true });
  const hint = page.getByRole('tooltip', { name: 'Chat settings', exact: true });
  const dialog = page.getByRole('dialog', { name: 'Chat settings', exact: true });

  await trigger.hover();
  await expect(hint).toBeVisible();
  await trigger.click();
  await dialog.getByRole('button', { name: 'Close chat settings', exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();
  await expect(hint).toBeHidden();

  await page.keyboard.press('Tab');
  await page.keyboard.press('Shift+Tab');
  await expect(trigger).toBeFocused();
  await expect(hint).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(dialog).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();
  await expect(hint).toBeHidden();

  await trigger.hover();
  await expect(hint).toBeVisible();
});

test('composer attaches picked files, dropped files and links, with opt-in local conversion and replay', async ({ page }) => {
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  const requests: { messages: { role: string; parts: Record<string, unknown>[] }[] }[] = [];
  await mockModels(page);
  await page.route('**/gateway/api/chat', async route => {
    requests.push(route.request().postDataJSON());
    await route.fulfill({ contentType: 'text/event-stream', headers: { 'x-vercel-ai-ui-message-stream': 'v1' }, body: sse(`Attachment reply ${requests.length}`, requests.length) });
  });
  await page.goto('/');
  await showSettings(page); await addKey(page); await closeSettings(page);
  await chooseChatModel(page);

  const composer = page.getByRole('form', { name: 'Message composer' });
  const plus = composer.getByRole('button', { name: 'Add to message' });
  const menu = page.getByRole('menu', { name: 'Add to message' });
  await plus.press('ArrowDown');
  await expect(menu.getByRole('menuitem', { name: 'Files', exact: true })).toBeFocused();
  expect((await menu.boundingBox())!.y).toBeLessThan((await plus.boundingBox())!.y);
  await page.keyboard.press('Escape');
  await expect(plus).toBeFocused();

  await plus.click();
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), menu.getByRole('menuitem', { name: 'Files', exact: true }).click()]);
  await chooser.setFiles({ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('raw notes') });
  await plus.click();
  await menu.getByRole('menuitem', { name: 'Link', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Link', exact: true });
  await dialog.getByLabel('URL', { exact: true }).fill('https://example.test/report.pdf');
  await dialog.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(composer.getByRole('link', { name: 'example.test/report.pdf' })).toBeVisible();
  await composer.getByRole('button', { name: 'Send' }).click();
  await expect(page.getByText('Attachment reply 1')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Copy user message', exact: true })).toHaveCount(0);
  expect(requests[0].messages.find(message => message.role === 'user')?.parts).toEqual([
    { type: 'file', filename: 'notes.txt', mediaType: 'text/plain', url: 'data:text/plain;base64,cmF3IG5vdGVz' },
    { type: 'file', filename: 'example.test/report.pdf', mediaType: 'application/pdf', url: 'https://example.test/report.pdf' },
  ]);

  const settings = await showSettings(page, 'Attachments');
  const attachments = settings.getByRole('tabpanel', { name: 'Attachments' });
  const convert = attachments.getByRole('switch', { name: 'Convert files to text' });
  await expect(attachments).toHaveText('Convert files to text');
  await expect(convert).not.toBeChecked();
  await convert.check();
  await closeSettings(page);
  await composer.getByRole('button', { name: 'Chat settings' }).click();
  const chatSettings = page.getByRole('dialog', { name: 'Chat settings' });
  await expect(chatSettings.getByRole('switch', { name: 'Convert files to text' })).toHaveCount(0);
  await chatSettings.getByRole('button', { name: 'Defaults' }).click();
  await chatSettings.getByRole('button', { name: 'Close chat settings' }).click();

  const transfer = await page.evaluateHandle(() => {
    const data = new DataTransfer();
    data.items.add(new File(['Markdown body'], 'document.md'));
    data.items.add(new File(['%PDF'], 'document.pdf', { type: 'application/pdf' }));
    data.items.add(new File(['discard'], 'discard.txt', { type: 'text/plain' }));
    return data;
  });
  await composer.dispatchEvent('dragenter', { dataTransfer: transfer });
  await expect(composer).toHaveAttribute('data-file-drag', 'true');
  await composer.dispatchEvent('drop', { dataTransfer: transfer });
  await expect(composer).not.toHaveAttribute('data-file-drag');
  await composer.getByRole('button', { name: 'Remove discard.txt' }).click();
  await expect(composer.getByText('As text')).toBeVisible();
  await expect(composer.getByText('Original file')).toBeVisible();
  await composer.getByRole('textbox', { name: 'Message', exact: true }).fill('Summarize these documents.');
  await composer.getByRole('button', { name: 'Send' }).click();
  await expect(page.getByText('Attachment reply 2')).toBeVisible();
  expect(requests[1].messages.find(message => message.role === 'user')?.parts)
    .toEqual(requests[0].messages.find(message => message.role === 'user')?.parts);
  expect(requests[1].messages.at(-1)?.parts).toEqual([
    { type: 'text', text: 'Summarize these documents.' },
    { type: 'text', text: '\n\nFile: "document.md"\nMarkdown body', providerMetadata: { streaik: { attachmentName: 'document.md' } } },
    { type: 'file', filename: 'document.pdf', mediaType: 'application/pdf', url: 'data:application/pdf;base64,JVBERg==' },
  ]);
  await expect(page.getByRole('region', { name: 'Conversation' }).getByText('document.md', { exact: true })).toBeVisible();
  const copy = page.getByRole('article', { name: 'You', exact: true }).last().getByRole('button', { name: 'Copy user message', exact: true });
  await expect(copy).toHaveText('');
  await expect(copy.locator('svg')).toBeVisible();
  await copy.click();
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe('Summarize these documents.');
});

test('model picker groups and searches compatible models on a narrow screen, with keyboard selection', async ({ page }) => {
  const secondModel = 'openai/gpt-5-nano';
  const longName = `Test Claude ${'with a longer model name '.repeat(8).trim()}`;
  await page.setViewportSize({ width: 360, height: 640 });
  await page.route('**/gateway/v1/models', route => route.fulfill({ json: { data: [
    { id: 'anthropic/claude-example', name: 'Claude Example' },
    { id: model, name: 'GPT Mini' }, { id: secondModel, name: 'GPT Nano' },
    { id: 'openai/gpt-image-1', type: 'image' },
    ...Array.from({ length: 16 }, (_, i) => ({ id: `anthropic/claude-test-${i}`, name: `Test Claude ${i}` })),
    { id: 'anthropic/claude-long', name: longName },
  ] } }));
  await page.route('**/gateway/api/chat', async route => {
    expect(route.request().postDataJSON().model).toBe(secondModel);
    await route.fulfill({ contentType: 'text/event-stream', headers: { 'x-vercel-ai-ui-message-stream': 'v1' }, body: sse('Selected model reply', 1, secondModel) });
  });
  await page.goto('/');
  await showSettings(page); await addKey(page); await closeSettings(page);
  const picker = modelPicker(page);
  const popup = page.getByRole('dialog', { name: 'Model', exact: true });
  const search = popup.getByRole('searchbox', { name: 'Search models', exact: true });
  const list = popup.getByRole('listbox');
  const openAI = list.getByRole('group', { name: 'OpenAI', exact: true });
  const claude = list.getByRole('option', { name: 'Claude Example', exact: true });
  await expect(page.locator('.chat-toolbar').getByRole('button')).toHaveCount(1);
  await expect(picker).toHaveText('Select models');
  await picker.press('ArrowDown');
  await expect(search).toBeFocused();
  await expect(list).toHaveAttribute('aria-multiselectable', 'true');
  await expect(list.getByRole('option', { selected: true })).toHaveCount(0);
  await claude.click();
  await expect(list.getByRole('group', { name: 'Anthropic', exact: true }).getByRole('option', { selected: true })).toHaveText('Claude Example');
  await expect(openAI.getByRole('option')).toHaveText(['GPT Mini', 'GPT Nano']);
  await expect(list.getByRole('option')).toHaveCount(20);
  const bounds = await popup.boundingBox();
  expect(bounds!.x).toBeGreaterThanOrEqual(0);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(360);
  expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(640);
  // With a long list, the popup should fill the space below the trigger, less the viewport gutter.
  expect(bounds!.height).toBeGreaterThanOrEqual(640 - bounds!.y - 12);
  const scrolls = await list.evaluate(element => {
    element.scrollTop = element.scrollHeight;
    return element.scrollTop > 0;
  });
  expect(scrolls).toBe(true);
  await expect(search).toBeInViewport();

  await search.fill('  OPENAI  gpt ');
  await expect(list.getByRole('group')).toHaveCount(1);
  await expect(openAI.getByRole('option')).toHaveText(['GPT Mini', 'GPT Nano']);
  await search.fill('OPENAI/GPT-4.1-MINI');
  await expect(list.getByRole('option')).toHaveText('GPT Mini');
  await expect.poll(async () => (await popup.boundingBox())!.height).toBeLessThan(160);
  await search.fill('gpt-image');
  await expect(popup.getByRole('status')).toHaveText('No matching models.');
  await search.press('Enter');
  await expect(picker).toHaveText('Claude Example');
  await search.fill('openai');
  await search.press('ArrowDown');
  const nano = list.getByRole('option', { name: 'GPT Nano', exact: true });
  await expect(search).toHaveAttribute('aria-activedescendant', (await nano.getAttribute('id'))!);
  await search.press('Enter');
  const summary = 'claude-example, gpt-5-nano';
  await expect(picker).toHaveText(summary);
  await expect(picker).toHaveAccessibleDescription(summary);
  await expect(search).toBeFocused();
  await expect(search).toHaveValue('openai');
  await expect(nano).toHaveAttribute('aria-selected', 'true');
  await search.fill('claude example');
  await expect(claude).toHaveAttribute('aria-selected', 'true');
  await claude.click();
  await expect(claude).toHaveAttribute('aria-selected', 'false');
  await expect(search).toBeFocused();
  await expect(picker).toHaveText('GPT Nano');
  await search.press('Escape');
  await expect(picker).toBeFocused();
  await expect(popup).toBeHidden();

  await picker.click();
  await expect(search).toBeFocused();
  await expect(search).toHaveValue('');
  await expect(nano).toHaveAttribute('aria-selected', 'true');
  await expect(nano.locator('svg')).toHaveCount(1);
  await search.press('Escape');
  await expect(picker).toBeFocused();
  await expect(popup).toBeHidden();
  await picker.click();
  await expect(search).toBeFocused();
  await search.press('Tab');
  await expect(popup).toBeHidden();
  const composer = page.getByRole('textbox', { name: 'Message', exact: true });
  await expect(composer).toBeFocused();
  await picker.click();
  await nano.click();
  await expect(list.getByRole('option', { selected: true })).toHaveCount(0);
  await expect(picker).toHaveText('Select models');
  await search.press('Escape');
  await composer.fill('Use the selected model');
  const send = page.getByRole('button', { name: 'Send', exact: true });
  await expect(send).toBeDisabled();
  await composer.press('Enter');
  await expect(composer).toHaveValue('Use the selected model');
  await picker.click();
  await nano.click();
  await search.press('Escape');
  await expect(send).toBeEnabled();
  await composer.press('Enter');
  await expect(page.getByText('Selected model reply', { exact: true })).toBeVisible();
  await picker.click();
  await openCatalog(page, 'Providers');
  await expect(popup).toBeHidden();
  await expect(page.getByRole('button', { name: 'Back to chat', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'New chat', exact: true }).click();
  await expect(composer).toHaveValue('');
});

test('search and provider groups remain available when switching to HTML and Fluent', async ({ page }) => {
  await mockModels(page);
  await page.goto('/');
  await showSettings(page); await addKey(page); await closeSettings(page);
  const picker = modelPicker(page);
  const search = page.getByRole('searchbox', { name: 'Search models', exact: true });
  for (const theme of ['html', 'fluent']) {
    const dialog = await showSettings(page, 'Theme');
    const panel = dialog.getByRole('tabpanel', { name: 'Theme' });
    await panel.getByRole('combobox', { name: 'Theme', exact: true }).selectOption(theme);
    await expect(panel.getByRole('group', { name: `${theme === 'html' ? 'HTML' : 'Fluent'} settings` })).toBeVisible();
    await closeSettings(page);
    await chooseChatModel(page);
    await picker.click();
    await expect(search).toBeFocused();
    await search.fill('openai');
    await expect(page.getByRole('group', { name: 'OpenAI', exact: true }).getByRole('option', { selected: true })).toHaveText('gpt-4.1-mini');
    await search.press('Escape');
    await expect(picker).toBeFocused();
  }
});

function sse(text: string, turn: number, answerModel = model) {
  return [
    { type: 'start', messageId: `answer-${turn}` }, { type: 'text-start', id: 'p1' },
    { type: 'text-delta', id: 'p1', delta: text }, { type: 'text-end', id: 'p1' },
    { type: 'finish', finishReason: 'stop', messageMetadata: { model: answerModel } },
  ].map((event) => `data: ${JSON.stringify(event)}\n\n`).join('') + 'data: [DONE]\n\n';
}

test('chat charts preview with the plugin off and follow the active theme', async ({ page }) => {
  await mockModels(page);
  const requests: { tools?: { name: string }[]; messages: { parts: { output?: unknown }[] }[] }[] = [];
  const htmlChartModule = /\/HtmlChart\.tsx(?:\?|$)/;
  let htmlChartRequests = 0;
  page.on('request', request => { if (htmlChartModule.test(request.url())) htmlChartRequests++; });
  const toolName = 'local_chart_instructions';
  const charts = ['bar', 'line', 'doughnut'].map(type => ({
    type, title: `Sample ${type}`, labels: ['Jan', 'Feb', 'Mar'], series: [
      { name: 'Requests', values: [14, 20, 9] },
      ...(type === 'doughnut' ? [] : [{ name: 'Retries', values: [2, 1, 3] }]),
    ],
  }));
  const fence = (text: string, language = 'chart') => `\`\`\`${language}\n${text}\n\`\`\``;
  const openFence = '```chart\n' + JSON.stringify({ ...charts[0], title: 'Unclosed chart' });
  await page.route('**/gateway/api/chat', route => {
    requests.push(route.request().postDataJSON());
    const turn = requests.length;
    const body = turn === 1 ? sse([
      ...charts.map(chart => fence(JSON.stringify(chart))), fence('{"type":"unknown"}'), fence('const value = 1;', 'js'), openFence,
    ].join('\n\n'), turn) : turn === 2 ? [
      { type: 'start', messageId: 'chart-tool-reply' }, { type: 'start-step' },
      { type: 'tool-input-available', toolCallId: 'chart-tool', toolName, input: {}, dynamic: true },
      { type: 'tool-approval-request', toolCallId: 'chart-tool', approvalId: 'chart-review', signature: 'fixture-signature' },
      { type: 'finish-step' }, { type: 'finish', finishReason: 'tool-calls' },
    ].map(event => `data: ${JSON.stringify(event)}\n\n`).join('') + 'data: [DONE]\n\n'
      : sse('Chart instructions received.', turn).replace(/^data: [^\n]+\n\n/, '');
    return route.fulfill({ contentType: 'text/event-stream', headers: { 'x-vercel-ai-ui-message-stream': 'v1' }, body });
  });

  await page.goto('/');
  await showSettings(page); await addKey(page); await closeSettings(page);
  await chooseChatModel(page);
  const settings = page.getByRole('dialog', { name: 'Chat settings', exact: true });
  const openTools = async () => {
    await page.getByRole('button', { name: 'Chat settings', exact: true }).click();
    await settings.getByRole('tab', { name: 'Tools', exact: true }).click();
  };
  const plugin = settings.getByRole('switch', { name: 'Charts', exact: true });
  await openTools(); await expect(plugin).not.toBeChecked();
  await settings.getByRole('button', { name: 'Close', exact: true }).click();
  const composer = page.getByRole('textbox', { name: 'Message', exact: true });
  const send = async (text: string) => { await composer.fill(text); await composer.press('Enter'); };
  await send('Show chart samples');
  const figure = (type: string) => page.getByRole('figure', { name: `Sample ${type}`, exact: true });
  for (const { type } of charts) await expect(figure(type).locator('.recharts-surface').first()).toBeVisible();
  expect(requests[0].tools ?? []).toEqual([]);
  await expect(page.locator('pre .language-chart')).toHaveCount(2);
  await expect(page.locator('pre .language-chart').last()).toContainText('Unclosed chart');
  await expect(page.locator('pre .language-js')).toHaveText('const value = 1;\n');

  const block = page.locator('.chat-chart-block').first();
  await block.getByRole('button', { name: 'Code', exact: true }).click();
  await expect(block.locator('pre')).toContainText(JSON.stringify(charts[0]));
  await block.getByRole('button', { name: 'Chart', exact: true }).click();
  await block.getByText('Chart data', { exact: true }).click();
  await expect(block.getByRole('row', { name: 'Jan 14 2', exact: true })).toBeVisible();

  for (const [theme, plot] of [['fluent', '.streaik-fluent-chart svg'], ['html', 'canvas']]) {
    const dialog = await showSettings(page, 'Theme');
    await dialog.getByRole('combobox', { name: 'Theme', exact: true }).selectOption(theme);
    await closeSettings(page);
    for (const { type } of charts) await expect(figure(type).locator(plot).first()).toBeVisible();
    if (theme === 'fluent') expect(htmlChartRequests).toBe(0);
  }

  await openTools(); await plugin.check();
  await settings.getByRole('button', { name: 'Close', exact: true }).click();
  await send('Get the chart format');
  const review = page.getByRole('dialog', { name: 'Review tool result', exact: true });
  await review.getByRole('button', { name: 'Approve and share', exact: true }).click();
  await expect(page.getByText('Chart instructions received.', { exact: true })).toBeVisible();
  expect(requests[1].tools?.map(tool => tool.name)).toEqual([toolName]);
  expect(requests[2].messages.flatMap(message => message.parts).find(part => part.output)).toMatchObject({
    output: { structuredContent: { example: expect.stringContaining('```chart') } },
  });

  await openTools(); await plugin.uncheck();
  await settings.getByRole('button', { name: 'Close', exact: true }).click();
  await page.reload();
  for (const { type } of charts) await expect(figure(type).locator('canvas')).toBeVisible();

  // A failed lazy renderer must not hide the underlying data or the source.
  await page.route(htmlChartModule, route => route.abort());
  await page.reload();
  await expect(figure('bar').getByRole('row', { name: 'Jan 14 2', exact: true })).toBeVisible();
  await block.getByRole('button', { name: 'Code', exact: true }).click();
  await expect(block.locator('pre')).toContainText(JSON.stringify(charts[0]));
});

test('global Chat preferences persist and control badges and context independently from conversation cost', async ({ page }) => {
  let count = 0;
  await page.route('**/gateway/v1/models', route => route.fulfill({ json: { data: [{ id: model, context_window: 2000, max_tokens: 256 }] } }));
  await page.route('**/gateway/api/chat', route => {
    count++;
    const usage = { promptTokens: 2000, completionTokens: 34, totalTokens: 2034 };
    const messageMetadata = { model, usage, providerMetadata: { gateway: { cost: count === 1 ? 0 : 0.125, ttft: 1.25, tps: 25 } } };
    const body = sse(`Usage reply ${count}`, count).replace(JSON.stringify({ model }), JSON.stringify(messageMetadata));
    return route.fulfill({ headers: { 'content-type': 'text/event-stream', 'x-vercel-ai-ui-message-stream': 'v1' }, body });
  });
  await page.goto('/');
  const settings = await showSettings(page);
  await addKey(page);
  await settings.getByRole('tab', { name: 'Chat', exact: true }).click();
  const panel = settings.getByRole('tabpanel', { name: 'Chat', exact: true });
  const toggle = (name: string) => panel.getByRole('switch', { name, exact: true });
  await expect(panel.getByRole('heading')).toHaveText(['Input', 'Output', 'Tool output']);
  await expect(panel.getByRole('switch')).toHaveCount(11);
  for (const name of ['Dictate', 'Show context size', 'Show tokens per message', 'Show provider logo', 'Text', 'Links']) await expect(toggle(name)).toBeChecked();
  for (const name of ['Show metrics', 'Images', 'Audio', 'Video', 'Documents']) await expect(toggle(name)).not.toBeChecked();
  await toggle('Dictate').uncheck();
  await closeSettings(page);
  await chooseChatModel(page);

  const bar = page.getByRole('progressbar', { name: 'Context window', exact: true });
  const cost = page.getByRole('img', { name: /^Conversation cost:/ });
  const send = async (text: string) => {
    const composer = page.getByRole('textbox', { name: 'Message', exact: true });
    await composer.fill(text);
    await composer.press('Enter');
  };
  await expect(bar).toHaveCount(0);
  await send('First usage question');
  const lastReply = page.getByRole('article', { name: 'Assistant', exact: true }).last();
  await expect(lastReply.locator('.chat-provider-logo')).toHaveAttribute('src', openAiFavicon);
  await expect(lastReply.locator('.chat-speaker')).toHaveText('gpt-4.1-mini');
  await expect(lastReply.getByRole('img', { name: /^Total tokens:/ })).toHaveText('2,034');
  await expect(lastReply.getByRole('img', { name: /^Time to first token:/ })).toHaveCount(0);
  await expect(cost).toHaveCount(0);
  await expect(bar).toHaveAttribute('aria-valuetext', /^Tokens used: 2,034 of 2,000/);
  await expect(bar).toHaveAttribute('value', '2000');

  await send('Second usage question');
  await expect(cost).toHaveText('0.125');
  await showSettings(page, 'Chat');
  for (const name of ['Show context size', 'Show tokens per message', 'Show provider logo', 'Links']) await toggle(name).uncheck();
  await toggle('Show metrics').check();
  await closeSettings(page);
  await expect(bar).toHaveCount(0);
  await expect(cost).toHaveText('0.125');
  await expect(lastReply.locator('.chat-provider-logo')).toHaveCount(0);
  await expect(lastReply.locator('.chat-speaker')).toHaveText(model);
  await expect(lastReply.getByRole('img', { name: /^Total tokens:/ })).toHaveCount(0);
  await expect(lastReply.getByRole('img', { name: /^Time to first token:/ })).toHaveText('1.25 s');
  await expect(lastReply.getByRole('img', { name: /^Tokens per second:/ })).toHaveText('25 tok/s');
  await expect(lastReply.getByRole('img', { name: /^Gateway cost:/ })).toHaveText('0.125');

  await page.getByRole('button', { name: 'Chat settings', exact: true }).click();
  await page.getByRole('dialog', { name: 'Chat settings', exact: true }).getByRole('button', { name: 'Defaults', exact: true }).click();
  await closeSettings(page);
  await page.reload();
  await expect(page.getByText('Usage reply 2', { exact: true })).toBeVisible();
  await expect(cost).toHaveText('0.125');
  await showSettings(page, 'Chat');
  for (const name of ['Dictate', 'Show context size', 'Show tokens per message', 'Show provider logo', 'Links']) await expect(toggle(name)).not.toBeChecked();
  await expect(toggle('Show metrics')).toBeChecked();

  await settings.getByRole('tab', { name: 'General', exact: true }).click();
  await settings.getByLabel('Language', { exact: true }).selectOption('nl');
  const localized = page.getByRole('dialog', { name: 'Instellingen', exact: true });
  await localized.getByRole('tab', { name: 'Chat', exact: true }).click();
  const localizedPanel = localized.getByRole('tabpanel', { name: 'Chat', exact: true });
  await expect(localizedPanel.getByRole('heading')).toHaveText(['Invoer', 'Uitvoer', 'Tooluitvoer']);
  for (const name of ['Dicteren', 'Toon contextgrootte', 'Toon tokens per bericht', 'Toon providerlogo', 'Toon metingen',
    'Tekst', 'Links', 'Afbeeldingen', 'Audio', 'Video', 'Documenten']) await expect(localizedPanel.getByRole('switch', { name, exact: true })).toBeVisible();
});

test('MCP Tool output preferences filter approved requests and replay without changing the reviewed result', async ({ page }) => {
  await mockModels(page);
  const pixel = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLttAAAAABJRU5ErkJggg==';
  const result = {
    content: [{ type: 'text', text: 'Fixture text' }, { type: 'image', mimeType: 'image/png', data: pixel }],
    structuredContent: { code: 'fixture-structured' },
  };
  let toolCalls = 0;
  await page.route('**/mcp-output-fixture', route => {
    const { id, method, params } = route.request().postDataJSON();
    const reply = (value: unknown) => route.fulfill({ json: { jsonrpc: '2.0', id, result: value } });
    if (method === 'server/discover') return reply({ supportedVersions: ['2026-07-28'], capabilities: { tools: {} } });
    if (method === 'tools/list') return reply({ resultType: 'complete', ttlMs: 0, cacheScope: 'private',
      tools: [{ name: 'lookup', title: 'Fixture tool', inputSchema: { type: 'object' } }] });
    expect(method).toBe('tools/call');
    expect(params.name).toBe('lookup');
    toolCalls++;
    return reply({ resultType: 'complete', ...result });
  });
  const signature = 'fixture-signature';
  const requests: { messages: { parts: { toolCallId?: string; approval?: unknown; output?: unknown }[] }[] }[] = [];
  await page.route('**/gateway/api/chat', route => {
    const body = route.request().postDataJSON();
    requests.push(body);
    const headers = { 'x-vercel-ai-ui-message-stream': 'v1', 'content-type': 'text/event-stream' };
    if (requests.length === 1) {
      expect(body.tools).toHaveLength(1);
      const frames = [
        { type: 'start', messageId: 'mcp-fixture-answer' }, { type: 'start-step' },
        { type: 'tool-input-available', toolName: body.tools[0].name, toolCallId: 'lookup-fixture', input: { query: 'fixture-query' }, dynamic: true, providerExecuted: false },
        { type: 'tool-approval-request', toolCallId: 'lookup-fixture', approvalId: 'review-fixture', signature },
        { type: 'finish-step' }, { type: 'finish', finishReason: 'tool-calls' },
      ];
      return route.fulfill({ headers, body: frames.map(frame => `data: ${JSON.stringify(frame)}\n\n`).join('') + 'data: [DONE]\n\n' });
    }
    const response = sse(`MCP fixture reply ${requests.length}`, requests.length);
    return route.fulfill({ headers, body: requests.length === 2 ? response.replace(/^data: [^\n]+\n\n/, '') : response });
  });
  await page.goto('/');
  await showSettings(page); await addKey(page); await closeSettings(page);
  await chooseChatModel(page);
  await page.getByRole('button', { name: 'Add to message', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Model Context', exact: true }).click();
  const context = page.getByRole('dialog', { name: 'Model Context', exact: true });
  await context.getByRole('tab', { name: 'Installed', exact: true }).click();
  await context.getByRole('button', { name: 'Add by URL' }).click();
  const editor = page.getByRole('dialog', { name: 'Add MCP server' });
  await editor.getByLabel('Name', { exact: true }).fill('Output fixture');
  await editor.getByLabel('URL', { exact: true }).fill(new URL('/mcp-output-fixture', page.url()).href);
  await editor.getByRole('button', { name: 'Save', exact: true }).click();
  await context.getByRole('switch', { name: 'Output fixture' }).check();
  await expect(context.getByRole('status')).toHaveText('1 tools available');
  await context.getByRole('button', { name: 'Close', exact: true }).click();
  const composer = page.getByRole('textbox', { name: 'Message', exact: true });
  await composer.fill('Run the MCP fixture'); await composer.press('Enter');
  const review = page.getByRole('dialog', { name: 'Review tool result' });
  await expect(review.getByRole('tab')).toHaveText(['Input', 'Structured', 'Text', 'Images']);
  const structured = review.getByRole('tab', { name: 'Structured', exact: true });
  await expect(structured).toHaveAttribute('aria-selected', 'true');
  await expect(review.getByRole('tree', { name: 'JSON' })).toContainText('fixture-structured');
  await structured.press('ArrowRight');
  await expect(review.getByRole('tab', { name: 'Text', exact: true })).toBeFocused();
  await expect(review.getByRole('tabpanel', { name: 'Text' })).toHaveText('Fixture text');
  await review.getByRole('tab', { name: 'Text', exact: true }).press('End');
  const preview = review.getByRole('img', { name: 'MCP image 1' });
  await expect(preview).toBeVisible();
  await expect.poll(() => preview.evaluate((image: HTMLImageElement) => image.naturalWidth)).toBe(1);
  await review.getByRole('tab', { name: 'Images' }).press('Home');
  await expect(review.getByRole('tabpanel', { name: 'Input' })).toContainText('fixture-query');
  expect(requests).toHaveLength(1);
  await review.getByRole('button', { name: 'Approve and share', exact: true }).click();
  await expect(page.getByText('MCP fixture reply 2', { exact: true })).toBeVisible();
  const toolResult = (index: number) => requests[index].messages.flatMap(message => message.parts).find(part => part.toolCallId === 'lookup-fixture');
  const approval = { id: 'review-fixture', approved: true, signature };
  expect(toolResult(1)).toMatchObject({ approval, output: { ...result, content: [result.content[0], { type: 'text', text: 'Image content omitted by user settings.' }] } });
  expect(JSON.stringify(requests[1])).not.toContain(pixel);
  const activity = page.getByRole('region', { name: 'Assistant activity' });
  await expect(activity.getByRole('tab', { name: 'Input' })).toHaveAttribute('aria-selected', 'true');
  await expect(activity.getByRole('tabpanel', { name: 'Input' })).toContainText('fixture-query');
  await expect(activity.getByRole('tab', { name: 'Output' })).toHaveCount(0);
  await activity.getByRole('tab', { name: 'Images' }).click();
  await expect(activity.getByRole('img', { name: 'MCP image 1' })).toHaveAttribute('src', `data:image/png;base64,${pixel}`);
  await activity.getByRole('tab', { name: 'Structured' }).click();
  await expect(activity.getByRole('tree', { name: 'JSON' })).toContainText('fixture-structured');

  const appearance = await showSettings(page, 'General');
  await appearance.getByLabel('Color mode', { exact: true }).selectOption('dark');
  await appearance.getByRole('tab', { name: 'Theme', exact: true }).click();
  await appearance.getByRole('combobox', { name: 'Theme', exact: true }).selectOption('html');
  await closeSettings(page);
  const fallbackViewer = activity.getByRole('group', { name: 'JSON', exact: true });
  await expect(fallbackViewer).toContainText('fixture-structured');
  await expect(fallbackViewer).toHaveCSS('--w-rjv-color', '#79c0ff');

  const settings = await showSettings(page, 'Chat');
  await settings.getByRole('switch', { name: 'Images', exact: true }).check();
  await settings.getByRole('switch', { name: 'Text', exact: true }).uncheck();
  await closeSettings(page);
  await composer.fill('Replay after changing preferences'); await composer.press('Enter');
  await expect(page.getByText('MCP fixture reply 3', { exact: true })).toBeVisible();
  expect(toolResult(2)).toMatchObject({ approval, output: { ...result, content: [{ type: 'text', text: 'Text content omitted by user settings.' }, result.content[1]] } });
  expect(toolCalls).toBe(1);

  await page.reload();
  await expect(activity.getByRole('tab', { name: 'Input' })).toHaveAttribute('aria-selected', 'true');
  await activity.getByRole('tab', { name: 'Images' }).click();
  await expect(activity.getByRole('img', { name: 'MCP image 1' })).toBeVisible();
});

test('Model Context settings localize, persist and leave URL and extensions off', async ({ page }) => {
  await page.goto('/');
  const settings = await showSettings(page, 'Model Context');
  const area = settings.getByRole('tabpanel', { name: 'Model Context', exact: true });
  const client = area.getByRole('tabpanel', { name: 'Client', exact: true });
  const form = client.getByRole('switch', { name: 'Form', exact: true });
  const reset = client.getByRole('switch', { name: 'Reset timeout on progress' });
  const slider = client.getByRole('slider');
  await expect(form).toBeChecked();
  await expect(reset).toBeChecked();
  await expect(slider).toHaveAccessibleName('Tool timeout (5 minutes)');
  const url = client.getByRole('switch', { name: 'URL', exact: true });
  await expect(url).toBeDisabled();
  await expect(url).not.toBeChecked();
  await form.uncheck();
  await reset.uncheck();
  await slider.press('End');
  await expect(slider).toHaveValue('60');
  await area.getByRole('tab', { name: 'Client' }).press('ArrowRight');
  const extensions = area.getByRole('tabpanel', { name: 'Extensions' });
  await expect(extensions.getByRole('switch')).toHaveCount(2);
  for (const name of ['Apps', 'Skills']) {
    const extension = extensions.getByRole('switch', { name, exact: true });
    await expect(extension).toBeDisabled();
    await expect(extension).not.toBeChecked();
  }
  await expect(area.getByRole('tab', { name: 'Catalog' })).toHaveCount(0);

  await closeSettings(page);
  await page.reload();
  await showSettings(page, 'Model Context');
  await expect(form).not.toBeChecked();
  await expect(reset).not.toBeChecked();
  await expect(slider).toHaveValue('60');
  await settings.getByRole('tab', { name: 'General', exact: true }).click();
  await settings.getByLabel('Language', { exact: true }).selectOption('nl');
  const dutch = page.getByRole('dialog', { name: 'Instellingen', exact: true });
  await dutch.getByRole('tab', { name: 'Model Context', exact: true }).click();
  await expect(dutch.getByRole('heading', { name: 'Uitvragen' })).toBeVisible();
  await expect(dutch.getByRole('switch', { name: 'Formulier' })).not.toBeChecked();
  await expect(dutch.getByRole('slider')).toHaveAccessibleName('Tool timeout (60 minuten)');
  await expect(dutch.getByRole('tab', { name: 'Extensies' })).toBeVisible();
  await dutch.getByRole('tab', { name: 'Algemeen', exact: true }).click();
  await dutch.getByLabel('Taal', { exact: true }).selectOption('es');
  const spanish = page.getByRole('dialog', { name: 'Configuración', exact: true });
  await spanish.getByRole('tab', { name: 'Contexto del modelo', exact: true }).click();
  await expect(spanish.getByRole('tabpanel', { name: 'Cliente', exact: true })).toBeVisible();
  await expect(spanish.getByRole('switch', { name: 'Formulario' })).not.toBeChecked();
  await expect(spanish.getByRole('slider')).toHaveAccessibleName('Tiempo de espera de herramienta (60 minutos)');
});

test('MCP elicitation queues forms and resumes the tool before its separate result review', async ({ page }) => {
  await mockModels(page);
  let toolCalls = 0;
  let chatCalls = 0;
  const input = (message: string, properties = {}) => ({ method: 'elicitation/create', params: { mode: 'form', message,
    requestedSchema: { type: 'object', properties, required: Object.keys(properties) } } });
  await page.route('**/mcp-elicitation-fixture', route => {
    const { id, method, params } = route.request().postDataJSON();
    const reply = (result: unknown) => route.fulfill({ json: { jsonrpc: '2.0', id, result } });
    if (method === 'server/discover') return reply({ supportedVersions: ['2026-07-28'], capabilities: { tools: {} } });
    if (method === 'tools/list') return reply({ resultType: 'complete', ttlMs: 0, cacheScope: 'private',
      tools: [{ name: 'elicit', inputSchema: { type: 'object' } }] });
    expect(method).toBe('tools/call');
    expect(params._meta['io.modelcontextprotocol/clientCapabilities'].elicitation).toEqual({ form: {} });
    expect(params._meta.progressToken).toBeDefined();
    expect(route.request().headers()['mcp-session-id']).toBeUndefined();
    if (++toolCalls === 1) return reply({ resultType: 'input_required', requestState: 'opaque', inputRequests: {
      address: input('First request', { email: { type: 'string', title: 'Email address', format: 'email', description: 'Your contact address' },
        number: { type: 'integer', title: 'Quantity', default: 0 }, colors: { type: 'array', title: 'Colors', default: ['b'],
          items: { anyOf: [{ const: 'b', title: 'Blue' }, { const: 'r', title: 'Red' }] } } }),
      second: input('Second request'), third: input('Third request'),
    } });
    expect(params.requestState).toBe('opaque');
    expect(params.inputResponses).toEqual({ address: { action: 'accept', content: { email: 'a@example.test', number: 0, colors: ['b', 'r'] } },
      second: { action: 'decline' }, third: { action: 'cancel' } });
    return reply({ resultType: 'complete', content: [{ type: 'text', text: 'Elicited tool result' }] });
  });
  await page.route('**/gateway/api/chat', route => {
    const headers = { 'x-vercel-ai-ui-message-stream': 'v1', 'content-type': 'text/event-stream' };
    const body = route.request().postDataJSON();
    expect(JSON.stringify(body)).not.toContain('a@example.test');
    if (++chatCalls > 1) return route.fulfill({ headers, body: sse('Elicitation flow complete', 2).replace(/^data: [^\n]+\n\n/, '') });
    expect(body.tools).toHaveLength(1);
    const frames = [
      { type: 'start', messageId: 'elicit-fixture-answer' }, { type: 'start-step' },
      { type: 'tool-input-available', toolName: body.tools[0].name, toolCallId: 'elicit-fixture', input: {}, dynamic: true, providerExecuted: false },
      { type: 'tool-approval-request', toolCallId: 'elicit-fixture', approvalId: 'elicit-review', signature: 'fixture-signature' },
      { type: 'finish-step' }, { type: 'finish', finishReason: 'tool-calls' },
    ];
    return route.fulfill({ headers, body: frames.map(frame => `data: ${JSON.stringify(frame)}\n\n`).join('') + 'data: [DONE]\n\n' });
  });

  await page.goto('/');
  await showSettings(page); await addKey(page); await closeSettings(page);
  await chooseChatModel(page);
  await page.getByRole('button', { name: 'Add to message', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Model Context', exact: true }).click();
  const context = page.getByRole('dialog', { name: 'Model Context', exact: true });
  await context.getByRole('tab', { name: 'Installed', exact: true }).click();
  await context.getByRole('button', { name: 'Add by URL' }).click();
  const editor = page.getByRole('dialog', { name: 'Add MCP server' });
  await editor.getByLabel('Name', { exact: true }).fill('Elicitation fixture');
  await editor.getByLabel('URL', { exact: true }).fill(new URL('/mcp-elicitation-fixture', page.url()).href);
  await editor.getByRole('button', { name: 'Save', exact: true }).click();
  await context.getByRole('switch', { name: 'Elicitation fixture' }).check();
  await expect(context.getByRole('status')).toHaveText('1 tools available');
  await context.getByRole('button', { name: 'Close', exact: true }).click();
  const composer = page.getByRole('textbox', { name: 'Message', exact: true });
  await composer.fill('Run the elicitation fixture'); await composer.press('Enter');

  const dialog = page.getByRole('dialog', { name: 'Elicitation', exact: true });
  await expect(dialog.getByText('First request', { exact: true })).toBeVisible();
  await expect(dialog.getByText(/Requested by Elicitation fixture/)).toHaveCount(0);
  await expect(dialog.getByText('Only share information you want to send to this server.', { exact: true })).toHaveCount(0);
  await expect(dialog.getByText('Second request', { exact: true })).toHaveCount(0);
  const accept = dialog.getByRole('button', { name: 'Accept' });
  await accept.click();
  await expect(dialog.getByRole('alert')).toHaveText('This field is required.');
  const email = dialog.getByRole('textbox', { name: /Email address/ });
  await expect(email).toHaveAccessibleDescription('Your contact address This field is required.');
  await email.fill('not-an-email');
  await expect(dialog.getByRole('alert')).toHaveText('Enter a valid value.');
  await email.fill('a@example.test');
  await expect(dialog.getByRole('textbox', { name: /Quantity/ })).toHaveValue('0');
  await expect(dialog.getByRole('checkbox', { name: 'Blue' })).toBeChecked();
  await dialog.getByRole('checkbox', { name: 'Red' }).check();
  await accept.click();
  await expect(dialog.getByText('Second request', { exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: 'Decline' }).click();
  await expect(dialog.getByText('Third request', { exact: true })).toBeVisible();
  expect(toolCalls).toBe(1);
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  const review = page.getByRole('dialog', { name: 'Review tool result' });
  await expect(review.getByRole('tabpanel', { name: 'Text', exact: true })).toHaveText('Elicited tool result');
  await expect(review.getByRole('tab', { name: 'Output', exact: true })).toHaveCount(0);
  expect(toolCalls).toBe(2);
  expect(chatCalls).toBe(1);
  await review.getByRole('button', { name: 'Approve and share', exact: true }).click();
  await expect(page.getByText('Elicitation flow complete', { exact: true })).toBeVisible();
  expect(chatCalls).toBe(2);
});

for (const approved of [true, false]) test(`MCP composer discovers resources and prompts and ${approved ? 'shares' : 'withholds'} read_resource results`, async ({ page }) => {
  await mockModels(page);
  const serverName = 'Composer fixture';
  const reads: string[] = [];
  const assistantUri = 'fixture://pages/assistant';
  const userUri = 'fixture://pages/user';
  const privateText = 'Content from the model-requested resource';
  const promptText = 'Prompt about waterfalls';
  const templateText = 'Attached template contents';
  const complete = { resultType: 'complete', ttlMs: 0, cacheScope: 'private' };
  await page.route('**/mcp-context-fixture', async route => {
    const request = route.request();
    expect(await request.headerValue('Authorization')).toBe('Bearer test-mcp-composer');
    const { id, method, params } = request.postDataJSON();
    const reply = (result: unknown) => route.fulfill({ json: { jsonrpc: '2.0', id, result } });
    if (method === 'server/discover') return reply({ supportedVersions: ['2026-07-28'], capabilities: { resources: {}, prompts: {} } });
    if (method === 'resources/list') return reply(params.cursor === 'page-two' ? { ...complete, resources: [
      { name: 'User guide', uri: userUri, annotations: { audience: ['user'] } },
    ] } : { ...complete, nextCursor: 'page-two', resources: [
      { name: 'Shared guide', uri: 'fixture://pages/shared' }, { name: 'Assistant guide', uri: assistantUri, annotations: { audience: ['assistant'] } },
    ] });
    if (method === 'resources/templates/list') return reply({ ...complete, resourceTemplates: [
      { name: 'Project template', uriTemplate: 'fixture://project/{slug}', annotations: { audience: ['user'] } },
    ] });
    if (method === 'prompts/list') return reply({ ...complete, prompts: [{ name: 'make-prompt', title: 'Topic prompt', arguments: [{ name: 'topic', required: true }] }] });
    if (method === 'prompts/get') {
      expect(params).toMatchObject({ name: 'make-prompt', arguments: { topic: 'waterfalls' } });
      return reply({ ...complete, messages: [{ role: 'user', content: { type: 'text', text: promptText } }] });
    }
    if (method === 'resources/read') {
      reads.push(params.uri);
      return reply({ ...complete, contents: [{ uri: params.uri, text: params.uri === assistantUri ? privateText : templateText }] });
    }
    throw new Error(`Unexpected MCP method: ${method}`);
  });
  let requests = 0;
  await page.route('**/gateway/api/chat', async route => {
    requests++;
    const body = route.request().postDataJSON();
    const wire = JSON.stringify(body);
    const headers = { 'x-vercel-ai-ui-message-stream': 'v1', 'content-type': 'text/event-stream' };
    if (requests === 1) {
      expect(body.tools.map((tool: { name: string }) => tool.name)).toContain('read_resource');
      expect(body).not.toHaveProperty('clientToolResultApproval');
      expect(wire).toContain(promptText);
      expect(wire).toContain(templateText);
      expect(wire).not.toContain(privateText);
      expect(wire).not.toContain(userUri);
      expect(wire).not.toContain('test-mcp-composer');
      const systemText = body.messages[0].parts.map((part: { text: string }) => part.text);
      expect(systemText.at(-1)).toBe('Chat');
      const systemParts = systemText.slice(0, -1).map((text: string) => JSON.parse(text));
      const server = systemParts.find((part: { mcpResourceCatalog?: unknown }) => part.mcpResourceCatalog).mcpResourceCatalog.servers[0];
      expect(server.resources.map((item: { uri: string }) => item.uri)).toEqual(['fixture://pages/shared', assistantUri]);
      expect(server.resourceTemplates).toEqual([]);
      const chunks = [
        { type: 'start', messageId: 'read-resource-answer' }, { type: 'start-step' },
        { type: 'tool-input-available', toolCallId: 'read-fixture', toolName: 'read_resource', dynamic: true,
          input: { serverId: server.serverId, uri: assistantUri } },
        { type: 'tool-approval-request', toolCallId: 'read-fixture', approvalId: 'review-resource', signature: 'fixture-signature' },
        { type: 'finish-step' }, { type: 'finish', finishReason: 'tool-calls' },
      ];
      await route.fulfill({ headers, body: chunks.map(chunk => `data: ${JSON.stringify(chunk)}\n\n`).join('') + 'data: [DONE]\n\n' });
    } else {
      expect(requests).toBe(2);
      expect(wire.includes(privateText)).toBe(approved);
      expect(wire).toContain('fixture-signature');
      expect(wire).not.toContain('test-mcp-composer');
      await route.fulfill({ headers, body: sse('Resource turn complete.', 2).replace(/^data: [^\n]+\n\n/, '') });
    }
  });
  await page.goto('/');
  await showSettings(page); await addKey(page); await closeSettings(page);
  await chooseChatModel(page);
  const openMenu = () => page.getByRole('button', { name: 'Add to message', exact: true }).click();
  const openContext = async () => {
    await openMenu();
    await page.getByRole('menuitem', { name: 'Model Context', exact: true }).click();
    return page.getByRole('dialog', { name: 'Model Context', exact: true });
  };
  await openMenu();
  await expect(page.getByRole('menuitem', { name: 'Prompts', exact: true })).toHaveCount(0);
  await page.keyboard.press('Escape');
  const context = await openContext();
  await context.getByRole('tab', { name: 'Installed', exact: true }).click();
  await context.getByRole('button', { name: 'Add by URL' }).click();
  const editor = page.getByRole('dialog', { name: 'Add MCP server' });
  await editor.getByLabel('Name', { exact: true }).fill(serverName);
  await editor.getByLabel('URL', { exact: true }).fill(new URL('/mcp-context-fixture', page.url()).href);
  await editor.getByRole('button', { name: 'Add header' }).click();
  await editor.getByLabel('Header name').fill('Authorization');
  await editor.getByLabel('Header value').fill('Bearer test-mcp-composer');
  await editor.getByRole('button', { name: 'Save', exact: true }).click();
  await context.getByRole('switch', { name: serverName }).check();
  await expect(context.getByText('Connected', { exact: true })).toBeVisible();
  await context.getByRole('button', { name: 'Close', exact: true }).click();
  const badges = page.getByRole('list', { name: 'Active chat context' });
  await expect(badges.getByText(serverName)).toBeVisible();
  expect(reads).toEqual([]);

  await openMenu();
  await page.getByRole('menuitem', { name: 'Resources', exact: true }).click();
  const resources = page.getByRole('dialog', { name: 'Resources', exact: true });
  await expect(resources.getByRole('button', { name: /Shared guide/ })).toBeVisible();
  await expect(resources.getByRole('button', { name: /User guide/ })).toBeVisible();
  await expect(resources.getByRole('button', { name: /Assistant guide/ })).toHaveCount(0);
  await resources.getByRole('button', { name: /Project template/ }).click();
  await resources.getByRole('textbox', { name: 'slug', exact: true }).fill('road map');
  await resources.getByRole('button', { name: 'Add resource', exact: true }).click();
  await expect(page.getByRole('list', { name: 'Attachments' }).getByText('Project template')).toBeVisible();
  expect(requests).toBe(0);

  await openMenu();
  await page.getByRole('menuitem', { name: 'Prompts', exact: true }).click();
  const prompts = page.getByRole('dialog', { name: 'Prompts', exact: true });
  await prompts.getByRole('button', { name: /Topic prompt/ }).click();
  await prompts.getByRole('textbox', { name: 'topic', exact: true }).fill('waterfalls');
  await prompts.getByRole('button', { name: 'Run prompt', exact: true }).click();
  const review = page.getByRole('dialog', { name: 'Review tool result' });
  await expect(review.getByRole('tab', { name: 'Output' })).toHaveAttribute('aria-selected', 'true');
  const outputPanel = review.getByRole('tabpanel', { name: 'Output' });
  await outputPanel.getByRole('button', { name: 'Expand all' }).click();
  await expect(outputPanel).toContainText(assistantUri);
  await expect(outputPanel).not.toContainText(privateText);
  await review.getByRole('tab', { name: 'Text' }).click();
  await expect(review.getByRole('tabpanel', { name: 'Text' })).toHaveText(privateText);
  expect(requests).toBe(1);
  expect(reads).toEqual(['fixture://project/road%20map', assistantUri]);
  await review.getByRole('button', { name: approved ? 'Approve and share' : 'Decline', exact: true }).click();
  await expect(page.getByText('Resource turn complete.', { exact: true })).toBeVisible();
  await badges.getByRole('button', { name: `Remove ${serverName}` }).click();
  await expect(badges).toHaveCount(0);
  await openMenu();
  await expect(page.getByRole('menuitem', { name: 'Prompts', exact: true })).toHaveCount(0);
  await expect(page.getByRole('menuitem', { name: 'Resources', exact: true })).toHaveCount(0);
});

test('MCP argument completions are optional, contextual, and debounced for prompts and templates', async ({ page }) => {
  await mockModels(page);
  const serverName = 'Suggestions fixture';
  const template = 'fixture://projects/{slug}';
  const complete = { resultType: 'complete', ttlMs: 0, cacheScope: 'private' };
  const calls: { ref: unknown; argument: { name: string; value: string }; context?: { arguments: Record<string, string> } }[] = [];
  const releaseOld = Promise.withResolvers<void>();
  const finishedOld = Promise.withResolvers<void>();
  await page.route('**/mcp-suggestions-fixture', async route => {
    const { id, method, params } = route.request().postDataJSON();
    const reply = (result: unknown) => route.fulfill({ json: { jsonrpc: '2.0', id, result } });
    if (method === 'server/discover') return reply({ supportedVersions: ['2026-07-28'], capabilities: { resources: {}, prompts: {}, completions: {} } });
    if (method === 'resources/list') return reply({ ...complete, resources: [] });
    if (method === 'resources/templates/list') return reply({ ...complete, resourceTemplates: [{ name: 'Project', uriTemplate: template }] });
    if (method === 'prompts/list') return reply({ ...complete, prompts: [{ name: 'make-prompt', title: 'Topic prompt',
      arguments: [{ name: 'topic', required: true }, { name: 'style' }] }] });
    if (method === 'completion/complete') {
      const { ref, argument, context } = params;
      calls.push({ ref, argument, context });
      const { name, value } = argument;
      if (name === 'slug') return reply({ ...complete, completion: { values: ['road map'] } });
      if (name === 'style' && value) return route.fulfill({ json: { jsonrpc: '2.0', id, error: { code: -32603, message: 'Fixture unavailable' } } });
      if (name === 'style') return reply({ ...complete, completion: { values: context?.arguments.topic === 'Spring trail' ? ['Scenic'] : [] } });
      if (value === 'old') {
        await releaseOld.promise;
        try { await reply({ ...complete, completion: { values: ['Outdated'] } }); }
        finally { finishedOld.resolve(); }
        return;
      }
      return reply({ ...complete, completion: { values: value === 'spring' ? ['Spring trail'] : ['Alpine'] } });
    }
    if (method === 'resources/read') {
      expect(params.uri).toBe('fixture://projects/road%20map');
      return reply({ ...complete, contents: [{ uri: params.uri, text: 'Attached project' }] });
    }
    if (method === 'prompts/get') {
      expect(params.arguments).toEqual({ topic: 'Spring trail', style: 'my own style' });
      return reply({ ...complete, messages: [{ role: 'user', content: { type: 'text', text: 'Prompt with a custom style' } }] });
    }
    throw new Error(`Unexpected MCP method: ${method}`);
  });
  await page.route('**/gateway/api/chat', route => route.fulfill({ contentType: 'text/event-stream',
    headers: { 'x-vercel-ai-ui-message-stream': 'v1' }, body: sse('Prompt complete', 1) }));
  await page.goto('/');
  await showSettings(page); await addKey(page); await closeSettings(page);
  await chooseChatModel(page);
  const openMenuItem = async (name: string) => {
    await page.getByRole('button', { name: 'Add to message', exact: true }).click();
    await page.getByRole('menuitem', { name, exact: true }).click();
    return page.getByRole('dialog', { name, exact: true });
  };
  const context = await openMenuItem('Model Context');
  await context.getByRole('tab', { name: 'Installed', exact: true }).click();
  await context.getByRole('button', { name: 'Add by URL' }).click();
  const editor = page.getByRole('dialog', { name: 'Add MCP server' });
  await editor.getByLabel('Name', { exact: true }).fill(serverName);
  await editor.getByLabel('URL', { exact: true }).fill(new URL('/mcp-suggestions-fixture', page.url()).href);
  await editor.getByRole('button', { name: 'Save', exact: true }).click();
  await context.getByRole('switch', { name: serverName }).check();
  await expect(context.getByText('Connected', { exact: true })).toBeVisible();
  await context.getByRole('button', { name: 'Close', exact: true }).click();
  expect(calls).toEqual([]);

  const resources = await openMenuItem('Resources');
  await resources.getByRole('button', { name: /Project/ }).click();
  const slug = resources.getByRole('combobox', { name: 'slug' });
  await expect(slug).toHaveValue('');
  await resources.getByRole('option', { name: 'road map' }).click();
  await expect(slug).toHaveValue('road map');
  expect(calls[0]).toMatchObject({ ref: { type: 'ref/resource', uri: template }, argument: { name: 'slug', value: '' } });
  await resources.getByRole('button', { name: 'Add resource' }).click();
  await expect(page.getByRole('list', { name: 'Attachments' }).getByText('Project')).toBeVisible();

  const prompts = await openMenuItem('Prompts');
  await prompts.getByRole('button', { name: /Topic prompt/ }).click();
  const topic = prompts.getByRole('combobox', { name: 'topic' });
  const style = prompts.getByRole('combobox', { name: 'style' });
  await expect(prompts.getByRole('option', { name: 'Alpine' })).toBeVisible();
  await expect(topic).toHaveValue('');
  await expect.poll(() => calls.filter(call => call.argument.value === '').map(call => call.argument.name).sort()).toEqual(['slug', 'style', 'topic']);
  try {
    await topic.fill('old');
    await expect.poll(() => calls.some(call => call.argument.value === 'old')).toBe(true);
    const aborted = page.waitForEvent('requestfailed', request => request.url().endsWith('/mcp-suggestions-fixture') &&
      request.postDataJSON()?.params?.argument?.value === 'old');
    await topic.fill('spr');
    await topic.fill('spring');
    await aborted;
    await expect(prompts.getByRole('option', { name: 'Spring trail' })).toBeVisible();
    expect(calls.filter(call => call.argument.name === 'topic').map(call => call.argument.value)).toEqual(['', 'old', 'spring']);
  } finally { releaseOld.resolve(); }
  await finishedOld.promise;
  await expect(prompts.getByRole('option', { name: 'Outdated' })).toHaveCount(0);
  await topic.press('ArrowDown');
  await topic.press('Enter');
  await expect(topic).toHaveValue('Spring trail');
  await style.focus();
  await expect(prompts.getByRole('option', { name: 'Scenic' })).toBeVisible();
  expect(calls.at(-1)).toMatchObject({ ref: { type: 'ref/prompt', name: 'make-prompt' }, argument: { name: 'style', value: '' },
    context: { arguments: { topic: 'Spring trail' } } });
  const failed = page.waitForResponse(response => response.url().endsWith('/mcp-suggestions-fixture') &&
    response.request().postDataJSON()?.params?.argument?.value === 'my own style');
  await style.fill('my own style');
  await failed;
  await expect(style).toHaveValue('my own style');
  await expect(prompts.getByRole('listbox')).toHaveCount(0);
  await prompts.getByRole('button', { name: 'Run prompt' }).click();
  await expect(page.getByText('Prompt complete', { exact: true })).toBeVisible();
});

test('OpenAI chat settings pair fields when wide and persist the encrypted reasoning opt-out', async ({ page }) => {
  await mockModels(page);
  const requests: { providerMetadata?: unknown }[] = [];
  await page.route('**/gateway/api/chat', async route => {
    requests.push(route.request().postDataJSON());
    await route.fulfill({ contentType: 'text/event-stream', headers: { 'x-vercel-ai-ui-message-stream': 'v1' }, body: sse('Opt-out reply', 1) });
  });
  await page.goto('/');
  await showSettings(page); await addKey(page); await closeSettings(page);
  await chooseChatModel(page);

  const settings = page.getByRole('dialog', { name: 'Chat settings', exact: true });
  const openAI = settings.getByRole('tabpanel', { name: 'OpenAI', exact: true });
  const encrypted = openAI.getByRole('switch', { name: 'Include encrypted reasoning', exact: true });
  async function showOpenAI() {
    await page.getByRole('button', { name: 'Chat settings', exact: true }).click();
    await settings.getByRole('tab', { name: 'OpenAI', exact: true }).click();
  }

  await showOpenAI();
  await expect(encrypted).toBeChecked();
  await expect(encrypted).toBeEnabled();
  await expect(openAI.getByRole('heading').last()).toHaveText('Other');
  for (const title of ['Reasoning', 'Apply Patch', 'Managed agent session', 'Managed environment session']) {
    const card = openAI.locator('section').filter({ has: page.getByRole('heading', { name: title, exact: true }) });
    await expect(card.locator('p')).toHaveCount(0);
  }

  await openAI.getByRole('switch', { name: 'Configure reasoning', exact: true }).check();
  await openAI.getByRole('switch', { name: 'Image generation', exact: true }).check();
  const pairs = [['Reasoning effort', 'Reasoning summary'], ['Image model', 'Image action'], ['Service tier', 'Text verbosity']];
  for (const [first, second] of pairs) {
    const left = (await openAI.getByLabel(first, { exact: true }).boundingBox())!;
    const right = (await openAI.getByLabel(second, { exact: true }).boundingBox())!;
    expect(right.x).toBeGreaterThan(left.x + left.width);
    expect(right.y).toBeCloseTo(left.y, 0);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  for (const [first, second] of pairs) {
    const top = (await openAI.getByLabel(first, { exact: true }).boundingBox())!;
    const bottom = (await openAI.getByLabel(second, { exact: true }).boundingBox())!;
    expect(bottom.x).toBeCloseTo(top.x, 0);
    expect(bottom.y).toBeGreaterThan(top.y + top.height);
  }
  await page.setViewportSize({ width: 1280, height: 720 });
  await openAI.getByRole('switch', { name: 'Configure reasoning', exact: true }).uncheck();
  await openAI.getByRole('switch', { name: 'Image generation', exact: true }).uncheck();
  await encrypted.uncheck();
  await settings.getByRole('button', { name: 'Save', exact: true }).click();
  await page.reload();
  await showSettings(page); await addKey(page); await closeSettings(page);
  await chooseChatModel(page);
  await showOpenAI();
  await expect(encrypted).not.toBeChecked();
  await settings.getByRole('button', { name: 'Close', exact: true }).click();

  const composer = page.getByRole('textbox', { name: 'Message', exact: true });
  await composer.fill('Send without encrypted reasoning.');
  await composer.press('Enter');
  await expect(page.getByText('Opt-out reply', { exact: true })).toBeVisible();
  expect(requests[0].providerMetadata).toEqual({ openai: { include: [] } });
});

test('Activity pager follows streamed items until the user navigates', async ({ page }) => {
  await mockModels(page);
  const encode = (events: object[]) => events.map(event => `data: ${JSON.stringify(event)}\n\n`).join('');
  const reasoning = (id: string, delta: string) => [
    { type: 'reasoning-start', id }, { type: 'reasoning-delta', id, delta }, { type: 'reasoning-end', id },
  ];
  await page.addInitScript(firstChunk => {
    const nativeFetch = window.fetch.bind(window);
    window.fetch = async (input, init) => {
      const path = new URL(input instanceof Request ? input.url : String(input), location.href).pathname;
      if (path !== '/gateway/api/chat') return nativeFetch(input, init);
      const body = new ReadableStream<Uint8Array>({ start(controller) {
        const encoder = new TextEncoder();
        const append = (event: Event) => {
          if (!(event instanceof CustomEvent)) return;
          const { chunk, done } = event.detail;
          controller.enqueue(encoder.encode(chunk));
          if (done) {
            window.removeEventListener('fixture-activity-chunk', append);
            controller.close();
          }
        };
        window.addEventListener('fixture-activity-chunk', append);
        controller.enqueue(encoder.encode(firstChunk));
      } });
      return new Response(body, { headers: { 'Content-Type': 'text/event-stream', 'x-vercel-ai-ui-message-stream': 'v1' } });
    };
  }, encode([
    { type: 'start', messageId: 'activity-reply' }, { type: 'start-step' }, ...reasoning('first', 'First reasoning item.'),
  ]));
  const append = (events: object[], done = false) => page.evaluate(detail => {
    window.dispatchEvent(new CustomEvent('fixture-activity-chunk', { detail }));
  }, { chunk: encode(events) + (done ? 'data: [DONE]\n\n' : ''), done });

  await page.goto('/');
  await showSettings(page); await addKey(page); await closeSettings(page);
  await chooseChatModel(page);
  const composer = page.getByRole('textbox', { name: 'Message', exact: true });
  await composer.fill('Show progress.'); await composer.press('Enter');
  const activity = page.getByRole('region', { name: 'Assistant activity' });
  await expect(activity).toContainText('First reasoning item.');

  await append([
    { type: 'tool-input-available', toolCallId: 'lookup', toolName: 'fixture_lookup', input: {}, dynamic: true, providerExecuted: true },
    { type: 'tool-output-available', toolCallId: 'lookup', output: 'Found', dynamic: true, providerExecuted: true },
  ]);
  await expect(activity).toHaveCount(1);
  await expect(activity).toContainText('2 of 2');
  await expect(activity).toContainText('fixture_lookup');
  const next = activity.getByRole('button', { name: 'Next activity' });
  await expect(next).toBeDisabled();
  await activity.getByRole('button', { name: 'Previous activity' }).click();

  await append([...reasoning('last', 'Last reasoning item.'), { type: 'finish-step' }, { type: 'finish', finishReason: 'stop' }], true);
  await expect(activity).toContainText('1 of 3');
  await expect(activity).toContainText('First reasoning item.');
  await next.click();
  await next.click();
  await expect(activity).toContainText('Last reasoning item.');
});

test('Gateway chat shares context, keeps composer reasoning through approval, and replays approved results once', async ({ page }) => {
  await mockModels(page);
  const requests: { messages: { role: string; parts: { text?: string; toolCallId?: string; output?: unknown }[] }[];
    tools?: { name: string }[]; reasoning?: string; providerMetadata?: unknown }[] = [];
  const privateText = 'An archived juniper garden';
  const catalogTool = 'local_ai_models_search';
  const historyTool = 'local_conversations_search_text';
  const betaHeaders: (string | null)[] = [];
  await page.route('**/gateway/api/chat', async route => {
    requests.push(route.request().postDataJSON());
    betaHeaders.push(await route.request().headerValue('openai-beta'));
    const stream = requests.length === 2 ? [
      { type: 'start', messageId: 'tool-batch' }, { type: 'start-step' },
      { type: 'tool-input-available', toolCallId: 'catalog-call', toolName: catalogTool, input: { query: 'imager, image', limit: 5 }, dynamic: true },
      { type: 'tool-approval-request', toolCallId: 'catalog-call', approvalId: 'catalog-review', signature: 'fixture-catalog-signature' },
      { type: 'reasoning-start', id: 'thought' }, { type: 'reasoning-delta', id: 'thought', delta: 'Check past conversations next.' },
      { type: 'reasoning-end', id: 'thought' },
      { type: 'tool-input-available', toolCallId: 'history-call', toolName: historyTool, input: { query: 'archiv, gard' }, dynamic: true },
      { type: 'tool-approval-request', toolCallId: 'history-call', approvalId: 'history-review', signature: 'fixture-history-signature' },
      { type: 'finish-step' }, { type: 'finish', finishReason: 'tool-calls' },
    ].map(event => `data: ${JSON.stringify(event)}\n\n`).join('') + 'data: [DONE]\n\n'
      : requests.length === 3 ? sse('Chat reply 3', 3).replace(/^data: [^\n]+\n\n/, '')
        : sse(`Chat reply ${requests.length}`, requests.length);
    await route.fulfill({ contentType: 'text/event-stream', headers: { 'x-vercel-ai-ui-message-stream': 'v1' }, body: stream });
  });
  await page.goto('/');
  await showSettings(page); await addKey(page); await closeSettings(page);
  await chooseChatModel(page);
  const composer = page.getByRole('textbox', { name: 'Message', exact: true });
  async function send(text: string) { await composer.fill(text); await composer.press('Enter'); }
  await send(privateText);
  await expect(page.getByText('Chat reply 1', { exact: true })).toBeVisible();
  expect(requests[0].tools).toBeUndefined();
  expect(requests[0].providerMetadata).toBeUndefined();
  expect(requests[0].reasoning).toBe('medium');
  await page.getByRole('button', { name: 'New chat', exact: true }).click();
  await expect(page.getByText('Chat reply 1', { exact: true })).toHaveCount(0);
  await chooseChatModel(page);

  const settingsButton = page.getByRole('button', { name: 'Chat settings', exact: true });
  const settings = page.getByRole('dialog', { name: 'Chat settings', exact: true });
  const contextButton = page.getByRole('button', { name: 'View context', exact: true });
  const reasoning = page.getByRole('combobox', { name: 'Reasoning level', exact: true });
  const chooseReasoning = async (label: string) => {
    if (await reasoning.evaluate(el => el.tagName === 'SELECT')) await reasoning.selectOption({ label });
    else {
      await reasoning.click();
      await page.getByRole('option', { name: label, exact: true }).click();
    }
  };
  await expect(settingsButton).toHaveText('');
  await expect(contextButton).toHaveText('');
  const sendButton = page.getByRole('button', { name: 'Send', exact: true });
  await expect(sendButton).toBeVisible();
  const contextBox = (await contextButton.boundingBox())!;
  const reasoningBox = (await reasoning.boundingBox())!;
  const sendBox = (await sendButton.boundingBox())!;
  const dictateBox = await page.getByRole('button', { name: 'Dictate', exact: true }).boundingBox({ timeout: 100 }).catch(() => null);
  expect(reasoningBox.x + reasoningBox.width).toBeLessThanOrEqual(contextBox.x);
  expect((dictateBox ?? sendBox).x - contextBox.x - contextBox.width).toBeLessThan(12);
  expect(sendBox.x).toBeGreaterThan(contextBox.x);
  await reasoning.hover();
  await expect(page.getByRole('tooltip')).toHaveText('Reasoning level');
  await settingsButton.click();
  const general = settings.getByRole('tabpanel', { name: 'General' });
  await expect(general.getByRole('heading', { name: 'Chat', exact: true })).toBeVisible();
  const delay = general.getByRole('slider');
  await expect(delay).toHaveValue('40');
  await delay.press('End');
  await expect(delay).toHaveValue('1000');
  await settings.getByRole('tab', { name: 'General' }).press('ArrowRight');
  const ai = settings.getByRole('switch', { name: 'Artificial Intelligence' });
  const history = settings.getByRole('switch', { name: 'Chat History' });
  await expect(settings.getByText('Chat History shares text', { exact: false })).toHaveCount(0);
  await expect(ai).not.toBeChecked();
  await expect(history).not.toBeChecked();
  await ai.check(); await history.check();
  await settings.getByRole('tab', { name: 'OpenAI', exact: true }).click();
  await settings.getByLabel('Service tier', { exact: true }).selectOption('flex');
  await settings.getByRole('switch', { name: 'Configure reasoning', exact: true }).check();
  await settings.getByLabel('Reasoning effort', { exact: true }).selectOption('xhigh');
  await settings.getByLabel('Reasoning context', { exact: true }).selectOption('all_turns');
  await settings.getByRole('button', { name: 'Add compaction rule', exact: true }).click();
  await settings.getByRole('spinbutton', { name: 'Compaction threshold', exact: true }).fill('4096');
  await settings.getByRole('switch', { name: 'Enable multi-agent responses', exact: true }).check();
  await settings.getByRole('spinbutton', { name: 'Maximum concurrent subagents', exact: true }).fill('4');
  await settings.getByRole('switch', { name: 'Web search', exact: true }).check();
  await settings.getByLabel('Allowed web domains', { exact: true }).fill('example.org\nexample.net');
  await settings.getByRole('switch', { name: 'Include web sources', exact: true }).check();
  await settings.getByRole('switch', { name: 'Shell', exact: true }).check();
  await settings.getByRole('button', { name: 'Add skill reference', exact: true }).click();
  await settings.getByLabel('OpenAI skill ID', { exact: true }).fill('skill_reference_fixture');
  await settings.getByRole('switch', { name: 'Apply Patch', exact: true }).check();
  await settings.getByRole('switch', { name: 'Configure managed agent', exact: true }).check();
  await settings.getByLabel('Session agent model', { exact: true }).fill('session-only');
  await settings.getByRole('button', { name: 'Save', exact: true }).click();
  const badges = page.getByRole('list', { name: 'Active chat context' });
  await expect(badges.getByText('Artificial Intelligence', { exact: true })).toBeVisible();
  await expect(badges.getByText('Chat History', { exact: true })).toBeVisible();

  await contextButton.click();
  const context = page.getByRole('dialog', { name: 'Context', exact: true });
  const contextParts = requests[0].messages[0].parts.map(part => part.text ?? '');
  const [system, user] = contextParts.filter(text => text.startsWith('{')).map(text => JSON.parse(text));
  const systemPanel = context.getByRole('tabpanel', { name: 'System' });
  await systemPanel.getByRole('button', { name: 'Expand all' }).click();
  await expect(systemPanel.getByRole('tree', { name: 'JSON' })).toContainText(system.systemInformation.timezone);
  await context.getByRole('tab', { name: 'System', exact: true }).press('ArrowRight');
  await expect(context.getByRole('tabpanel', { name: 'User' }).getByRole('tree', { name: 'JSON' })).toContainText(user.preferredLanguage);
  await context.getByRole('tab', { name: 'User', exact: true }).press('End');
  const toolPanel = context.getByRole('tabpanel', { name: 'Tools (8)' });
  await expect(toolPanel.getByRole('heading')).toHaveCount(8);
  const catalogCard = toolPanel.locator('section').filter({ has: page.getByRole('heading', { name: catalogTool, exact: true }) });
  await expect(catalogCard).toContainText('Search models and capabilities');
  await catalogCard.getByText('Input schema').click();
  await catalogCard.getByRole('button', { name: 'Expand all' }).click();
  await expect(catalogCard.getByRole('tree', { name: 'JSON' })).toContainText('query');
  await context.getByRole('button', { name: 'Close' }).click();
  await chooseReasoning('Medium');
  await send('Find earlier conversations and current models.');
  const review = page.getByRole('dialog', { name: 'Review tool result' });
  await expect(review.getByRole('tab', { name: 'Structured' })).toHaveAttribute('aria-selected', 'true');
  await expect(review.getByRole('tab', { name: 'Output' })).toHaveCount(0);
  const structuredResult = review.getByRole('tabpanel', { name: 'Structured' });
  await structuredResult.getByRole('button', { name: 'Expand all' }).click();
  await expect(structuredResult).toContainText('imagerouter/a/b');
  expect(requests.length).toBe(2);
  expect(requests[1]).not.toHaveProperty('clientToolResultApproval');
  expect(requests[1].reasoning).toBe('medium');
  expect(JSON.stringify(requests[1])).not.toContain(privateText);
  expect(requests[1].messages.filter(message => message.role === 'system')).toHaveLength(1);
  expect(requests[1].messages[0].parts.map(part => part.text)).toEqual(contextParts);
  await review.getByRole('button', { name: 'Approve and share' }).click();
  await expect(review).toContainText(historyTool);
  await structuredResult.getByRole('button', { name: 'Expand all' }).click();
  await expect(structuredResult).toContainText(privateText);
  expect(requests).toHaveLength(2);
  await review.getByRole('tab', { name: 'Input', exact: true }).click();
  await expect(review.getByRole('tabpanel', { name: 'Input' })).toContainText('archiv, gard');
  await review.getByRole('button', { name: 'Approve and share' }).click();
  await expect(page.getByText('Chat reply 3', { exact: true })).toBeVisible();
  expect(requests).toHaveLength(3);
  expect(requests[2].reasoning).toBe('medium');
  expect(betaHeaders).toEqual([null, 'responses_multi_agent=v1', 'responses_multi_agent=v1']);
  for (const request of requests.slice(1)) expect(request.providerMetadata).toEqual({ openai: {
    service_tier: 'flex', reasoning: { effort: 'xhigh', context: 'all_turns', summary: 'auto', mode: 'standard' },
    context_management: [{ type: 'compaction', compact_threshold: 4096 }], multi_agent: { enabled: true, max_concurrent_subagents: 4 },
    include: ['web_search_call.action.sources', 'reasoning.encrypted_content'], tools: [
      { type: 'web_search', search_context_size: 'medium', filters: { allowed_domains: ['example.org', 'example.net'] } },
      { type: 'shell', environment: { type: 'container_auto', skills: [{ type: 'skill_reference', skill_id: 'skill_reference_fixture' }] } },
      { type: 'apply_patch' },
    ],
  } });
  expect(requests[2].messages.at(-1)?.parts).toEqual(expect.arrayContaining([
    expect.objectContaining({ toolCallId: 'catalog-call', approval: { id: 'catalog-review', signature: 'fixture-catalog-signature', approved: true },
      output: { content: [], structuredContent: { data: [expect.objectContaining({ id: 'imagerouter/a/b' })] } } }),
    expect.objectContaining({ toolCallId: 'history-call', approval: { id: 'history-review', signature: 'fixture-history-signature', approved: true },
      output: { content: [], structuredContent: expect.objectContaining({
      results: [expect.objectContaining({ snippet: privateText })],
    }) } }),
  ]));
  expect(requests[2].messages.filter(message => message.role === 'system')).toHaveLength(1);
  const activity = page.getByRole('region', { name: 'Assistant activity' });
  await expect(activity).toHaveCount(1);
  await expect(activity).toContainText(historyTool);
  await expect(activity).toContainText('3 of 3');
  await expect(activity.getByRole('tab', { name: 'Input' })).toHaveAttribute('aria-selected', 'true');
  await activity.getByRole('tab', { name: 'Structured' }).click();
  await activity.getByRole('button', { name: 'Previous activity' }).click();
  await expect(activity).toContainText('Check past conversations next.');
  await expect(activity.getByRole('tablist')).toHaveCount(0);
  await activity.getByRole('button', { name: 'Previous activity' }).click();
  await expect(activity).toContainText(catalogTool);
  await expect(activity.getByRole('tab', { name: 'Input' })).toHaveAttribute('aria-selected', 'true');

  await settingsButton.click();
  await settings.getByRole('tab', { name: 'Tools' }).click();
  await history.uncheck();
  await settings.getByRole('button', { name: 'Close', exact: true }).click();
  await chooseReasoning('None');
  await send('Continue without the history plugin.');
  await expect(page.getByText('Chat reply 4', { exact: true })).toBeVisible();
  expect(requests[3].tools).toHaveLength(5);
  expect(requests[3]).not.toHaveProperty('reasoning');
  expect(JSON.stringify(requests[3])).not.toContain(privateText);
  expect(JSON.stringify(requests[3])).not.toContain('history-call');
  expect(requests[3].messages.filter(message => message.role === 'system')).toHaveLength(1);
  await chooseReasoning('Low');
  await page.reload();
  await expect.poll(() => reasoning.evaluate(el => el instanceof HTMLSelectElement
    ? el.selectedOptions[0]?.textContent : el.textContent?.trim())).toBe('Low');
});

async function openRoute(page: Page, group?: 'Gateway' | 'Direct' | 'Decisions') {
  await page.getByRole('button', { name: 'Account menu', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Route', exact: true }).press('ArrowRight');
  if (group) await page.getByRole('menuitem', { name: group, exact: true }).press('ArrowRight');
}

test('Images uses explicit routes and persists compatible records only for the current profile', async ({ page }) => {
  const modelId = 'openai/gpt-image-1';
  const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a/l8AAAAASUVORK5CYII=';
  const imageResponse = { images: [png], warnings: [{ type: 'other', message: 'The image was resized.' }],
    response: { modelId, timestamp: '2026-01-01T00:00:00.000Z', headers: { 'x-provider-request-id': 'orchard-request' } },
    providerMetadata: { gateway: { cost: 0 } } };
  const paths: string[] = [];
  await page.route('**/gateway/v1/models', route => route.fulfill({ json: { data: [{ id: model }, { id: modelId, type: 'image' }] } }));
  await page.route('**/gateway/v1/skills?*', route => route.fulfill({ json: { data: [], has_more: false } }));
  await page.route(/\/gateway\/(api\/images|v1\/images\/(edits|generations))$/, async route => {
    expect(await route.request().headerValue('x-openai-key')).toBe(fakeKey);
    const path = new URL(route.request().url()).pathname.replace('/gateway', '');
    paths.push(path);
    if (path === '/api/images') {
      expect(route.request().postDataJSON()).toEqual({ model: modelId, prompt: 'An orchard', n: 1 });
      await route.fulfill({ json: imageResponse });
    } else if (path.endsWith('/generations')) {
      expect(route.request().postDataJSON()).toEqual({ model: modelId, prompt: 'A harbor', n: 1 });
      await route.fulfill({ json: { created: 1767312000, data: [{ b64_json: png }] } });
    } else {
      expect(route.request().postDataJSON()).toEqual({ model: modelId, prompt: 'Make it brighter', n: 1, images: [
        { image_url: `data:image/png;base64,${png}` }, { image_url: 'https://example.org/reference.png' },
      ] });
      await route.fulfill({ json: { created: 1767398400, data: [{ b64_json: png }], usage: { input_tokens: 4, output_tokens: 8, total_tokens: 12 } } });
    }
  });
  await page.goto('/');
  await showSettings(page); await addKey(page);
  const panel = page.getByRole('region', { name: 'Encrypted storage', exact: true });
  await panel.getByRole('button', { name: 'Set up encrypted storage' }).click();
  await page.getByLabel('Vault passphrase').fill(passphrase);
  await page.getByLabel('Confirm passphrase').fill(passphrase);
  await page.getByRole('button', { name: 'Enable encrypted storage' }).click();
  await expect(page.getByText('Encrypted storage is on.')).toBeVisible();
  await closeSettings(page);
  await chooseChatModel(page);
  await openRoute(page);
  await expect(page.getByRole('menuitem', { name: 'Images', exact: true })).toHaveCount(0);
  await expect(page.getByRole('menuitemradio', { name: '/api/images', exact: true })).toHaveCount(0);
  await page.keyboard.press('Escape');
  expect(await page.evaluate(async () => (await indexedDB.databases()).map(db => db.name))).not.toContain('streaik-images');
  const imagesPage = page.getByRole('button', { name: 'Images', exact: true });
  const top = page.getByRole('form', { name: 'Image composer', exact: true });
  const gallery = page.getByRole('region', { name: 'My images' });
  const generated = gallery.getByRole('img', { name: 'Generated image' });
  const choose = async (endpoint: string) => {
    await openRoute(page);
    await page.getByRole('menuitemradio', { name: endpoint, exact: true }).click();
  };
  await imagesPage.click();
  await expect(page.getByRole('heading', { name: 'Images', exact: true })).toBeVisible();
  await chooseModel(page, 'gpt-image-1');
  await openRoute(page);
  await expect(page.getByRole('menuitemradio', { name: '/api/images', exact: true })).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByRole('menuitemradio', { name: /\/v1\/images\/(generations|edits)/ })).toHaveCount(2);
  await expect(page.getByRole('menuitemradio', { name: '/api/chat', exact: true })).toHaveCount(0);
  await expect(page.getByRole('menuitem', { name: /^(Gateway|Direct|Images)$/ })).toHaveCount(0);
  await page.keyboard.press('Escape');
  const defaultSettings = await showSettings(page);
  const general = defaultSettings.getByRole('tabpanel', { name: 'General', exact: true });
  await expect(general.getByLabel('Image route', { exact: true })).toHaveCount(0);
  await expect(general.getByLabel('Transcription route', { exact: true })).toHaveCount(0);
  await closeSettings(page);
  await top.getByRole('textbox', { name: 'Image prompt' }).fill('An orchard');
  await expect(page.getByRole('textbox', { name: 'Image prompt' })).toHaveCount(1);
  await top.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(generated).toHaveCount(1);
  await expect(page.getByText('The image was resized.', { exact: true })).toBeVisible();
  const orchard = gallery.getByRole('button', { name: 'Open image preview' }).first();
  await expect(orchard).toContainText(modelId);
  await expect(orchard).toContainText('$0.00');
  await orchard.press('Enter');
  const imagePreview = page.getByRole('dialog', { name: 'Image preview' });
  const previewTab = imagePreview.getByRole('tab', { name: 'Preview', exact: true });
  await expect(previewTab).toHaveAttribute('aria-selected', 'true');
  await expect(imagePreview.getByRole('img', { name: 'Generated image' })).toHaveAttribute('src', `data:image/png;base64,${png}`);
  await previewTab.press('ArrowRight');
  const headersTab = imagePreview.getByRole('tab', { name: 'Response headers' });
  await expect(headersTab).toBeFocused();
  await expect(headersTab).toHaveAttribute('aria-selected', 'true');
  await expect(imagePreview.getByRole('tabpanel', { name: 'Response headers' })).toContainText('orchard-request');
  await page.keyboard.press('Escape');
  await expect(imagePreview).toBeHidden();
  await expect(orchard).toBeFocused();
  await expect(top.getByRole('textbox', { name: 'Image prompt' })).toHaveValue('');
  await choose('/v1/images/generations');
  await top.getByRole('textbox', { name: 'Image prompt' }).fill('A harbor');
  await top.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(generated).toHaveCount(2);
  const harbor = gallery.getByRole('button', { name: 'Open image preview' }).first();
  await expect(harbor).not.toContainText('$');
  await harbor.click();
  await expect(previewTab).toHaveAttribute('aria-selected', 'true');
  await headersTab.click();
  await expect(imagePreview.getByText('No response headers were recorded.')).toBeVisible();
  await imagePreview.getByRole('button', { name: 'Close' }).click();
  await choose('/v1/images/edits');
  await expect(page.getByText('Add a reference image to edit.')).toBeVisible();
  await top.getByRole('textbox', { name: 'Image prompt' }).fill('Make it brighter');
  await expect(top.getByRole('button', { name: 'Send', exact: true })).toBeDisabled();
  await expect(top.getByRole('button', { name: 'Files', exact: true })).toHaveCount(0);
  await top.getByRole('button', { name: 'Add attachments' }).click();
  const picking = page.waitForEvent('filechooser');
  await top.getByRole('menuitem', { name: 'Files', exact: true }).click();
  await (await picking).setFiles({ name: 'seed.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64') });
  await top.getByRole('button', { name: 'Add attachments' }).click();
  await top.getByRole('menuitem', { name: 'Link', exact: true }).click();
  const addLink = page.getByRole('dialog', { name: 'Link', exact: true });
  await addLink.getByLabel('URL', { exact: true }).fill('https://example.org/reference.png');
  await addLink.getByRole('button', { name: 'Add', exact: true }).click();
  await top.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(generated).toHaveCount(3);
  await expect(top.getByRole('button', { name: 'Add attachments' })).toBeEnabled();
  expect(paths).toEqual(['/api/images', '/v1/images/generations', '/v1/images/edits']);

  const records = await page.evaluate(() => new Promise<any[]>((resolve, reject) => {
    const open = indexedDB.open('streaik-images');
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result;
      const tx = db.transaction('images');
      const request = tx.objectStore('images').getAll();
      tx.oncomplete = () => { db.close(); resolve(request.result); };
      tx.onabort = () => { db.close(); reject(tx.error); };
    };
  }));
  expect(records).toHaveLength(3);
  expect(records).toContainEqual({ id: expect.any(String), imageResponse });
  expect(records).toContainEqual({ id: expect.any(String), imageResponse: {
    images: [png], warnings: [], response: { modelId, timestamp: '2026-01-03T00:00:00.000Z' },
    usage: { inputTokens: 4, outputTokens: 8, totalTokens: 12 },
  } });
  await page.reload();
  await imagesPage.click();
  await expect(gallery).toBeVisible();
  await expect(generated).toHaveCount(0);
  await openRoute(page);
  await expect(page.getByRole('menuitemradio', { name: '/api/images', exact: true })).toHaveAttribute('aria-checked', 'true');
  await page.keyboard.press('Escape');
  await showSettings(page);
  await page.getByRole('tab', { name: 'API keys', exact: true }).click();
  await page.getByLabel('Vault passphrase').fill(passphrase);
  await page.getByRole('button', { name: 'Unlock vault' }).click();
  await expect(page.getByText('Vault unlocked.')).toBeVisible();
  await closeSettings(page);
  await imagesPage.click();
  await expect(generated).toHaveCount(3);
  await openRoute(page);
  await expect(page.getByRole('menuitemradio', { name: '/v1/images/edits', exact: true })).toHaveAttribute('aria-checked', 'true');
});

test('Images settings set the request count and show matching gallery shimmers beneath one composer', async ({ page }) => {
  const values: unknown[] = [];
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  const imageModel = 'openai/gpt-image-1';
  const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a/l8AAAAASUVORK5CYII=';
  await page.route('**/gateway/v1/models', route => route.fulfill({ json: { data: [{ id: model }, { id: imageModel, type: 'image' }] } }));
  await page.route('**/gateway/v1/skills?*', route => route.fulfill({ json: { data: [], has_more: false } }));
  await page.route('**/gateway/api/images', async route => {
    const body = route.request().postDataJSON();
    values.push(body);
    if (values.length === 1) await held;
    await route.fulfill({ json: { images: Array(body.n).fill(png), warnings: [], response: { modelId: imageModel, timestamp: new Date().toISOString() } } });
  });
  await page.goto('/');
  await showSettings(page); await addKey(page); await closeSettings(page);
  await chooseChatModel(page);
  const chatPicker = await modelPicker(page).boundingBox();
  await page.getByRole('button', { name: 'Images', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Images', exact: true })).toBeVisible();
  const picker = modelPicker(page);
  await expect(picker).toBeEnabled();
  const imagePicker = await picker.boundingBox();
  expect(imagePicker?.x).toBeCloseTo(chatPicker!.x, 0);
  expect(imagePicker?.y).toBeCloseTo(chatPicker!.y, 0);
  await chooseModel(page, 'gpt-image-1');
  const prompt = page.getByRole('textbox', { name: 'Image prompt', exact: true });
  await expect(prompt).toHaveCount(1);
  const settingsButton = page.getByRole('button', { name: 'Image settings', exact: true });
  await settingsButton.click();
  const settings = page.getByRole('dialog', { name: 'Image settings' });
  await settings.getByLabel('Image size').fill('1024x1024');
  await settings.getByLabel('Number of images').fill('3');
  await settings.getByLabel('Max images per call').fill('2');
  await settings.getByRole('tab', { name: 'OpenAI', exact: true }).click();
  await settings.getByLabel('Quality').selectOption('high');
  await settings.getByLabel('Output format').selectOption('png');
  await settings.getByRole('button', { name: 'Save image settings', exact: true }).click();
  await prompt.fill('A blue bird');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  const gallery = page.getByRole('region', { name: 'My images' });
  const shimmers = gallery.locator('.image-shimmer');
  await expect(shimmers).toHaveCount(3);
  const sizes = await shimmers.evaluateAll(tiles => tiles.map(tile => [tile.clientWidth, tile.clientHeight]));
  expect(sizes.every(([width, height]) => width > 0 && width === height && width === sizes[0][0])).toBeTruthy();
  release();
  const images = gallery.getByRole('img', { name: 'Generated image' });
  await expect(images).toHaveCount(3);
  await expect(shimmers).toHaveCount(0);
  const completed = await images.first().boundingBox();
  expect(completed?.width).toBeCloseTo(sizes[0][0], 0);
  expect(completed?.height).toBeCloseTo(sizes[0][1], 0);
  expect(values).toEqual([2, 1].map(n => ({ model: imageModel, prompt: 'A blue bird', n, size: '1024x1024', providerOptions: { openai: { quality: 'high', output_format: 'png' } } })));
  await settingsButton.click();
  await expect(settings.getByLabel('Number of images')).toHaveValue('3');
  await settings.getByRole('button', { name: 'Restore defaults' }).click();
  await expect(settings.getByLabel('Number of images')).toHaveValue('1');
  await expect(settings.getByLabel('Image size')).toHaveValue('');
  await settings.getByRole('tab', { name: 'OpenAI', exact: true }).click();
  await expect(settings.getByLabel('Quality')).toHaveValue('');
  await settings.getByRole('button', { name: 'Save image settings', exact: true }).click();
});

test('Images clears shimmers on stop and on gateway failure while retaining the prompt', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const imageModel = 'openai/gpt-image-1';
  await page.route('**/gateway/v1/models', route => route.fulfill({ json: { data: [{ id: model }, { id: imageModel, type: 'image' }] } }));
  await page.route('**/gateway/v1/skills?*', route => route.fulfill({ json: { data: [], has_more: false } }));
  let fail!: () => void;
  const failure = new Promise<void>(resolve => { fail = resolve; });
  await page.route('**/gateway/api/images', async route => {
    const { prompt } = route.request().postDataJSON();
    if (prompt === 'Stop this one') return;
    await failure;
    await route.fulfill({ status: 502 });
  });
  await page.goto('/');
  await showSettings(page); await addKey(page); await closeSettings(page);
  await page.getByRole('button', { name: 'Images', exact: true }).click();
  const prompt = page.getByRole('textbox', { name: 'Image prompt' });
  const send = page.getByRole('button', { name: 'Send', exact: true });
  const shimmers = page.locator('.image-shimmer');
  await chooseModel(page, 'gpt-image-1');
  await prompt.fill('Stop this one');
  await send.click();
  await expect(shimmers).toHaveCount(1);
  expect(await shimmers.evaluate(tile => getComputedStyle(tile, '::after').animationName)).toBe('none');
  const stop = page.getByRole('button', { name: 'Stop', exact: true });
  await expect(stop).toHaveText('');
  await expect(stop.locator('svg.lucide-square')).toBeVisible();
  await stop.click();
  await expect(shimmers).toHaveCount(0);
  await expect(prompt).toHaveValue('Stop this one');
  await prompt.fill('Fail this one');
  await send.click();
  await expect(shimmers).toHaveCount(1);
  fail();
  await expect(shimmers).toHaveCount(0);
  await expect(prompt).toHaveValue('Fail this one');
  await expect(page.getByRole('alert')).toContainText('HTTP 502');
});

const imagePng = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a/l8AAAAASUVORK5CYII=';
const imagen = 'google/imagen-4';
const gptImage1 = 'openai/gpt-image-1';
const gptImage2 = 'openai/gpt-image-2';

async function prepareImageDecisions(page: Page, useDirectChat = false) {
  await page.route('**/gateway/v1/models', route => route.fulfill({ json: { data: [
    { id: model }, { id: 'openai/gpt-6-luna', type: 'decision' },
    { id: imagen, type: 'image', name: 'Imagen' }, { id: gptImage1, type: 'image', name: 'GPT Image 1' },
    { id: gptImage2, type: 'image', name: 'GPT Image 2', description: 'An image editor.' },
    { id: 'openai/other-image', type: 'image', name: 'Other Image' },
    { id: 'imagerouter/vendor/image', type: 'image', name: 'ImageRouter image' },
    { id: 'openrouter/vendor/image', type: 'image', name: 'OpenRouter image' },
  ] } }));
  await page.route('**/gateway/v1/skills?*', route => route.fulfill({ json: { data: [], has_more: false } }));
  await page.goto('/');
  await showSettings(page); await addKey(page); await closeSettings(page);
  if (useDirectChat) {
    await page.route('https://api.openai.com/v1/models', route => route.fulfill({ json: { data: [{ id: 'gpt-4.1-mini' }] } }));
    await openRoute(page, 'Direct');
    await page.getByRole('menuitemradio', { name: '/v1/responses', exact: true }).click();
    await chooseChatModel(page);
  }
  await page.getByRole('button', { name: 'Images', exact: true }).click();
  await expect(modelPicker(page)).toHaveText('Select models');
  await modelPicker(page).click();
  await expect(page.getByRole('listbox', { name: 'Model' })).toHaveAttribute('aria-multiselectable', 'true');
  await expect(page.getByRole('option', { name: 'gpt-6-luna', exact: true })).toHaveCount(0);
  await page.getByRole('option', { name: 'Imagen', exact: true }).click();
  await page.getByRole('option', { name: 'GPT Image 1', exact: true }).click();
  await page.getByRole('option', { name: 'GPT Image 2', exact: true }).click();
  await page.keyboard.press('Escape');
  await expect(modelPicker(page)).toHaveText('imagen-4, gpt-image-1, gpt-image-2');
}

test('Images routes checked models through the shared agent and generates with the winner’s settings', async ({ page }) => {
  const calls: string[] = [];
  const requests: unknown[] = [];
  const reference = 'https://example.org/private-reference.png';
  for (const endpoint of ['/v1/decisions', '/api/decisions']) {
    await page.route(`**/gateway${endpoint}`, async route => {
      calls.push(endpoint);
      expect(await route.request().headerValue('x-openai-key')).toBe(fakeKey);
      const body = route.request().postDataJSON();
      expect(body.model).toBe('openai/gpt-6-luna');
      const v1 = endpoint === '/v1/decisions';
      const question = v1 ? body.questions[0] : body.questions.chat_model;
      expect(question.instructions).toContain('Choose one offered model');
      const choices: Record<string, string> = v1 ? Object.fromEntries(question.choices.map(({ value, description }: { value: string; description: string }) => [value, description])) : question.criteria;
      expect(Object.keys(choices)).toEqual(v1 ? [imagen, gptImage1, gptImage2] : [gptImage1, gptImage2]);
      expect(JSON.parse(choices[gptImage2])).toMatchObject({ provider: 'openai', description: 'An image editor.' });
      const input = v1 ? body.input : body.state;
      expect(input).not.toContain(reference);
      expect(JSON.parse(input)).toMatchObject(v1
        ? { prompt: 'A blue bird', operation: 'generate', route: '/v1/images/generations', references: 0 }
        : { prompt: 'Make it brighter', operation: 'edit', route: '/v1/images/edits', references: 1 });
      const answer = { type: 'choice', choice: gptImage2 };
      await route.fulfill({ json: { answers: v1 ? [{ ...answer, name: 'chat_model' }] : { chat_model: answer } } });
    });
  }
  await page.route(/\/gateway\/v1\/images\/(edits|generations)$/, async route => {
    const body = route.request().postDataJSON();
    requests.push(body);
    await route.fulfill({ json: { data: Array(body.n).fill({ b64_json: imagePng }) } });
  });
  await prepareImageDecisions(page, true);
  const composer = page.getByRole('form', { name: 'Image composer' });
  const prompt = composer.getByRole('textbox', { name: 'Image prompt' });
  const generated = page.getByRole('img', { name: 'Generated image' });
  const send = async (text: string, count: number) => {
    await prompt.fill(text);
    await composer.getByRole('button', { name: 'Send', exact: true }).click();
    await expect(generated).toHaveCount(count);
    await expect(prompt).toHaveValue('');
  };
  const toggleRouters = async () => {
    await modelPicker(page).click();
    await page.getByRole('option', { name: 'ImageRouter image', exact: true }).click();
    await page.getByRole('option', { name: 'OpenRouter image', exact: true }).click();
    await page.keyboard.press('Escape');
  };
  await toggleRouters();
  await composer.getByRole('button', { name: 'Image settings' }).click();
  const imageSettings = page.getByRole('dialog', { name: 'Image settings' });
  await imageSettings.getByLabel('Number of images').fill('5');
  await imageSettings.getByLabel('Aspect ratio').fill('16:9');
  await expect(imageSettings.getByRole('combobox', { name: 'Image model', exact: true })).toHaveCount(0);
  await imageSettings.getByRole('tab', { name: 'Google Gemini', exact: true }).click();
  await imageSettings.getByRole('tabpanel', { name: 'Google Gemini', exact: true }).getByLabel('Output format').selectOption('jpeg');
  await imageSettings.getByRole('tab', { name: 'ImageRouter', exact: true }).click();
  await imageSettings.getByRole('tabpanel', { name: 'ImageRouter', exact: true }).getByLabel('Quality').selectOption('low');
  await imageSettings.getByRole('tab', { name: 'OpenRouter', exact: true }).click();
  await imageSettings.getByRole('tabpanel', { name: 'OpenRouter', exact: true }).getByLabel('Quality').selectOption('medium');
  await imageSettings.getByRole('tab', { name: 'OpenAI', exact: true }).click();
  await imageSettings.getByRole('tabpanel', { name: 'OpenAI', exact: true }).getByLabel('Quality').selectOption('high');
  await imageSettings.getByRole('button', { name: 'Save image settings', exact: true }).click();

  await openRoute(page);
  await page.getByRole('menuitemradio', { name: '/v1/images/generations', exact: true }).click();
  await composer.getByRole('button', { name: 'Image settings' }).click();
  await expect(imageSettings.getByRole('tabpanel', { name: 'General', exact: true }).getByLabel('Quality')).toHaveValue('high');
  await expect(imageSettings.getByRole('tab', { name: 'OpenAI', exact: true })).toHaveCount(0);
  await expect(imageSettings.getByLabel('Edit mask')).toHaveCount(0);
  await imageSettings.getByRole('tab', { name: 'Google Gemini', exact: true }).click();
  await expect(imageSettings.getByRole('tabpanel', { name: 'Google Gemini', exact: true }).getByLabel('Output format')).toHaveValue('jpeg');
  await imageSettings.getByRole('tab', { name: 'ImageRouter', exact: true }).click();
  await expect(imageSettings.getByRole('tabpanel', { name: 'ImageRouter', exact: true }).getByLabel('Quality')).toHaveValue('low');
  await imageSettings.getByRole('tab', { name: 'OpenRouter', exact: true }).click();
  await expect(imageSettings.getByRole('tabpanel', { name: 'OpenRouter', exact: true }).getByLabel('Quality')).toHaveValue('medium');
  await imageSettings.getByRole('button', { name: 'Cancel', exact: true }).click();
  await toggleRouters();
  await send('A blue bird', 5);
  await openRoute(page, 'Decisions');
  await page.getByRole('menuitemradio', { name: '/api/decisions', exact: true }).click();
  await openRoute(page);
  await page.getByRole('menuitemradio', { name: '/v1/images/edits', exact: true }).click();
  await composer.getByRole('button', { name: 'Add attachments' }).click();
  await composer.getByRole('menuitem', { name: 'Link', exact: true }).click();
  const link = page.getByRole('dialog', { name: 'Link', exact: true });
  await link.getByLabel('URL', { exact: true }).fill(reference);
  await link.getByRole('button', { name: 'Add', exact: true }).click();
  await send('Make it brighter', 10);
  expect(requests).toEqual([
    { model: gptImage2, prompt: 'A blue bird', n: 5, quality: 'high' },
    { model: gptImage2, prompt: 'Make it brighter', n: 5, quality: 'high', images: [{ image_url: reference }] },
  ]);
  await openRoute(page, 'Decisions');
  await page.getByRole('menuitemradio', { name: 'Off', exact: true }).click();
  await modelPicker(page).click();
  await expect(page.getByRole('listbox', { name: 'Model' })).not.toHaveAttribute('aria-multiselectable', 'true');
  await page.getByRole('option', { name: 'GPT Image 1', exact: true }).click();
  await expect(page.getByRole('listbox', { name: 'Model' })).toBeHidden();
  await openRoute(page);
  await page.getByRole('menuitemradio', { name: '/v1/images/generations', exact: true }).click();
  await send('Use a manual pick', 15);
  expect(requests.at(-1)).toMatchObject({ model: gptImage1 });
  expect(calls).toEqual(['/v1/decisions', '/api/decisions']);

  await openCatalog(page, 'Models');
  await page.getByRole('button', { name: 'Account menu', exact: true }).click();
  await expect(page.getByRole('menuitem', { name: 'Route', exact: true })).toHaveCount(0);
});

test('edit masks stay visible for Google and warn instead of silently losing the mask', async ({ page }) => {
  const gemini = 'google/gemini-2.5-flash-image';
  await page.route('**/gateway/v1/models', route => route.fulfill({ json: { data: [{ id: model }, { id: gemini, type: 'image' }] } }));
  await page.route('**/gateway/v1/skills?*', route => route.fulfill({ json: { data: [], has_more: false } }));
  await page.goto('/');
  await showSettings(page); await addKey(page); await closeSettings(page);
  await page.getByRole('button', { name: 'Images', exact: true }).click();
  await chooseModel(page, 'gemini-2.5-flash-image');
  const composer = page.getByRole('form', { name: 'Image composer' });
  await composer.getByRole('textbox', { name: 'Image prompt' }).fill('Make it brighter');
  await composer.getByRole('button', { name: 'Image settings' }).click();
  const settings = page.getByRole('dialog', { name: 'Image settings' });
  const mask = settings.getByLabel('Edit mask');
  await expect(mask).toBeVisible();
  await mask.setInputFiles({ name: 'mask.png', mimeType: 'image/png', buffer: Buffer.from(imagePng, 'base64') });
  const warning = 'None of the selected models support image masks.';
  await expect(settings.getByText(warning, { exact: true })).toBeVisible();
  await settings.getByRole('button', { name: 'Save image settings', exact: true }).click();
  await expect(page.getByText(warning, { exact: true })).toBeVisible();
  const send = composer.getByRole('button', { name: 'Send', exact: true });
  await expect(send).toBeDisabled();
  await openRoute(page);
  await page.getByRole('menuitemradio', { name: '/v1/images/generations', exact: true }).click();
  await expect(page.getByText('Remove the mask or choose an image edit route.', { exact: true })).toBeVisible();
  await composer.getByRole('button', { name: 'Image settings' }).click();
  await settings.getByRole('button', { name: 'Remove mask.png', exact: true }).click();
  await settings.getByRole('button', { name: 'Save image settings', exact: true }).click();
  await expect(send).toBeEnabled();
});

test('Images retains its draft when the decision is invalid or stopped', async ({ page }) => {
  let calls = 0;
  let imageCalls = 0;
  const response = Promise.withResolvers<void>();
  await page.route('**/gateway/api/images', route => { imageCalls++; return route.abort(); });
  await page.route('**/gateway/v1/decisions', async route => {
    const attempt = ++calls;
    if (attempt > 1) await response.promise;
    await route.fulfill({ json: { answers: [{ name: 'chat_model', type: 'choice', choice: attempt === 1 ? 'openai/other-image' : gptImage2 }] } }).catch(() => {});
  });
  await prepareImageDecisions(page);
  const prompt = page.getByRole('textbox', { name: 'Image prompt' });
  const send = page.getByRole('button', { name: 'Send', exact: true });
  await prompt.fill('Keep this draft');
  await send.click();
  await expect(page.getByRole('alert')).toContainText('Decisions did not return one of the selected models.');
  await expect(prompt).toHaveValue('Keep this draft');
  const deciding = page.waitForRequest('**/gateway/v1/decisions');
  await send.click();
  await deciding;
  try {
    await expect(page.getByText('Choosing a model…', { exact: true })).toBeVisible();
    await expect(modelPicker(page)).toBeDisabled();
    await expect(page.locator('.image-shimmer')).toHaveCount(0);
    await page.getByRole('button', { name: 'Stop', exact: true }).click();
    await expect(send).toBeEnabled();
    await expect(prompt).toHaveValue('Keep this draft');
    await expect(page.getByRole('alert')).toHaveCount(0);
  } finally { response.resolve(); }
  expect(calls).toBe(2);
  expect(imageCalls).toBe(0);

  const settings = await showSettings(page, 'Agents');
  await settings.getByRole('combobox', { name: 'Select a model', exact: true }).click();
  await settings.getByRole('option', { name: 'None', exact: true }).click();
  await closeSettings(page);
  await modelPicker(page).click();
  await expect(page.getByRole('listbox', { name: 'Model' })).not.toHaveAttribute('aria-multiselectable', 'true');
  await expect(page.getByRole('option', { selected: true })).toHaveText('Imagen');
});

const candidate = 'anthropic/vendor/claude-example';
const candidateLabel = 'Claude candidate';
const decisionModelSummary = `${model}, vendor/claude-example`;

async function prepareModelDecisions(page: Page) {
  await page.route('**/gateway/v1/models', (route) => route.fulfill({ json: { data: [
    { id: model, name: 'GPT Mini', pricing: { input: ' ', output: 1 } },
    { id: candidate, name: 'A non-chat entry', type: 'image', description: 'Not the selected chat model.', pricing: { input: 1, output: 1 } },
    { id: candidate, name: candidateLabel, type: 'language', description: 'A candidate for this request.',
      tags: ['Streaming'], context_window: 8192, max_tokens: 1024, pricing: { input: '0.000003', output: 0.000015, input_cache_read: 0 } },
    { id: 'groq/gpt-4.1-mini', name: 'Groq Mini', type: 'language' },
    { id: 'openai/gpt-6-luna', name: 'Decision model', type: 'decision' },
  ] } }));
  await page.goto('/');
  await showSettings(page); await addKey(page); await addKey(page, 'Anthropic', 'test-anthropic-key'); await closeSettings(page);
  await modelPicker(page).click();
  await expect(page.getByRole('option', { name: 'Decision model', exact: true })).toHaveCount(0);
  await page.getByRole('option', { name: 'GPT Mini', exact: true }).click();
  await page.keyboard.press('Escape');
}

async function selectTwoModels(page: Page) {
  await chooseModel(page, 'GPT Mini');
  await modelPicker(page).click();
  await page.getByRole('option', { name: candidateLabel, exact: true }).click();
  await expect(page.getByRole('option', { selected: true })).toHaveText([candidateLabel, 'GPT Mini']);
  await expect(page.getByRole('option', { name: 'Groq Mini', exact: true })).toHaveAttribute('aria-selected', 'false');
  await page.keyboard.press('Escape');
  await expect(modelPicker(page)).toHaveText(decisionModelSummary);
}

test('BYOK chooses between chat models through the selected Decisions route, or bypasses it when Off', async ({ page }) => {
  const calls: string[] = [];
  for (const endpoint of ['/v1/decisions', '/api/decisions']) {
    await page.route(`**/gateway${endpoint}`, async (route) => {
      calls.push(endpoint);
      expect(await route.request().headerValue('x-openai-key')).toBe(fakeKey);
      expect(await route.request().headerValue('x-anthropic-key')).toBeNull();
      const body = route.request().postDataJSON();
      expect(body.model).toBe('openai/gpt-6-luna');
      const openAI = endpoint === '/v1/decisions';
      const question = openAI ? body.questions[0] : body.questions.chat_model;
      expect(question.instructions).toContain('Choose one offered model');
      expect(question.instructions).toContain('prefer the lower expected cost');
      const criteria: Record<string, string> = openAI
        ? Object.fromEntries(question.choices.map(({ value, description }: { value: string; description: string }) => [value, description]))
        : question.criteria;
      expect(Object.keys(criteria)).toEqual([model, candidate]);
      const bundled = directory.providers.find(({ id }) => id === 'openai')?.tokenPricing?.[model];
      expect(bundled).toBeDefined();
      expect(JSON.parse(criteria[model])).toStrictEqual({ name: 'GPT Mini', provider: 'openai', tags: [],
        pricing: { currency: 'USD', unit: 'token', ...bundled } });
      expect(JSON.parse(criteria[candidate])).toStrictEqual({ name: candidateLabel, provider: 'anthropic', description: 'A candidate for this request.',
        tags: ['streaming'], contextWindow: 8192, maxTokens: 1024,
        pricing: { currency: 'USD', unit: 'token', input: 0.000003, output: 0.000015, cacheRead: 0 } });
      expect(JSON.parse(openAI ? body.input : body.state).at(-1)).toEqual({ role: 'user', text: `Send through ${endpoint}` });
      const answer = { type: 'choice', choice: candidate };
      await route.fulfill({ json: { answers: openAI ? [{ ...answer, name: 'chat_model' }] : { chat_model: answer } } });
    });
  }
  await page.route('**/gateway/api/chat', async (route) => {
    const body = route.request().postDataJSON();
    const routed = /Send through/.test(body.messages.at(-1).parts[0].text);
    const winner = routed ? candidate : model;
    expect(body.model).toBe(winner);
    expect(Object.keys(body).sort()).toEqual(['messages', 'model']);
    expect(await route.request().headerValue('x-openai-key')).toBe(routed ? null : fakeKey);
    expect(await route.request().headerValue('x-anthropic-key')).toBe(routed ? 'test-anthropic-key' : null);
    const turn = calls.length + (routed ? 0 : calls.length ? 10 : 0);
    await route.fulfill({ contentType: 'text/event-stream', headers: { 'x-vercel-ai-ui-message-stream': 'v1' }, body: sse(`Reply ${turn}`, turn, winner) });
  });
  await prepareModelDecisions(page);
  const send = async (text: string, turn: number) => {
    const composer = page.getByRole('textbox', { name: 'Message', exact: true });
    await composer.fill(text); await composer.press('Enter');
    await expect(page.getByText(`Reply ${turn}`, { exact: true })).toBeVisible();
  };
  await openRoute(page, 'Decisions');
  await expect(page.getByRole('menuitemradio', { name: '/v1/decisions', exact: true })).toHaveAttribute('aria-checked', 'true');
  await page.getByRole('menuitemradio', { name: '/v1/decisions', exact: true }).click();
  await chooseModel(page, 'GPT Mini');
  await send('One model only', 0);
  expect(calls).toEqual([]);
  await selectTwoModels(page);
  await send('Send through /v1/decisions', 1);
  await openRoute(page, 'Decisions');
  await page.getByRole('menuitemradio', { name: '/api/decisions', exact: true }).click();
  await send('Send through /api/decisions', 2);
  const settings = await showSettings(page);
  await settings.getByRole('tab', { name: 'Agents', exact: true }).click();
  const role = settings.getByRole('combobox', { name: 'Select a model', exact: true });
  await role.click();
  await settings.getByRole('option', { name: 'None', exact: true }).click();
  await closeSettings(page);
  await expect(modelPicker(page)).toHaveText('GPT Mini');
  await modelPicker(page).click();
  await expect(page.getByRole('listbox', { name: 'Model' })).not.toHaveAttribute('aria-multiselectable', 'true');
  await expect(page.getByRole('option', { selected: true })).toHaveText('GPT Mini');
  await page.keyboard.press('Escape');
  await showSettings(page);
  await settings.getByRole('tab', { name: 'Agents', exact: true }).click();
  await role.click();
  await settings.getByRole('option', { name: 'SelectModelAgent', exact: true }).click();
  await expect(role).toHaveText('SelectModelAgent');
  const { origins } = await page.context().storageState();
  const savedAgents = origins.flatMap(({ localStorage }) => localStorage).find(({ name }) => name.startsWith('streaik.agents.v1:'));
  expect(savedAgents && JSON.parse(savedAgents.value).assignments).toEqual({});
  await closeSettings(page);
  await expect(modelPicker(page)).toHaveText(decisionModelSummary);
  await openRoute(page, 'Decisions');
  await page.getByRole('menuitemradio', { name: 'Off', exact: true }).click();
  await expect(modelPicker(page)).toHaveText('GPT Mini');
  await send('Manual model only', 12);
  expect(calls).toEqual(['/v1/decisions', '/api/decisions']);
  await page.reload();
  await openRoute(page, 'Decisions');
  await expect(page.getByRole('menuitemradio', { name: 'Off', exact: true })).toHaveAttribute('aria-checked', 'true');
});

test('native provider settings match active chat models and send only the Decisions winner’s options', async ({ page }) => {
  const cerebras = 'cerebras/gpt-oss-120b';
  const together = 'together/openai/gpt-oss-120b';
  await page.route('**/gateway/v1/models', route => route.fulfill({ json: { data: [
    { id: model, name: 'GPT Mini' }, { id: cerebras, name: 'Cerebras OSS', type: 'language' },
    { id: together, name: 'Together OSS', type: 'language' }, { id: 'openai/gpt-6-luna', type: 'decision' },
  ] } }));
  let choices = 0;
  await page.route('**/gateway/v1/decisions', route => {
    const body = route.request().postDataJSON();
    expect(body.providerMetadata).toBeUndefined();
    expect(body.questions[0].choices.map(({ value }: { value: string }) => value)).toEqual(expect.arrayContaining([model, cerebras, together]));
    choices++;
    return route.fulfill({ json: { answers: [{ name: 'chat_model', type: 'choice', choice: together }] } });
  });
  const requests: { model: string; providerMetadata?: unknown }[] = [];
  await page.route('**/gateway/api/chat', async route => {
    const request = route.request().postDataJSON();
    requests.push(request);
    await route.fulfill({ contentType: 'text/event-stream', headers: { 'x-vercel-ai-ui-message-stream': 'v1' },
      body: sse(`Native settings reply ${requests.length}`, requests.length, request.model) });
  });
  await page.goto('/');
  await showSettings(page);
  await addKey(page);
  await addKey(page, 'Cerebras', 'test-cerebras-key');
  await addKey(page, 'Together', 'test-together-key');
  await closeSettings(page);
  const settings = page.getByRole('dialog', { name: 'Chat settings', exact: true });
  const openProvider = async (provider: string) => {
    await page.getByRole('button', { name: 'Chat settings', exact: true }).click();
    await settings.getByRole('tab', { name: provider, exact: true }).click();
  };
  const save = settings.getByRole('button', { name: 'Save', exact: true });
  const effort = settings.getByLabel('Reasoning effort', { exact: true });
  await modelPicker(page).click();
  for (const name of ['GPT Mini', 'Cerebras OSS', 'Together OSS']) {
    const option = page.getByRole('option', { name, exact: true });
    if (await option.getAttribute('aria-selected') !== 'true') await option.click();
  }
  await page.keyboard.press('Escape');
  await openProvider('OpenAI');
  await settings.getByLabel('Service tier', { exact: true }).selectOption('flex');
  await settings.getByRole('tab', { name: 'Cerebras', exact: true }).click();
  await settings.getByRole('spinbutton', { name: 'Seed', exact: true }).fill('0');
  await settings.getByLabel('Parallel tool calls', { exact: true }).selectOption('false');
  await settings.getByRole('tab', { name: 'Together AI', exact: true }).click();
  await effort.selectOption('high');
  await save.click();
  await openProvider('Together AI');
  await effort.selectOption('low');
  await settings.getByRole('button', { name: 'Cancel', exact: true }).click();

  const composer = page.getByRole('textbox', { name: 'Message', exact: true });
  const send = async (text: string, next: number) => {
    await composer.fill(text); await composer.press('Enter');
    await expect(page.getByText(`Native settings reply ${next}`, { exact: true })).toBeVisible();
  };
  await send('Choose among the active providers', 1);
  expect(choices).toBe(1);
  expect(requests[0]).toMatchObject({ model: together, providerMetadata: { together: { reasoning_effort: 'high' } } });
  expect(Object.keys(requests[0].providerMetadata as object)).toEqual(['together']);
  await expect(page).toHaveURL(/\/c\/[0-9a-f-]{36}$/);
  await page.reload();
  // The BYOK sample drops session-only credentials on reload, not saved chat preferences.
  await showSettings(page); await addKey(page, 'Together', 'test-together-key'); await closeSettings(page);
  await expect(modelPicker(page)).toBeEnabled();
  await openProvider('Together AI');
  await expect(effort).toHaveValue('high');
  await expect(settings.getByRole('tab', { name: 'Cerebras', exact: true })).toHaveCount(0);
  await settings.getByRole('button', { name: 'Reset provider settings', exact: true }).click();
  await expect(effort).toHaveValue('');
  await save.click();
  await send('Use provider defaults again', 2);
  expect(requests[1].model).toBe(together);
  expect(requests[1].providerMetadata).toBeUndefined();

  await openRoute(page, 'Gateway');
  await page.getByRole('menuitemradio', { name: '/v1/chat/completions', exact: true }).click();
  await page.getByRole('button', { name: 'Chat settings', exact: true }).click();
  await expect(settings.getByRole('tab', { name: 'Together AI', exact: true })).toHaveCount(0);
});

test('invalid or stopped decisions do not submit a chat request', async ({ page }) => {
  await page.addInitScript(() => {
    const fetch = window.fetch;
    window.fetch = (input, init) => {
      if (String(input).endsWith('/gateway/v1/decisions')) init?.signal?.addEventListener('abort', () => {
        document.documentElement.dataset.decisionAborted = 'true';
      });
      return fetch(input, init);
    };
  });
  let calls = 0;
  let chatCalls = 0;
  const response = Promise.withResolvers<void>();
  await page.route('**/gateway/api/chat', (route) => { chatCalls++; return route.abort(); });
  await page.route('**/gateway/v1/decisions', async (route) => {
    if (++calls === 1) {
      await route.fulfill({ json: { answers: [{ name: 'chat_model', type: 'choice', choice: 'openai/not-offered' }] } });
    } else {
      await response.promise;
      await route.fulfill({ json: { answers: [{ name: 'chat_model', type: 'choice', choice: candidate }] } }).catch(() => {});
    }
  });
  await prepareModelDecisions(page);
  await selectTwoModels(page);
  const composer = page.getByRole('textbox', { name: 'Message', exact: true });
  await composer.fill('Route once'); await composer.press('Enter');
  await expect(page.getByRole('alert')).toContainText('Decisions did not return one of the selected models.');
  expect(chatCalls).toBe(0);
  const deciding = page.waitForRequest('**/gateway/v1/decisions');
  await page.getByRole('button', { name: 'Retry', exact: true }).click();
  await deciding;
  try {
    const progress = page.locator('.chat-progress');
    await expect(progress).toHaveText('Choosing a model…');
    await expect(progress.locator('.chat-spinner')).toBeVisible();
    await expect(modelPicker(page)).toBeDisabled();
    await page.getByRole('button', { name: 'Stop', exact: true }).click();
    await expect(page.locator('html')).toHaveAttribute('data-decision-aborted', 'true');
    await expect(progress).toBeEmpty();
  } finally { response.resolve(); }
  expect(calls).toBe(2);
  expect(chatCalls).toBe(0);
});

function nativeChatSse(text: string) {
  const base = { id: 'chat-fixture', object: 'chat.completion.chunk', created: 1, model: 'gpt-4.1-mini' };
  return [
    { ...base, choices: [{ index: 0, delta: { role: 'assistant', content: text.slice(0, 1) }, finish_reason: null }] },
    { ...base, choices: [{ index: 0, delta: { content: text.slice(1) }, finish_reason: 'stop' }] },
    { ...base, choices: [], usage: { prompt_tokens: 5, completion_tokens: 2, total_tokens: 7 } },
  ].map(frame => `data: ${JSON.stringify(frame)}\n\n`).join('') + 'data: [DONE]\n\n';
}

const directToolRoutes = ['/v1/responses', '/v1/messages', '/v1/chat/completions'] as const;
type DirectToolRoute = typeof directToolRoutes[number];
type FixtureToolCall = { id: string; name: string; input: object };

function nativeToolSse(endpoint: DirectToolRoute, model: string, calls: FixtureToolCall[], text: string) {
  if (endpoint === '/v1/chat/completions') {
    if (!calls.length) return nativeChatSse(text);
    const base = { id: 'chat-tool-fixture', object: 'chat.completion.chunk', created: 1, model };
    const tool_calls = calls.map(({ id, name, input }, index) => ({ index, id, type: 'function', function: { name, arguments: JSON.stringify(input) } }));
    return [
      { ...base, choices: [{ index: 0, delta: { role: 'assistant', tool_calls }, finish_reason: null }] },
      { ...base, choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }] },
    ].map(frame => `data: ${JSON.stringify(frame)}\n\n`).join('') + 'data: [DONE]\n\n';
  }
  const frames = endpoint === '/v1/messages' ? [
    { type: 'message_start', message: { id: 'msg_fixture', type: 'message', role: 'assistant', model, content: [], usage: { input_tokens: 5, output_tokens: 0 } } },
    ...(calls.length ? calls.flatMap(({ id, name, input }, index) => [
      { type: 'content_block_start', index, content_block: { type: 'tool_use', id, name, input: {} } },
      { type: 'content_block_delta', index, delta: { type: 'input_json_delta', partial_json: JSON.stringify(input) } },
      { type: 'content_block_stop', index },
    ]) : [
      { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } },
      { type: 'content_block_stop', index: 0 },
    ]),
    { type: 'message_delta', delta: { stop_reason: calls.length ? 'tool_use' : 'end_turn' }, usage: { output_tokens: 2 } },
    { type: 'message_stop' },
  ] : (() => {
    const response = { id: calls.length ? 'resp_tool' : 'resp_text', created_at: 1, model, usage: { input_tokens: 5, output_tokens: 2, total_tokens: 7 } };
    const message = { type: 'message', id: 'msg_fixture', role: 'assistant', status: 'in_progress', content: [] };
    return [
      { type: 'response.created', response },
      ...(calls.length ? calls.flatMap(({ id, name, input }, output_index) => {
        const item = { type: 'function_call', id: `fc_${output_index}`, call_id: id, name, arguments: '', status: 'in_progress' };
        return [
          { type: 'response.output_item.added', output_index, item },
          { type: 'response.function_call_arguments.delta', output_index, item_id: item.id, delta: JSON.stringify(input) },
          { type: 'response.output_item.done', output_index, item: { ...item, arguments: JSON.stringify(input), status: 'completed' } },
        ];
      }) : [
        { type: 'response.output_item.added', output_index: 0, item: message },
        { type: 'response.output_text.delta', output_index: 0, content_index: 0, item_id: message.id, delta: text },
        { type: 'response.output_item.done', output_index: 0, item: { ...message, status: 'completed', content: [{ type: 'output_text', text, annotations: [] }] } },
      ]),
      { type: 'response.completed', response },
    ];
  })();
  return frames.map(frame => `event: ${frame.type}\ndata: ${JSON.stringify(frame)}\n\n`).join('');
}

for (const endpoint of directToolRoutes) test(`Direct ${endpoint} runs browser tools and continues without review`, async ({ page }) => {
  const anthropic = endpoint === '/v1/messages';
  const testMcp = endpoint === '/v1/chat/completions';
  const model = anthropic ? 'claude-sonnet-4-6' : 'gpt-4.1-mini';
  const uri = 'fixture://pages/guide';
  const mcpMethods: string[] = [];
  const requests: unknown[] = [];
  const toolName = 'local_conversations_list_all';
  const calls: FixtureToolCall[] = [{ id: 'call_local_history', name: toolName, input: {} }];
  await page.route(url => url.pathname.startsWith('/gateway/'), route => route.abort());
  if (testMcp) await page.route('**/mcp-direct-fixture', route => {
    const { id, method, params } = route.request().postDataJSON();
    const reply = (result: object) => route.fulfill({ json: { jsonrpc: '2.0', id, result } });
    const complete = { resultType: 'complete', ttlMs: 0, cacheScope: 'private' };
    if (method === 'server/discover') return reply({ supportedVersions: ['2026-07-28'], capabilities: { tools: {}, resources: {} } });
    if (method === 'tools/list') return reply({ ...complete, tools: [{ name: 'lookup', inputSchema: { type: 'object' } }] });
    if (method === 'resources/list') return reply({ ...complete, resources: [{ name: 'Guide', uri }] });
    if (method === 'resources/templates/list') return reply({ ...complete, resourceTemplates: [] });
    mcpMethods.push(method);
    if (method === 'tools/call') {
      expect(params.name).toBe('lookup');
      return reply({ ...complete, content: [{ type: 'text', text: 'Direct MCP lookup result' }] });
    }
    expect(method).toBe('resources/read');
    expect(params.uri).toBe(uri);
    return reply({ ...complete, contents: [{ uri, text: 'Direct MCP resource result' }] });
  });
  const base = `https://api.${anthropic ? 'anthropic' : 'openai'}.com`;
  await page.route(`${base}/v1/**`, async route => {
    const request = route.request();
    const headers = { 'access-control-allow-origin': 'http://localhost:15173', 'access-control-allow-methods': 'GET, POST, OPTIONS',
      'access-control-allow-headers': 'authorization, content-type, x-api-key, anthropic-version, anthropic-dangerous-direct-browser-access' };
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
    if (request.method() === 'GET') return route.fulfill({ headers, json: { data: [{ id: model }] } });
    expect(request.url()).toBe(`${base}${endpoint}`);
    const body = request.postDataJSON();
    requests.push(body);
    const names = body.tools.map((tool: { name?: string; function?: { name: string } }) => tool.function?.name ?? tool.name);
    expect(names).toEqual(expect.arrayContaining([toolName, 'local_ai_models_search']));
    expect(JSON.stringify(body)).not.toMatch(/clientToolResultApproval|approval-requested|approval-responded/);
    if (requests.length === 1 && testMcp) {
      const mcpTool = names.find((name: string) => name.endsWith('_lookup'));
      expect(mcpTool).toBeDefined();
      expect(names).toContain('read_resource');
      const context = body.messages.filter(({ role }: { role: string }) => role === 'system' || role === 'developer')
        .map(({ content }: { content: string }) => content).find((content: string) => content.includes('mcpResourceCatalog'));
      const { serverId } = JSON.parse(context).mcpResourceCatalog.servers[0];
      calls.push({ id: 'call_mcp_lookup', name: mcpTool, input: {} }, { id: 'call_mcp_resource', name: 'read_resource', input: { serverId, uri } });
    }
    const payload = nativeToolSse(endpoint, model, requests.length === 1 ? calls : [], 'Direct tool round complete.');
    return route.fulfill({ headers: { ...headers, 'content-type': 'text/event-stream' }, body: payload });
  });
  await page.goto('/');
  await openRoute(page, 'Direct');
  await page.getByRole('menuitemradio', { name: endpoint, exact: true }).click();
  await showSettings(page); await addKey(page, anthropic ? 'Anthropic' : 'OpenAI'); await closeSettings(page);
  await chooseModel(page, model);

  await page.getByRole('button', { name: 'Chat settings', exact: true }).click();
  const settings = page.getByRole('dialog', { name: 'Chat settings', exact: true });
  await settings.getByRole('tab', { name: 'Tools', exact: true }).click();
  await expect(settings.getByText('Local plugins are available only on Gateway routes.')).toHaveCount(0);
  await settings.getByRole('switch', { name: 'Artificial Intelligence', exact: true }).check();
  await settings.getByRole('switch', { name: 'Chat History', exact: true }).check();
  await settings.getByRole('button', { name: 'Close', exact: true }).click();
  if (testMcp) {
    await page.getByRole('button', { name: 'Add to message', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Model Context', exact: true }).click();
    const context = page.getByRole('dialog', { name: 'Model Context', exact: true });
    await context.getByRole('tab', { name: 'Installed', exact: true }).click();
    await context.getByRole('button', { name: 'Add by URL' }).click();
    const editor = page.getByRole('dialog', { name: 'Add MCP server' });
    await editor.getByLabel('Name', { exact: true }).fill('Direct fixture');
    await editor.getByLabel('URL', { exact: true }).fill(new URL('/mcp-direct-fixture', page.url()).href);
    await editor.getByRole('button', { name: 'Save', exact: true }).click();
    await context.getByRole('switch', { name: 'Direct fixture' }).check();
    await expect(context.getByRole('status')).toHaveText('1 tools available');
    await context.getByRole('button', { name: 'Close', exact: true }).click();
  }
  const composer = page.getByRole('textbox', { name: 'Message', exact: true });
  await composer.fill('Run my enabled tools.'); await composer.press('Enter');
  await expect(page.getByText('Direct tool round complete.', { exact: true })).toBeVisible();
  await expect(page.getByRole('dialog', { name: /Review tool result|Approve tool execution/ })).toHaveCount(0);
  expect(requests).toHaveLength(2);
  const followup = requests[1] as { input: unknown[]; messages: { role: string; content: unknown }[] };
  const history = expect.stringContaining('"conversations"');
  const local = calls[0];
  if (endpoint === '/v1/responses') expect(followup.input).toEqual(expect.arrayContaining([
    expect.objectContaining({ type: 'function_call', call_id: local.id, name: toolName }),
    expect.objectContaining({ type: 'function_call_output', call_id: local.id, output: history }),
  ]));
  else if (anthropic) {
    const blocks = followup.messages.flatMap(message => message.content);
    expect(blocks).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'tool_use', id: local.id, name: toolName }),
      expect.objectContaining({ type: 'tool_result', tool_use_id: local.id, content: history }),
    ]));
  } else {
    const outputs = [history, expect.stringContaining('Direct MCP lookup result'), expect.stringContaining('Direct MCP resource result')];
    expect(followup.messages).toEqual(expect.arrayContaining([
      expect.objectContaining({ role: 'assistant', tool_calls: calls.map(({ id, name }) => expect.objectContaining({ id, function: expect.objectContaining({ name }) })) }),
      ...calls.map(({ id }, index) => expect.objectContaining({ role: 'tool', tool_call_id: id, content: outputs[index] })),
    ]));
    expect(mcpMethods).toEqual(['tools/call', 'resources/read']);
  }
});

test('BYOK can chat and persist Direct performance and cost with every gateway request blocked', async ({ page }) => {
  let gatewayCalls = 0;
  let directCalls = 0;
  // Separate samples even when Playwright delivers all SSE frames in one buffer.
  await page.addInitScript(() => {
    const now = performance.now.bind(performance);
    let last = 0;
    Object.defineProperty(performance, 'now', { value: () => last = Math.max(now(), last + 0.125) });
  });
  await page.route(url => url.pathname.startsWith('/gateway/'), async route => { gatewayCalls++; await route.abort(); });
  await page.route('https://api.openai.com/v1/**', async route => {
    const request = route.request();
    const headers = { 'access-control-allow-origin': 'http://localhost:15173', 'access-control-allow-methods': 'GET, POST, OPTIONS',
      'access-control-allow-headers': 'authorization, content-type' };
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
    expect(await request.headerValue('authorization')).toBe(`Bearer ${fakeKey}`);
    expect(await request.headerValue('x-openai-key')).toBeNull();
    if (request.method() === 'GET') {
      expect(request.url()).toBe('https://api.openai.com/v1/models');
      return route.fulfill({ headers, json: { data: [{ id: 'gpt-4.1-mini' }, { id: 'gpt-image-1' }] } });
    }
    expect(request.url()).toBe('https://api.openai.com/v1/chat/completions');
    expect(request.postDataJSON()).toMatchObject({ model: 'gpt-4.1-mini', stream: true, store: false });
    expect(request.postDataJSON().messages.filter(({ role }: { role: string }) => role === 'system' || role === 'developer'))
      .toEqual([expect.objectContaining({ content: 'Chat' })]);
    if (directCalls === 1) expect(JSON.stringify(request.postDataJSON().messages)).toContain('Direct reply 1');
    await route.fulfill({ headers: { ...headers, 'content-type': 'text/event-stream' }, body: nativeChatSse(`Direct reply ${++directCalls}`) });
  });
  await page.goto('/');
  await openRoute(page, 'Gateway');
  await expect(page.getByRole('menuitemradio', { name: '/api/chat', exact: true })).toHaveAttribute('aria-checked', 'true');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'Account menu' })).toBeFocused();
  await openRoute(page, 'Direct');
  await page.getByRole('menuitemradio', { name: '/v1/chat/completions', exact: true }).click();
  await showSettings(page); await addKey(page); await closeSettings(page);
  await chooseChatModel(page);
  await modelPicker(page).click();
  const list = page.getByRole('listbox', { name: 'Model', exact: true });
  await expect(list).not.toHaveAttribute('aria-multiselectable', 'true');
  const directModel = list.getByRole('option', { name: 'gpt-4.1-mini', exact: true });
  await directModel.click();
  await expect(modelPicker(page)).toHaveText('Select a model');
  await expect(list).toBeHidden();
  await modelPicker(page).click();
  await directModel.click();
  await chooseChatModel(page);
  await openRoute(page, 'Direct');
  await expect(page.getByRole('menuitemradio', { name: '/v1/chat/completions', exact: true })).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByRole('menuitemradio', { name: '/v1/messages', exact: true })).toHaveCount(0);
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'View context', exact: true }).click();
  const context = page.getByRole('dialog', { name: 'Context', exact: true });
  const system = context.getByRole('tabpanel', { name: 'System', exact: true });
  await expect(system.getByRole('heading', { name: 'Instructions', exact: true })).toBeVisible();
  await expect(system.getByText('Chat', { exact: true })).toBeVisible();
  await expect(system.getByRole('heading', { name: 'System context', exact: true })).toHaveCount(0);
  await expect(context.getByRole('tab', { name: 'Skills', exact: true })).toHaveCount(0);
  await context.getByRole('button', { name: 'Close', exact: true }).click();
  const composer = page.getByRole('textbox', { name: 'Message', exact: true });
  await composer.fill('Offline first question'); await composer.press('Enter');
  await expect(page.getByText('Direct reply 1', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Stop', exact: true })).toBeHidden();
  await composer.fill('Offline follow-up'); await composer.press('Enter');
  await expect(page.getByText('Direct reply 2', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Stop', exact: true })).toBeHidden();
  const lastReply = page.getByRole('article', { name: 'Assistant', exact: true }).last();
  const badge = (label: string) => lastReply.getByRole('img', { name: new RegExp(`^${label.replace(/[()]/g, '\\$&')}:`) });
  await expect(badge('Direct cost')).toHaveText('0.0000104');
  await expect(page.getByRole('img', { name: /^Conversation cost:/ })).toHaveCount(0);
  await enableChatMetrics(page);
  await expect(badge('Time to first token')).toBeVisible();
  await expect(badge('Tokens per second')).toBeVisible();
  const ttft = await badge('Time to first token').textContent();
  const tps = await badge('Tokens per second').textContent();
  expect(gatewayCalls).toBe(0);
  expect(directCalls).toBe(2);

  await page.reload();
  await expect(page.getByText('Direct reply 1', { exact: true })).toBeVisible();
  await expect(page.getByText('Direct reply 2', { exact: true })).toBeVisible();
  await expect(badge('Direct cost')).toHaveText('0.0000104');
  await expect(badge('Time to first token')).toHaveText(ttft!);
  await expect(badge('Tokens per second')).toHaveText(tps!);
  expect(gatewayCalls).toBe(0);
});

test('BYOK can leave a failed gateway model request and discover directly', async ({ page }) => {
  let gatewayCalls = 0;
  await page.route(url => url.pathname.startsWith('/gateway/'), async route => { gatewayCalls++; await route.abort(); });
  await page.route('https://api.openai.com/v1/models', async route => route.fulfill({
    headers: { 'access-control-allow-origin': 'http://localhost:15173' }, json: { data: [{ id: 'gpt-4.1-mini' }] },
  }));
  await page.goto('/');
  await showSettings(page); await addKey(page); await closeSettings(page);
  await expect(page.getByText(/Could not reach the configured gateway/)).toBeVisible();
  await openRoute(page, 'Direct');
  await page.getByRole('menuitemradio', { name: '/v1/responses', exact: true }).click();
  await chooseChatModel(page);
  expect(gatewayCalls).toBe(1);
});

test('switching from API Chat to a native gateway route keeps inline history and Retry uses the selected route', async ({ page }) => {
  await mockModels(page);
  const skill = { id: 'openai/skill_native-context', name: 'native-context', description: 'A hosted skill for this chat.' };
  await page.route('**/gateway/v1/skills?*', route => route.fulfill({ json: { data: [skill], has_more: false } }));
  let calls = 0;
  await page.route('**/gateway/api/chat', async route => {
    await route.fulfill({ contentType: 'text/event-stream', body: sse('API Chat reply', 1) });
  });
  await page.route('**/gateway/v1/chat/completions', async route => {
    expect(await route.request().headerValue('x-openai-key')).toBe(fakeKey);
    expect(await route.request().headerValue('authorization')).toBeNull();
    const body = route.request().postDataJSON();
    expect(body.model).toBe(model);
    const systemText = body.messages.filter(({ role }: { role: string }) => role === 'system').map(({ content }: { content: string }) => content);
    expect(systemText.at(-1)).toBe('Chat');
    const context = systemText.slice(0, -1).map((text: string) => JSON.parse(text));
    expect(context).toEqual([
      { skills: [{ name: skill.name, skill_id: skill.id, description: skill.description }] },
      { systemInformation: { appName: expect.any(String), timezone: expect.any(String) } },
      { preferredLanguage: 'en', darkMode: expect.any(Boolean) },
    ]);
    expect(JSON.stringify(body.messages)).toContain('API Chat reply');
    expect(JSON.stringify(body.messages)).toContain('Native continuation');
    if (++calls === 1) return route.fulfill({ status: 429, body: 'private provider error' });
    await route.fulfill({ contentType: 'text/event-stream', body: nativeChatSse('Retried native reply') });
  });
  await page.goto('/');
  await showSettings(page); await addKey(page); await closeSettings(page);
  await chooseChatModel(page);
  const settings = await showChatSkills(page);
  await settings.getByRole('switch', { name: skill.name, exact: true }).check();
  await settings.getByRole('button', { name: 'Close', exact: true }).click();
  const composer = page.getByRole('textbox', { name: 'Message', exact: true });
  await composer.fill('First on API Chat'); await composer.press('Enter');
  await expect(page.getByText('API Chat reply', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Stop', exact: true })).toBeHidden();
  await openRoute(page, 'Gateway');
  await page.getByRole('menuitemradio', { name: '/v1/chat/completions', exact: true }).click();
  await composer.fill('Native continuation'); await composer.press('Enter');
  await expect(page.getByRole('alert')).not.toContainText('private provider error');
  await page.getByRole('button', { name: 'Retry', exact: true }).click();
  await expect(page.getByText('Retried native reply', { exact: true })).toBeVisible();
  expect(calls).toBe(2);
});

test('model tabs browse the shared catalog without changing the chat picker, draft, or in-flight reply', async ({ page }) => {
  let lists = 0;
  await page.route('**/gateway/v1/models', async route => {
    lists++;
    await route.fulfill({ json: { data: [
      { id: model, type: 'language', tags: ['streaming'], context_window: 8192 },
      { id: 'imagerouter/vendor/img-xl', type: 'image', name: lists === 1 ? 'Image XL' : 'Image XL 2' },
      { id: 'deepgram/nova-3', type: 'transcription', tags: ['realtime'] },
      { id: 'custom/not-classified', type: 'other' },
    ] } });
  });
  let release!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  let turn = 0;
  await page.route('**/gateway/api/chat', async route => {
    const current = ++turn;
    if (current > 1) await pending;
    await route.fulfill({ headers: { 'content-type': 'text/event-stream', 'x-vercel-ai-ui-message-stream': 'v1' },
      body: sse(current === 1 ? 'First reply' : 'Reply across views', current) });
  });
  await page.goto('/');
  await showSettings(page); await addKey(page); await closeSettings(page);
  await chooseChatModel(page);
  const rail = page.getByRole('navigation', { name: 'Chat navigation' });
  await expect(rail.getByRole('button', { name: 'Chat', exact: true })).toHaveCount(0);
  await expect(rail.getByRole('button', { name: 'New chat', exact: true })).toBeVisible();
  const models = rail.getByRole('button', { name: 'Models', exact: true });
  const composer = page.getByRole('textbox', { name: 'Message', exact: true });
  await composer.fill('A chat to reopen');
  await composer.press('Enter');
  await expect(page.getByText('First reply', { exact: true })).toBeVisible();
  await composer.fill('A draft to keep');
  await rail.getByRole('button', { name: 'Toggle navigation' }).click();
  const history = page.getByRole('complementary', { name: 'Chat history' });
  const conversation = history.getByRole('button', { name: 'A chat to reopen', exact: true });
  await expect(history.getByRole('button', { name: /^(Models|Providers)$/ })).toHaveCount(0);
  await railMore(page).click();
  await pagesMenu(page).getByRole('menuitem', { name: 'Models', exact: true }).hover();
  await pagesMenu(page).getByRole('menuitem', { name: 'Pin Models', exact: true }).click();
  await models.click();
  await expect(page.getByRole('button', { name: 'Back to chat', exact: true })).toHaveCount(0);
  await expect(models).toHaveAttribute('aria-current', 'page');
  await expect(page.getByRole('heading', { name: 'Models', exact: true })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'All (4)' })).toHaveAttribute('aria-selected', 'true');
  const image = page.getByRole('tab', { name: 'Image (1)', exact: true });
  await image.click();
  await image.press('ArrowRight');
  await expect(page.getByRole('tab', { name: 'Realtime (1)' })).toBeFocused();
  await expect(page.getByRole('tabpanel').getByRole('heading', { name: 'nova-3' })).toBeVisible();
  await expect(page.getByRole('tabpanel').getByText('Transcription', { exact: true })).toBeVisible();
  await expect(page.getByRole('tabpanel').getByRole('heading', { name: 'gpt-4.1-mini' })).toHaveCount(0);
  await page.getByRole('tab', { name: 'Transcription (1)' }).click();
  await expect(page.getByRole('tabpanel').getByRole('heading', { name: 'nova-3' })).toBeVisible();
  await page.getByLabel('Provider', { exact: true }).selectOption('imagerouter');
  await image.click();
  const modelSearch = page.getByRole('searchbox', { name: 'Search models' });
  await modelSearch.fill('no-match');
  await expect(page.getByText('No models match these filters.')).toBeVisible();
  await modelSearch.fill('xl imager');
  await expect(page.getByRole('tabpanel').getByRole('heading', { name: 'Image XL', exact: true })).toBeVisible();
  expect(lists).toBe(1);
  const refresh = page.getByRole('button', { name: 'Refresh models', exact: true });
  await expect(refresh).toHaveText('');
  await expect(refresh.locator('svg')).toBeVisible();
  await refresh.click();
  await expect.poll(() => lists).toBe(2);
  await expect(modelSearch).toHaveValue('xl imager');
  await expect(page.getByRole('tabpanel').getByRole('heading', { name: 'Image XL 2', exact: true })).toBeVisible();
  await conversation.click();
  await expect(composer).toHaveValue('A draft to keep');
  await modelPicker(page).click();
  await expect(page.getByRole('listbox').getByRole('option')).toHaveCount(1);
  await page.keyboard.press('Escape');
  try {
    await composer.press('Enter');
    await expect(page.getByRole('button', { name: 'Stop', exact: true })).toBeVisible();
    await models.click();
    await expect(conversation).toBeDisabled();
  } finally { release(); }
  await conversation.click();
  await expect(page.getByText('Reply across views')).toBeVisible();
});

test('sidebar catalog pins are opt-in, independent of navigation, and saved across reloads', async ({ page }) => {
  await mockModels(page);
  await page.goto('/');
  await showSettings(page); await addKey(page); await closeSettings(page);
  const rail = page.getByRole('navigation', { name: 'Chat navigation' });
  const models = rail.getByRole('button', { name: 'Models', exact: true });
  const providers = rail.getByRole('button', { name: 'Providers', exact: true });
  for (const name of ['New chat', 'Images', 'Videos', 'Transcriptions', 'Agents', 'Skills']) {
    await expect(rail.getByRole('button', { name, exact: true })).toBeVisible();
  }
  await expect(models).toHaveCount(0);
  await expect(providers).toHaveCount(0);

  const more = railMore(page);
  const menu = pagesMenu(page);
  const modelsItem = menu.getByRole('menuitem', { name: 'Models', exact: true });
  const pinModels = menu.getByRole('menuitem', { name: 'Pin Models', exact: true });
  const pinProviders = menu.getByRole('menuitem', { name: 'Pin Providers', exact: true });
  await more.click();
  await expect(menu.getByRole('menuitem')).toHaveCount(4);
  await expect(pinModels).toHaveCSS('opacity', '0');
  await modelsItem.hover();
  await expect(pinModels).toHaveCSS('opacity', '1');
  await expect(pinProviders).toHaveCSS('opacity', '0');
  await modelsItem.click();
  const heading = page.getByRole('heading', { name: 'Models', exact: true });
  await expect(heading).toBeVisible();
  await expect(models).toHaveCount(0);

  await more.press('ArrowDown');
  await expect(modelsItem).toBeFocused();
  await expect(modelsItem).toHaveAttribute('aria-current', 'page');
  await page.keyboard.press('End');
  await expect(pinProviders).toBeFocused();
  await expect(pinProviders).toHaveCSS('opacity', '1');
  await page.keyboard.press('Enter');
  await expect(more).toBeFocused();
  await expect(heading).toBeVisible();
  await expect(providers).toBeVisible();
  await expect(models).toHaveCount(0);

  await more.click();
  await modelsItem.hover();
  await pinModels.click();
  await expect(models).toHaveAttribute('aria-current', 'page');
  await rail.getByRole('button', { name: 'New chat', exact: true }).click();
  await expect(models).toBeVisible();
  await page.reload();
  const catalogShortcuts = rail.getByRole('button', { name: /^(More pages|Models|Providers)$/ });
  await expect(catalogShortcuts).toHaveCount(3);
  await expect(catalogShortcuts.first()).toHaveAccessibleName('More pages');
  await models.click();
  await more.click();
  await modelsItem.hover();
  await menu.getByRole('menuitem', { name: 'Unpin Models', exact: true }).click();
  await expect(heading).toBeVisible();
  await expect(models).toHaveCount(0);
  await expect(providers).toBeVisible();
  await page.reload();
  await expect(providers).toBeVisible();
  await expect(models).toHaveCount(0);
});

test.describe('Dutch regional settings with English interface', () => {
  test.use({ locale: 'nl-NL' });
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('streaik.language', 'en'));
  });

  test('model badges and tabs show distinct icons and regional counts', async ({ page }) => {
    const types = [
      ['language', 'Language'], ['image', 'Image'], ['decision', 'Decision'], ['reranking', 'Reranking'],
      ['speech', 'Speech'], ['transcription', 'Transcription'], ['video', 'Video'], ['embedding', 'Embedding'],
      ['audio', 'Audio'], ['moderation', 'Moderation'], ['unrecognized', 'Other'],
    ];
    const data = types.map(([type, name]) => ({ id: `openai/example-${type}`, type, name,
      ...(type === 'language' ? { context_window: 128_000, max_tokens: 4_096 } : {}),
      ...(type === 'audio' ? { tags: ['realtime'] } : {}),
    }));
    await page.route('**/gateway/v1/models', route => route.fulfill({ json: { data: [
      ...data, ...Array.from({ length: 1234 - data.length }, (_, index) => ({ id: `openai/other-${index}`, type: 'other' })),
    ] } }));
    await page.goto('/');
    await showSettings(page); await addKey(page); await closeSettings(page);
    await openCatalog(page, 'Models');
    await expect(page.getByText('Explore 1.234 models available from your gateway, grouped by capability.')).toBeVisible();

    const tabs = page.getByRole('tablist', { name: 'Model capabilities' });
    await expect(tabs.getByRole('tab', { name: 'All (1.234)', exact: true })).toBeVisible();
    const tabIcons = tabs.locator('svg[aria-hidden=true]');
    await expect(tabIcons).toHaveCount(types.length + 2); // All, each type, and Realtime.
    const glyphs = await tabIcons.evaluateAll(icons => icons.map(icon => icon.innerHTML));
    expect(new Set(glyphs).size).toBe(glyphs.length);

    const results = page.getByRole('tabpanel');
    const card = (name: string) => results.getByRole('article').filter({ has: page.getByRole('heading', { name, exact: true }) });
    for (const [, name] of types) {
      const tab = tabs.getByRole('tab', { name: `${name} (${name === 'Other' ? '1.224' : '1'})`, exact: true });
      await tab.click();
      const badgeIcon = card(name).locator('.catalog-type-badge svg[aria-hidden=true]');
      await expect(badgeIcon).toBeVisible();
      expect(await badgeIcon.innerHTML()).toBe(await tab.locator('svg').innerHTML());
    }

    await tabs.getByRole('tab', { name: 'Image (1)', exact: true }).click();
    await expect(card('Image').locator('.catalog-token-badge')).toHaveCount(0);
    await tabs.getByRole('tab', { name: 'Language (1)', exact: true }).click();
    const contextLabel = 'Context window: 128.000 tokens';
    const outputLabel = 'Maximum output: 4.096 tokens';
    const contextBadge = card('Language').getByRole('img', { name: contextLabel, exact: true });
    const outputBadge = card('Language').getByRole('img', { name: outputLabel, exact: true });
    await expect(contextBadge).toHaveText('128.000');
    await expect(outputBadge).toHaveText('4.096');
    expect(await contextBadge.locator('svg').innerHTML()).not.toBe(await outputBadge.locator('svg').innerHTML());
    await contextBadge.focus();
    await expect(page.getByRole('tooltip', { name: contextLabel, exact: true })).toBeVisible();
    await page.keyboard.press('Escape');
    await outputBadge.hover();
    await expect(page.getByRole('tooltip', { name: outputLabel, exact: true })).toBeVisible();
  });

  test('chat metrics use regional grouping and decimal separators', async ({ page }) => {
    await mockModels(page);
    await page.route('**/gateway/api/chat', route => {
      const events = [
        { type: 'start', messageId: 'regional-reply' },
        { type: 'text-start', id: 't' }, { type: 'text-delta', id: 't', delta: 'Regional reply' }, { type: 'text-end', id: 't' },
        { type: 'finish', finishReason: 'stop', messageMetadata: {
          usage: { promptTokens: 1200, completionTokens: 34, totalTokens: 1234 },
          providerMetadata: { gateway: { cost: 0.0000104, ttft: 1.25, tps: 20 } },
        } },
      ];
      return route.fulfill({ headers: { 'content-type': 'text/event-stream', 'x-vercel-ai-ui-message-stream': 'v1' },
        body: events.map(event => `data: ${JSON.stringify(event)}\n\n`).join('') + 'data: [DONE]\n\n' });
    });
    await page.goto('/');
    await showSettings(page); await addKey(page); await closeSettings(page);
    await enableChatMetrics(page);
    await chooseChatModel(page);
    const composer = page.getByRole('textbox', { name: 'Message', exact: true });
    await composer.fill('Show regional metrics');
    await composer.press('Enter');
    const reply = page.getByRole('article', { name: 'Assistant' });
    await expect(reply.getByRole('img', { name: 'Total tokens: 1.234 (1.200 input · 34 output)', exact: true })).toHaveText('1.234');
    await expect(reply.getByRole('img', { name: /^Time to first token:/ })).toHaveText('1,25 s');
    await expect(reply.getByRole('img', { name: /^Gateway cost:/ })).toHaveText('0,0000104');
  });
});

test.describe('touch sidebar', () => {
  test.use({ hasTouch: true, viewport: { width: 390, height: 844 } });

  test('catalog pins can be tapped without hovering', async ({ page }) => {
    await page.goto('/');
    await railMore(page).tap();
    const pin = pagesMenu(page).getByRole('menuitem', { name: 'Pin Providers', exact: true });
    await expect(pin).toHaveCSS('opacity', '1');
    await pin.tap();
    await expect(page.getByRole('navigation', { name: 'Chat navigation' }).getByRole('button', { name: 'Providers', exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Providers', exact: true })).toHaveCount(0);
  });
});

for (const [host, url] of [['BYOK', '/'], ['Entra', 'http://localhost:15174']] as const) {
  test(`${host} provider directory is read-only and browsable without a connection`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    let discovery = 0;
    await page.route('**/gateway/v1/models', route => { discovery++; return route.fulfill({ json: { data: [] } }); });
    await page.goto(url);
    const appName = host === 'BYOK' ? 'Streaik' : 'Northwind & Co';
    await expect(page).toHaveTitle(appName);
    await expect(page.getByRole('contentinfo')).toContainText(`${appName} can make mistakes.`);
    const rail = page.getByRole('navigation', { name: 'Chat navigation' });
    await rail.getByRole('button', { name: 'Toggle navigation' }).click();
    await openCatalog(page, 'Providers');
    await expect(page.getByRole('heading', { name: 'Providers', exact: true })).toBeVisible();
    await expect(page.getByRole('complementary', { name: 'Chat history' })).toBeHidden();
    const cards = page.getByRole('main').getByRole('article');
    const countLabel = (count: number) => `${count.toLocaleString('en')} providers`;
    await expect(page.getByText(countLabel(directory.providers.length), { exact: true })).toBeVisible();
    await expect(cards).toHaveCount(48);
    await page.getByRole('button', { name: 'Show more', exact: true }).click();
    await expect(cards).toHaveCount(96);
    await expect(page.getByRole('button', { name: /add provider|favorites/i })).toHaveCount(0);
    await expect(page.getByRole('tablist', { name: 'Model capabilities' })).toHaveCount(0);
    const country = page.getByLabel('Country of origin');
    const region = page.getByLabel('AI region');
    await country.selectOption('US');
    await region.selectOption('World');
    const matching = directory.providers.filter(p => p.country === 'US' && p.regions?.includes('World')).length;
    await expect(page.getByText(countLabel(matching), { exact: true })).toBeVisible();
    await expect(cards).toHaveCount(Math.min(48, matching));
    const search = page.getByRole('searchbox', { name: 'Search providers' });
    await search.fill('valuab artific');
    const openai = cards.filter({ has: page.getByRole('heading', { name: 'OpenAI', exact: true }) });
    await expect(openai).toBeVisible();
    await expect(openai.locator('.catalog-mark img')).toHaveAttribute('src', openAiFavicon);
    for (const label of ['website', 'docs', 'pricing', 'terms', 'privacy', 'console']) {
      const link = openai.getByRole('link', { name: `OpenAI ${label}`, exact: true });
      await expect(link).toHaveText('');
      await expect(link).toHaveAttribute('href', /^https:\/\//);
      await expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    }
    await search.fill('no-provider-match');
    await expect(page.getByText('No providers match these filters.')).toBeVisible();
    await country.selectOption('');
    await region.selectOption('');
    await search.fill('Pyrois');
    await expect(cards.getByRole('heading', { name: 'Pyrois', exact: true })).toBeVisible();
    expect(discovery).toBe(0);
  });
}

test('the desktop rail stays in place and its avatar opens Settings from the keyboard', async ({ page }) => {
  await page.goto('/');
  const rail = page.getByRole('navigation', { name: 'Chat navigation' });
  const toggle = rail.getByRole('button', { name: 'Toggle navigation' });
  const avatar = rail.getByRole('button', { name: 'Account menu' });
  const panel = page.getByRole('complementary', { name: 'Chat history' });
  await expect(avatar).toHaveText('BY');
  await expect(panel).toBeHidden();
  const railPosition = await rail.boundingBox();
  const avatarPosition = await avatar.boundingBox();
  expect(avatarPosition!.y).toBeGreaterThan(railPosition!.height - 50);
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await expect(panel).toBeVisible();
  expect(await rail.boundingBox()).toEqual(railPosition);
  expect(await avatar.boundingBox()).toEqual(avatarPosition);
  expect((await panel.boundingBox())!.x).toBe(railPosition!.x + railPosition!.width);
  await avatar.press('ArrowDown');
  const settings = page.getByRole('menuitem', { name: 'Settings' });
  await expect(settings).toBeFocused();
  await expect(page.getByRole('menuitem', { name: 'Log out' })).toHaveCount(0);
  await settings.press('Enter');
  await expect(page.getByRole('dialog', { name: 'Settings' })).toBeVisible();
  await closeSettings(page);
  await expect(avatar).toBeFocused();
  await toggle.click();
  await expect(panel).toBeHidden();
  await expect(rail).toBeVisible();
});

test('compact badges, logo fallback, copy, pinned history and conversation replay survive reload', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await mockModels(page);
  const bodies: { model: string; messages: { id: string; role: string; parts: unknown[]; metadata?: unknown }[] }[] = [];
  const timestamp = new Date(Date.now() - 125_000).toISOString();
  const metadata = { model, timestamp, usage: { promptTokens: 12, completionTokens: 6, totalTokens: 18 },
    providerMetadata: { gateway: { cost: 0, ttft: 1.25, tps: 20 } } };
  await page.route('**/gateway/api/chat', async (route) => {
    bodies.push(route.request().postDataJSON());
    const events = [
      { type: 'start', messageId: `persistent-reply-${bodies.length}` },
      { type: 'reasoning-start', id: 'r' },
      { type: 'reasoning-delta', id: 'r', delta: 'Not part of the copied reply' },
      { type: 'reasoning-end', id: 'r' },
      { type: 'text-start', id: 't' },
      { type: 'text-delta', id: 't', delta: bodies.length === 1 ? '**Saved answer**' : '**New searchable answer**' },
      { type: 'text-end', id: 't' },
      { type: 'finish', finishReason: 'stop', messageMetadata: { ...metadata, model: bodies.length === 1 ? model : 'unbranded/model' } },
    ];
    await route.fulfill({ headers: { 'content-type': 'text/event-stream', 'x-vercel-ai-ui-message-stream': 'v1' },
      body: events.map(event => `data: ${JSON.stringify(event)}\n\n`).join('') + 'data: [DONE]\n\n' });
  });
  await page.goto('/');
  await showSettings(page); await addKey(page); await closeSettings(page);
  await chooseChatModel(page);
  await enableChatMetrics(page);
  const composer = page.getByRole('textbox', { name: 'Message', exact: true });
  await composer.fill('Persistent first question'); await composer.press('Enter');
  const reply = page.getByRole('article', { name: 'Assistant' });
  const user = page.getByRole('article', { name: 'You', exact: true });
  const logo = reply.locator('.chat-provider-logo');
  await expect(user).toHaveText('Just nowPersistent first question');
  const sentAt = await user.locator('time').getAttribute('datetime');
  expect(sentAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  await expect(reply.locator('time')).toHaveAttribute('datetime', timestamp);
  await expect(reply.locator('time')).toHaveText('2 minutes ago');
  await expect(logo).toBeVisible();
  await expect.poll(() => logo.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0);
  await expect(reply.locator('.chat-speaker')).toHaveText('gpt-4.1-mini');
  await expect(reply.locator('.chat-ai-badge')).toHaveText('Generated by AI');
  await expect(reply.locator('.chat-ai-badge svg')).toBeVisible();
  await expect(reply.locator('.chat-message-actions .chat-badge')).toHaveCount(4);
  await expect(reply.getByRole('img', { name: /^Total tokens: 18 \(12 input · 6 output\)$/ })).toHaveText('18');
  const timing = reply.getByRole('img', { name: /^Time to first token:/ });
  await expect(timing).toHaveText('1.25 s');
  await timing.hover();
  await expect(page.getByRole('tooltip', { name: 'Time to first token', exact: true })).toBeVisible();
  await expect(reply.getByRole('img', { name: /^Tokens per second:/ })).toHaveText('20 tok/s');
  await expect(reply.getByRole('img', { name: /^Gateway cost:/ })).toHaveText('0.00');
  const copy = reply.getByRole('button', { name: 'Copy assistant message' });
  await expect(copy).toHaveText('');
  await copy.click();
  await expect(reply.getByText('Copied', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('**Saved answer**');

  const toggle = page.getByRole('button', { name: 'Toggle navigation' });
  const title = 'Persistent first question';
  const recent = page.getByRole('list', { name: 'Recent', exact: true });
  const pinned = page.getByRole('list', { name: 'Pinned', exact: true });
  const conversation = page.getByRole('button', { name: title, exact: true });
  const pin = page.getByRole('button', { name: `Pin ${title}`, exact: true });
  const more = page.getByRole('button', { name: `More actions for ${title}`, exact: true });
  await toggle.click();
  await expect(recent.getByRole('button', { name: title, exact: true })).toBeVisible();
  await expect(more.locator('..')).toHaveCSS('opacity', '0');
  await conversation.hover();
  await expect(more.locator('..')).toHaveCSS('opacity', '1');
  await pin.click();
  await expect(pinned.getByRole('button', { name: title, exact: true })).toBeVisible();

  // Wait for the assistant turn and pin to reach the same IndexedDB record before reload.
  const saved = (replyId: string) => page.evaluate((id) => new Promise<boolean | undefined>((resolve, reject) => {
    const request = indexedDB.open('streaik-conversations', 1);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const data = request.result.transaction('conversations').objectStore('conversations').getAll();
      data.onsuccess = () => {
        resolve(data.result.find(item => item.messages.some((message: { id: string }) => message.id === id))?.metadata?.pinned);
        request.result.close();
      };
    };
  }), replyId);
  await expect.poll(() => saved('persistent-reply-1')).toBe(true);
  // Conversations in a different account or gateway must never appear in this transcript or list.
  await page.evaluate(() => new Promise<void>((resolve, reject) => {
    const request = indexedDB.open('streaik-conversations', 1);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      const tx = db.transaction('conversations', 'readwrite');
      const conversations = tx.objectStore('conversations');
      const keys = conversations.getAllKeys();
      keys.onsuccess = () => {
        const [scope] = keys.result[0] as [string, string];
        const [gateway, profile] = JSON.parse(scope) as [string, string];
        const conversation = { id: 'foreign', metadata: { updatedAt: '9999-01-01T00:00:00Z' }, messages: [
          { id: 'foreign-user', role: 'user', parts: [{ type: 'text', text: 'Foreign conversation' }] },
        ] };
        conversations.put(conversation, [JSON.stringify([gateway, 'another-profile']), conversation.id]);
        conversations.put(conversation, [JSON.stringify(['https://another-gateway.example/api/chat', profile]), conversation.id]);
      };
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onabort = () => { db.close(); reject(tx.error); };
    };
  }));
  await page.reload();
  await expect(reply.getByText('Saved answer')).toBeVisible();
  await expect(timing).toHaveText('1.25 s');
  await expect(user.locator('time')).toHaveAttribute('datetime', sentAt!);
  await expect(reply.locator('time')).toHaveAttribute('datetime', timestamp);
  await toggle.click();
  await expect(pinned.getByRole('button', { name: title, exact: true })).toBeVisible();
  const openHistorySearch = page.getByRole('button', { name: 'Search chats', exact: true });
  const historySearch = page.getByRole('dialog', { name: 'Search chats' });
  const historyQuery = historySearch.getByRole('searchbox');
  await openHistorySearch.click();
  await historyQuery.fill('Saved answer');
  await expect(historySearch.getByRole('button', { name: title, exact: true })).toHaveAccessibleDescription(/Saved answer/);
  await historyQuery.press('Escape');
  await expect(openHistorySearch).toBeFocused();
  await showSettings(page); await addKey(page); await closeSettings(page);
  await composer.fill('Follow up after reload'); await composer.press('Enter');
  await expect(page.getByText('unbranded/model', { exact: true })).toBeVisible();
  expect(bodies[1]?.messages.find(({ id }: { id: string }) => id === 'persistent-reply-1')).toMatchObject({ role: 'assistant', metadata,
    parts: expect.arrayContaining([expect.objectContaining({ type: 'reasoning' }), expect.objectContaining({ type: 'text' })]) });
  await expect.poll(() => saved('persistent-reply-2')).toBe(true);
  await openHistorySearch.click();
  await historyQuery.fill('searchable answer');
  await expect(historySearch.getByRole('button', { name: title, exact: true })).toHaveAccessibleDescription(/New searchable answer/);
  await historySearch.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Foreign conversation', exact: true })).toHaveCount(0);
  await conversation.focus();
  await expect(more.locator('..')).toHaveCSS('opacity', '1');
  await more.press('ArrowDown');
  const unpin = page.getByRole('menuitem', { name: 'Unpin' });
  await expect(unpin).toBeFocused();
  await unpin.press('Enter');
  await expect(recent.getByRole('button', { name: title, exact: true })).toBeVisible();
  await expect(pin).toBeFocused();
  await expect.poll(() => saved('persistent-reply-2')).toBe(false);
  await page.getByRole('button', { name: 'New chat' }).click();
  await expect(reply).toHaveCount(0);
  await conversation.click();
  await expect(reply).toHaveCount(2);
  await conversation.hover();
  await more.click();
  await expect(page.getByRole('menuitem', { name: 'Pin', exact: true })).toBeVisible();
  await page.getByRole('menuitem', { name: 'Delete', exact: true }).click();
  await expect(reply).toHaveCount(0);
});

test('BYOK can chat through OpenRouter without sending another provider key', async ({ page }) => {
  const routerModel = 'openrouter/vendor/model:free';
  const routerKey = 'test-openrouter-key';
  await page.route('**/gateway/v1/models', async (route) => {
    const heardRouterKey = await route.request().headerValue('x-openrouter-key');
    if (heardRouterKey) expect(heardRouterKey).toBe(routerKey);
    await route.fulfill({ json: { data: [{ id: model }, ...(heardRouterKey ? [{ id: routerModel, type: 'language' }] : [])] } });
  });
  await page.route('**/gateway/api/chat', async (route) => {
    expect(await route.request().headerValue('x-openrouter-key')).toBe(routerKey);
    expect(await route.request().headerValue('x-openai-key')).toBeNull();
    expect(await route.request().headerValue('authorization')).toBeNull();
    expect(route.request().postDataJSON()).toMatchObject({ model: routerModel });
    await route.fulfill({ headers: { 'content-type': 'text/event-stream', 'x-vercel-ai-ui-message-stream': 'v1' },
      body: sse('OpenRouter answer', 1, routerModel) });
  });
  await page.goto('/');
  await showSettings(page);
  await addKey(page);
  await addKey(page, 'OpenRouter', routerKey);
  await closeSettings(page);
  await modelPicker(page).click();
  await page.getByRole('option', { name: /vendor\/model:free/ }).click();
  await page.keyboard.press('Escape');
  const composer = page.getByRole('textbox', { name: 'Message', exact: true });
  await composer.fill('Answer through OpenRouter');
  await composer.press('Enter');
  await expect(page.getByText('OpenRouter answer', { exact: true })).toBeVisible();
});

test('mobile chat: two turns, theme icon switching, draft continuity, and new chat', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockModels(page);
  const bodies: unknown[] = [];
  await page.route('**/gateway/api/chat', async (route) => {
    expect(await route.request().headerValue('x-openai-key')).toBe(fakeKey);
    expect(await route.request().headerValue('authorization')).toBeNull();
    bodies.push(route.request().postDataJSON());
    await route.fulfill({
      headers: { 'content-type': 'text/event-stream', 'x-vercel-ai-ui-message-stream': 'v1' },
      body: sse(bodies.length === 1 ? '**First answer**' : 'Second answer', bodies.length),
    });
  });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Welcome', exact: true })).toBeVisible();
  await showSettings(page); await addKey(page); await closeSettings(page);
  await chooseChatModel(page);
  await modelPicker(page).click();
  await expect(page.getByRole('listbox').getByRole('option')).toHaveCount(1);
  await page.keyboard.press('Escape');
  const composer = page.getByRole('textbox', { name: 'Message', exact: true });
  const send = page.getByRole('button', { name: 'Send', exact: true });
  await expect(send).toBeDisabled();
  await expect(send).toHaveText('');
  await expect(send.locator('svg.lucide-arrow-up')).toBeVisible();
  await composer.fill('First question'); await send.click();
  await expect(page.getByText('First answer', { exact: true })).toBeVisible();
  await composer.fill('Second question');
  const sidebar = page.getByRole('button', { name: 'Toggle navigation' });
  const copy = page.getByRole('button', { name: 'Copy assistant message' });
  for (const theme of ['html', 'fluent', 'shadcn', 'fluent']) {
    const dialog = await showSettings(page);
    await page.getByLabel('Color mode', { exact: true }).selectOption('dark');
    await dialog.getByRole('tab', { name: 'Theme', exact: true }).click();
    await dialog.getByRole('combobox', { name: 'Theme', exact: true }).selectOption(theme);
    await closeSettings(page);
    await expect(page.locator('.streaik-theme')).toHaveAttribute('data-theme', theme);
    await expect(page.locator('.streaik-theme')).toHaveAttribute('data-scheme', 'dark');
    await expect(composer).toHaveValue('Second question');
    await expect(page.getByText('First answer', { exact: true })).toBeVisible();
    for (const control of [sidebar, send, copy]) {
      const icon = control.locator('svg.chat-icon');
      await expect(icon).toBeVisible();
      await expect(icon).toHaveAttribute('aria-hidden', 'true');
      await expect(icon).toHaveAttribute('focusable', 'false');
      if (theme === 'fluent') await expect(icon).not.toHaveClass(/\blucide\b/);
      else await expect(icon).toHaveClass(/\blucide\b/);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  }
  await composer.press('Enter');
  await expect(page.getByText('Second answer', { exact: true })).toBeVisible();
  expect(bodies[1]).toMatchObject({ model, messages: [
    { role: 'system', parts: [{ text: expect.stringContaining('systemInformation') }, { text: expect.stringContaining('preferredLanguage') }] },
    { role: 'user', parts: [{ text: 'First question' }] },
    { role: 'assistant', parts: [{ text: '**First answer**' }], metadata: { model } },
    { role: 'user', parts: [{ text: 'Second question' }] },
  ] });
  await page.getByRole('button', { name: 'New chat', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Welcome', exact: true })).toBeVisible();
  await expect(page.getByText('Second answer', { exact: true })).toHaveCount(0);
});

test.describe('touch navigation', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

  test('history overlays chat, and row actions work without hover', async ({ page }) => {
    await mockModels(page);
    await page.route('**/gateway/api/chat', (route) => route.fulfill({
      headers: { 'content-type': 'text/event-stream', 'x-vercel-ai-ui-message-stream': 'v1' },
      body: sse('Touch reply', 1),
    }));
    await page.goto('/');
    await showSettings(page); await addKey(page); await closeSettings(page);
    await chooseChatModel(page);
    const composer = page.getByRole('textbox', { name: 'Message', exact: true });
    await composer.fill('Touch question');
    await page.getByRole('button', { name: 'Send', exact: true }).tap();
    await expect(page.getByText('Touch reply')).toBeVisible();
    const chatPosition = await page.getByRole('main').boundingBox();
    await page.getByRole('button', { name: 'Toggle navigation' }).tap();
    expect(await page.getByRole('main').boundingBox()).toEqual(chatPosition);
    const more = page.getByRole('button', { name: 'More actions for Touch question' });
    await expect(more.locator('..')).toHaveCSS('opacity', '1');
    await more.tap();
    await page.getByRole('menuitem', { name: 'Pin', exact: true }).tap();
    await expect(page.getByRole('list', { name: 'Pinned' }).getByRole('button', { name: 'Touch question', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Unpin Touch question' }).tap();
    await expect(page.getByRole('list', { name: 'Recent' }).getByRole('button', { name: 'Touch question', exact: true })).toBeVisible();
  });
});

test('errors are recoverable and Stop aborts the in-flight request', async ({ page }) => {
  await page.addInitScript(() => {
    const original = window.fetch.bind(window);
    window.fetch = (input, init) => {
      if (String(input).endsWith('/gateway/api/chat')) init?.signal?.addEventListener('abort', () => {
        document.documentElement.dataset.chatAborted = 'true';
      }, { once: true });
      return original(input, init);
    };
  });
  await mockModels(page);
  let count = 0;
  await page.route('**/gateway/api/chat', async (route) => {
    if (++count === 1) await route.fulfill({ status: 429, body: 'private-upstream-details' });
    // The retry stays pending until the browser aborts it.
  });
  await page.goto('/'); await showSettings(page); await addKey(page); await closeSettings(page);
  await chooseChatModel(page);
  const composer = page.getByRole('textbox', { name: 'Message', exact: true });
  await composer.fill('Will retry'); await composer.press('Enter');
  await expect(page.getByRole('alert')).toContainText('rate-limited');
  await page.getByRole('button', { name: 'Retry' }).click();
  await expect.poll(() => count).toBe(2);
  const dialog = await showSettings(page, 'Theme');
  await dialog.getByRole('combobox', { name: 'Theme', exact: true }).selectOption('html');
  await closeSettings(page);
  await expect.poll(() => count).toBe(2);
  await expect(page.locator('html')).not.toHaveAttribute('data-chat-aborted', 'true');
  const stop = page.getByRole('button', { name: 'Stop', exact: true });
  await expect(stop).toHaveText('');
  await expect(stop).toHaveAttribute('title', 'Stop');
  await expect(stop.locator('svg.lucide-square')).toBeVisible();
  await stop.click();
  await expect(page.locator('html')).toHaveAttribute('data-chat-aborted', 'true');
  await expect(page.getByRole('button', { name: /Send/ })).toBeVisible();
  await expect(page.getByText('private-upstream-details')).toHaveCount(0);
});

test('settings uses an accessible vertical tab rail with an icon-only mobile layout', async ({ page }) => {
  await page.goto('/');
  const dialog = await showSettings(page);
  const tablist = dialog.getByRole('tablist', { name: 'Settings sections' });
  const general = tablist.getByRole('tab', { name: 'General', exact: true });
  const theme = tablist.getByRole('tab', { name: 'Theme', exact: true });
  const apiKeys = tablist.getByRole('tab', { name: 'API keys', exact: true });
  const agents = tablist.getByRole('tab', { name: 'Agents', exact: true });
  const attachments = tablist.getByRole('tab', { name: 'Attachments', exact: true });
  await expect(tablist).toHaveAttribute('aria-orientation', 'vertical');
  await expect(general.locator('span')).toBeVisible();
  await expect(general).toHaveAttribute('aria-selected', 'true');
  await expect(dialog.getByRole('tabpanel')).toHaveCount(1);
  const generalPanel = dialog.getByRole('tabpanel', { name: 'General' });
  await expect(generalPanel.getByLabel('Language', { exact: true })).toBeVisible();
  await expect(generalPanel.getByLabel('Color mode', { exact: true }).getByRole('option')).toHaveText(['System', 'Light', 'Dark']);
  await expect(generalPanel.getByRole('combobox', { name: 'Theme', exact: true })).toHaveCount(0);
  await expect(dialog.getByRole('button', { name: 'Refresh models', exact: true })).toHaveCount(0);
  await general.focus();
  await page.keyboard.press('ArrowDown');
  await expect(theme).toBeFocused();
  await expect(theme).toHaveAttribute('aria-selected', 'true');
  const themePanel = dialog.getByRole('tabpanel', { name: 'Theme' });
  await expect(themePanel.getByRole('combobox', { name: 'Theme', exact: true })).toBeVisible();
  await expect(themePanel.getByRole('group', { name: 'shadcn settings', exact: true })).toBeVisible();
  await expect(themePanel.getByLabel('Color mode', { exact: true })).toHaveCount(0);
  await expect(dialog.getByRole('button', { name: 'Refresh models', exact: true })).toHaveCount(0);
  await page.keyboard.press('ArrowDown');
  await expect(apiKeys).toBeFocused();
  await expect(apiKeys).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('Tab');
  await expect(dialog.getByRole('tabpanel', { name: 'API keys' })).toBeFocused();
  await apiKeys.press('End');
  await expect(attachments).toBeFocused();
  await expect(dialog.getByRole('tabpanel', { name: 'Attachments' }).getByRole('switch')).not.toBeChecked();
  await attachments.press('ArrowUp');
  await expect(agents).toBeFocused();
  await expect(dialog.getByRole('tabpanel', { name: 'Agents' }).getByLabel('Welcome message', { exact: true })).toBeVisible();

  await page.setViewportSize({ width: 360, height: 640 });
  await expect(general.locator('span')).toBeHidden();
  await expect(attachments.locator('svg')).toBeVisible();
  const [first, last] = await Promise.all([general.boundingBox(), attachments.boundingBox()]);
  expect(first?.x).toBe(last?.x);
  expect(first?.y).toBeLessThan(last!.y);
  await page.keyboard.press('Home');
  await expect(general).toBeFocused();
  await page.keyboard.press('ArrowUp');
  await expect(attachments).toBeFocused();
  const attachmentsHint = dialog.getByRole('tooltip', { name: 'Attachments', exact: true });
  await expect(attachmentsHint).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(attachmentsHint).toBeHidden();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(page.getByRole('button', { name: 'Account menu', exact: true })).toBeFocused();
  await showSettings(page);
  await expect(generalPanel).toBeVisible();
});

test('API keys lists only configured providers and opens one empty editor at a time', async ({ page }) => {
  const requests: (string | null)[] = [];
  await page.route('**/gateway/v1/models', async (route) => {
    requests.push(await route.request().headerValue('x-openai-key'));
    await route.fulfill({ json: { data: [{ id: model }] } });
  });
  await page.goto('/');
  const dialog = await showSettings(page);
  const tab = dialog.getByRole('tab', { name: 'API keys' });
  const panel = dialog.getByRole('tabpanel', { name: 'API keys' });
  const list = panel.getByRole('list', { name: 'Configured providers' });
  const add = panel.getByRole('button', { name: 'Add API key', exact: true });
  const picker = panel.getByLabel('Provider', { exact: true });
  const input = panel.getByLabel('OpenAI API key', { exact: true });
  await tab.click();
  await expect(panel.getByText(/No API keys added yet/)).toBeVisible();
  await expect(panel.locator('input[type="password"]')).toHaveCount(0);
  await add.click();
  await expect(picker).toBeFocused();
  await picker.selectOption('openai');
  await expect(input).toBeFocused();
  await input.fill('discard-this-draft');
  await picker.selectOption('anthropic');
  await expect(panel.getByLabel('Anthropic API key', { exact: true })).toHaveValue('');
  await dialog.getByRole('tab', { name: 'Agents' }).click();
  await tab.click();
  await expect(picker).toHaveCount(0);
  await expect(input).toHaveCount(0);

  await addKey(page);
  await expect(list.getByRole('listitem')).toHaveCount(1);
  await expect(list.getByText('OpenAI', { exact: true })).toBeVisible();
  await add.click();
  await expect(picker.locator('option[value="openai"]')).toHaveCount(0);
  await panel.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(add).toBeFocused();
  const replace = list.getByRole('button', { name: 'Replace OpenAI key', exact: true });
  await replace.click();
  await expect(input).toHaveValue('');
  await input.fill('not a valid key');
  await panel.getByRole('button', { name: 'Save OpenAI key', exact: true }).click();
  await expect(panel.getByRole('status')).toHaveText('Enter a nonempty provider key without spaces.');
  await input.fill('test-replacement-key');
  await panel.getByRole('button', { name: 'Save OpenAI key', exact: true }).click();
  await expect(input).toHaveCount(0);
  await expect.poll(() => requests.at(-1)).toBe('test-replacement-key');
  await list.getByRole('button', { name: 'Remove OpenAI key', exact: true }).click();
  await expect(panel.getByRole('status')).toHaveText('Provider key removed.');
  await expect(panel.getByText(/No API keys added yet/)).toBeVisible();
  await add.click();
  await expect(picker.locator('option[value="openai"]')).toHaveCount(1);
});

test('BYOK does not persist session keys; the encrypted vault reloads locked and can be erased', async ({ page }) => {
  await mockModels(page);
  await page.goto('/'); await showSettings(page); await addKey(page);
  const storage = () => page.evaluate(() => JSON.stringify(localStorage));
  expect(await storage()).not.toContain(fakeKey);
  expect(await storage()).not.toContain('streaik.byok.vault');
  const vault = page.getByRole('region', { name: 'Encrypted storage', exact: true });
  await expect(vault.getByText('Session only', { exact: true })).toBeVisible();
  await expect(vault.getByLabel('Vault passphrase')).toHaveCount(0);
  await vault.getByRole('button', { name: 'Set up encrypted storage' }).click();
  await page.getByLabel('Vault passphrase').fill(passphrase);
  await page.getByLabel('Confirm passphrase').fill(passphrase);
  await page.getByRole('button', { name: 'Enable encrypted storage' }).click();
  await expect(page.getByText('Encrypted storage is on.')).toBeVisible();
  expect(await storage()).toContain('ciphertext');
  expect(await storage()).not.toContain(fakeKey);
  expect(await storage()).not.toContain(passphrase);
  await page.getByRole('button', { name: 'Lock vault' }).click();
  await expect(page.getByText('Vault locked.')).toBeVisible();
  await page.reload();
  await expect(page.getByText(/Unlock your provider keys/)).toBeVisible();
  await showSettings(page);
  await expect(page.getByRole('tab', { name: 'Agents', exact: true })).toHaveCount(0);
  await page.getByRole('tab', { name: 'API keys', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Add API key', exact: true })).toHaveCount(0);
  await page.getByLabel('Vault passphrase').fill(passphrase);
  await page.getByRole('button', { name: 'Unlock vault' }).click();
  await expect(page.getByText('Vault unlocked.')).toBeVisible();
  await expect(page.getByRole('list', { name: 'Configured providers' })).toContainText('OpenAI');
  await expect(page.getByRole('tab', { name: 'Agents', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Erase vault', exact: true }).click();
  await page.getByRole('button', { name: 'Confirm erase vault', exact: true }).click();
  await expect(page.getByText('Encrypted vault erased.')).toBeVisible();
  expect(await storage()).not.toContain('streaik.byok.vault');
});

test('Entra sample starts signed out, without a provider-key surface or model requests', async ({ page }) => {
  const requests: string[] = [];
  page.on('request', (request) => {
    const path = new URL(request.url()).pathname;
    if (path.startsWith('/gateway/')) requests.push(path);
  });
  await page.goto('http://localhost:15174');
  await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible();
  await expect(modelPicker(page)).toBeDisabled();
  const dialog = await showSettings(page);
  await expect(dialog.getByRole('tab', { name: 'API keys', exact: true })).toHaveCount(0);
  await expect(dialog.getByRole('tab', { name: 'Agents', exact: true })).toHaveCount(0);
  await dialog.getByRole('tab', { name: 'Account', exact: true }).click();
  await expect(page.getByText('Provider credentials are managed by the gateway.')).toBeVisible();
  await expect(page.getByLabel('OpenAI API key')).toHaveCount(0);
  expect(requests).toEqual([]);
});

test('signed-in Entra has only gateway routes, can browse live models, and clears them on avatar logout', async ({ page }) => {
  // Stub the host auth adapter so this only exercises the UI, without real Microsoft sign-in.
  await page.route((url) => url.port === '15174' && url.pathname === '/src/auth.ts', (route) => route.fulfill({
    contentType: 'application/javascript',
    body: `export async function createEntraAuth() {
      const account = { homeAccountId: 'test-account', environment: 'test', tenantId: 'test', name: 'Taylor Smith', username: 'taylor@example.test' };
      return {
        getAccount: () => account,
        headers: () => new Headers({ Authorization: 'Bearer test-entra-token' }),
        signIn: async () => account,
        signOut: async () => { document.documentElement.dataset.loggedOut = 'true'; },
      };
    }`,
  }));
  await page.route('**/gateway/v1/models', (route) => route.fulfill({ json: { data: [
    { id: model, type: 'language' }, { id: 'openai/gpt-realtime-mini', type: 'audio', tags: ['realtime'] },
  ] } }));
  await page.route('**/gateway/v1/chat/completions', async (route) => {
    expect(await route.request().headerValue('authorization')).toBe('Bearer test-entra-token');
    expect(route.request().postDataJSON()).toMatchObject({ model, stream: true, store: false });
    await route.fulfill({ contentType: 'text/event-stream', body: nativeChatSse('Entra native reply') });
  });
  await page.goto('http://localhost:15174');
  await chooseChatModel(page);
  await modelPicker(page).click();
  await page.getByRole('searchbox', { name: 'Search models', exact: true }).fill('OPENAI');
  await expect(page.getByRole('group', { name: 'OpenAI', exact: true }).getByRole('option')).toHaveText('gpt-4.1-mini');
  await page.keyboard.press('Escape');
  await openRoute(page);
  await expect(page.getByRole('menuitem', { name: 'Direct', exact: true })).toHaveCount(0);
  await expect(page.getByRole('menuitemradio')).toHaveCount(4);
  await expect(page.getByRole('menuitemradio', { name: '/api/chat', exact: true })).toHaveAttribute('aria-checked', 'true');
  await page.getByRole('menuitem', { name: 'Decisions', exact: true }).press('ArrowRight');
  await expect(page.getByRole('menuitemradio', { name: '/v1/decisions', exact: true })).toHaveAttribute('aria-checked', 'true');
  await page.getByRole('menuitemradio', { name: '/api/decisions', exact: true }).click();
  await openRoute(page);
  await expect(page.getByRole('menuitemradio', { name: '/api/chat', exact: true })).toHaveAttribute('aria-checked', 'true');
  await page.getByRole('menuitemradio', { name: '/v1/chat/completions', exact: true }).click();
  const composer = page.getByRole('textbox', { name: 'Message', exact: true });
  await composer.fill('Entra native question'); await composer.press('Enter');
  await expect(page.getByText('Entra native reply', { exact: true })).toBeVisible();
  await expect(page).toHaveURL(/\/c\/[0-9a-f-]{36}$/);
  const conversation = page.url();
  await openCatalog(page, 'Models');
  await page.getByRole('tab', { name: 'Realtime (1)' }).click();
  await expect(page.getByRole('heading', { name: 'gpt-realtime-mini', exact: true })).toBeVisible();
  const avatar = page.getByRole('button', { name: 'Account menu' });
  await expect(avatar).toHaveText('TS');
  await expect(page.getByRole('button', { name: /sign out|log out/i })).toHaveCount(0);
  await avatar.click();
  await expect(page.getByRole('menuitem', { name: 'Settings' })).toBeVisible();
  await page.getByRole('menuitem', { name: 'Log out' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-logged-out', 'true');
  const signIn = page.getByRole('button', { name: 'Sign in', exact: true });
  await expect(signIn).toBeVisible();
  await expect(page).toHaveURL(/\/models$/);
  await expect(page.getByRole('heading', { name: 'Models', exact: true })).toBeVisible();
  await expect(page.getByRole('tablist', { name: 'Model capabilities' })).toHaveCount(0);
  await page.goBack();
  await expect(page).toHaveURL(conversation);
  await expect(page.getByText('This conversation is not available in this browser or profile.')).toBeVisible();
  await expect(page.getByText('Entra native question', { exact: true })).toHaveCount(0);
  await signIn.click();
  await expect(page).toHaveURL(conversation);
  await expect(page.getByText('Entra native reply', { exact: true })).toBeVisible();
});

test('theme settings apply independently, are remembered on reload, and can be reset', async ({ page }) => {
  const fluentModules: string[] = [];
  page.on('request', (request) => {
    if (/\/fluent\.tsx(?:\?|$)|\/deps\/@fluentui/.test(request.url())) fluentModules.push(request.url());
  });
  await page.goto('/');
  const dialog = await showSettings(page, 'Theme');
  const themePanel = dialog.getByRole('tabpanel', { name: 'Theme' });
  const root = page.locator('.streaik-theme');
  const choose = (name: string) => themePanel.getByRole('combobox', { name: 'Theme', exact: true }).selectOption(name);
  const palette = themePanel.getByRole('combobox', { name: 'Palette', exact: true });
  const radius = themePanel.getByRole('combobox', { name: 'Corner radius', exact: true });
  const fluentPreset = themePanel.getByLabel('Fluent preset', { exact: true });
  await expect(root).toHaveAttribute('data-theme', 'shadcn');
  await expect(palette).toHaveClass(/shadcn-select/);
  await expect(palette.locator('svg.lucide-chevron-down')).toBeVisible();
  await palette.focus();
  await palette.press('ArrowDown');
  const list = page.getByRole('listbox');
  // Radix mounts the list before it positions the popover and focuses a row.
  await expect(list.getByRole('option', { name: 'Neutral', exact: true })).toBeFocused();
  await expect(list.getByRole('option', { name: 'Neutral', exact: true }).locator('svg.lucide-check')).toBeVisible();
  await page.keyboard.press('End');
  await expect(list.getByRole('option', { name: 'Rose', exact: true })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(palette).toContainText('Rose');
  await expect(palette).toBeFocused();
  await radius.click();
  await page.getByRole('option', { name: 'Rounded', exact: true }).click();
  await expect(root).toHaveCSS('--radius', '0.9rem');
  await radius.click();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'Settings' })).toBeVisible();
  await expect(radius).toBeFocused();

  await choose('html');
  const textSize = themePanel.getByLabel('Chat text size');
  await textSize.selectOption('larger');
  await expect(root).toHaveCSS('--streaik-chat-text-size', '1.25rem');
  await expect(themePanel.getByRole('group', { name: 'HTML settings' })).toBeVisible();
  expect(fluentModules).toEqual([]);

  await choose('fluent');
  await expect(fluentPreset).toHaveValue('web');
  const webAction = await root.evaluate((node) => getComputedStyle(node).getPropertyValue('--action'));
  await fluentPreset.selectOption('teams');
  await expect(root).not.toHaveCSS('--action', webAction);
  await expect.poll(() => fluentModules.length).toBeGreaterThan(0);

  await choose('shadcn');
  await expect(palette).toContainText('Rose');
  await expect(radius).toContainText('Rounded');
  await themePanel.getByRole('button', { name: 'Reset shadcn settings' }).click();
  await expect(palette).toContainText('Neutral');
  await expect(radius).toContainText('Default');
  await choose('html');
  await expect(textSize).toHaveValue('larger');
  await dialog.getByRole('tab', { name: 'General', exact: true }).click();
  await dialog.getByLabel('Color mode').selectOption('dark');
  await page.reload();
  await expect(root).toHaveAttribute('data-theme', 'html');
  await expect(root).toHaveAttribute('data-scheme', 'dark');
  await expect(page.getByRole('textbox', { name: 'Message', exact: true })).toHaveCSS('font-size', '20px');
  await showSettings(page, 'Theme');
  await expect(textSize).toHaveValue('larger');
  await choose('fluent');
  await expect(fluentPreset).toHaveValue('teams');
});

test('invalid settings are ignored, retaining any independently valid preference', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('streaik.theme', 'shadcn');
    localStorage.setItem('streaik.color-mode', 'light');
    localStorage.setItem('streaik.theme-settings.v1.shadcn', JSON.stringify({ palette: 'not-a-palette', radius: 'sharp', anotherValue: 'ignored' }));
  });
  await page.goto('/');
  await showSettings(page, 'Theme');
  await expect(page.getByRole('combobox', { name: 'Palette', exact: true })).toContainText('Neutral');
  await expect(page.getByRole('combobox', { name: 'Corner radius', exact: true })).toContainText('Sharp');
});
