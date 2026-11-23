import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

const batchModel = 'openai/gpt-4o-transcribe';
const liveModel = 'openai/gpt-realtime-transcribe';
const file = { name: 'interview.wav', mimeType: 'audio/wav', buffer: Buffer.from('audio fixture') };
const start = (page: Page) => page.getByRole('button', { name: 'Start microphone transcription' });
const stop = (page: Page) => page.getByRole('button', { name: 'Stop microphone transcription' });
const preview = (page: Page) => page.getByRole('article', { name: 'Streaming transcript' });

async function openTranscriptions(page: Page, provider = 'OpenAI') {
  await page.route('**/gateway/v1/models', route => route.fulfill({ json: { data: [
    { id: batchModel, type: 'transcription' }, { id: liveModel, type: 'transcription', tags: ['realtime'] },
    { id: 'gladia/solaria-1', type: 'transcription', tags: ['realtime'] },
  ] } }));
  await page.route('**/gateway/v1/skills?*', route => route.fulfill({ json: { data: [], has_more: false } }));
  await page.goto('/');
  await page.getByRole('button', { name: 'Account menu' }).click();
  await page.getByRole('menuitem', { name: 'Settings' }).click();
  const dialog = page.getByRole('dialog', { name: 'Settings', exact: true });
  await dialog.getByRole('tab', { name: 'API keys' }).click();
  await dialog.getByRole('button', { name: 'Add API key' }).click();
  await dialog.getByLabel('Provider', { exact: true }).selectOption({ label: provider });
  await dialog.getByLabel(`${provider} API key`, { exact: true }).fill('fixture-provider-key');
  await dialog.getByRole('button', { name: `Save ${provider} key` }).click();
  await expect(dialog.getByRole('status')).toHaveText('Provider key saved.');
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();
  await page.getByRole('button', { name: 'Transcriptions', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Transcriptions', exact: true })).toBeVisible();
}

async function chooseRoute(page: Page, path: string) {
  await page.getByRole('button', { name: 'Account menu' }).click();
  await page.getByRole('menuitem', { name: 'Route', exact: true }).hover();
  await page.getByRole('menuitemradio', { name: path, exact: true }).click();
}

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
      return route.fulfill({ json: { text: 'JSON transcript', segments: [{ text: 'JSON transcript', startSecond: 0, endSecond: 1, speaker: 'A' }] } });
    }
    expect(request.postDataJSON().inputAudioFormat).toEqual({ type: 'audio/wav' });
    return route.fulfill({ contentType: 'text/event-stream', body: 'data: {"type":"transcript-delta","delta":"Incoming transcript"}\r\n\r\n' +
      (++streamingAttempt > 1 ? 'data: {"type":"finish","text":"Final stream transcript"}\n\n' : '') });
  });
  await openTranscriptions(page);
  const composer = page.getByRole('form', { name: 'Transcription composer' });
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
  await expect(page.getByRole('tabpanel', { name: 'Finished' }).getByRole('article')).toHaveCount(3);
  await page.getByRole('article').filter({ hasText: 'Final stream transcript' }).getByRole('button', { name: 'Delete' }).click();
  await expect(page.getByRole('tabpanel', { name: 'Finished' }).getByRole('article')).toHaveCount(2);
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
  await start(page).click();
  await expect(page.getByText('Listening…', { exact: true })).toBeVisible();
  async function event(type: string, fields: Record<string, string>) {
    await page.evaluate(detail => window.dispatchEvent(new CustomEvent('fixture-openai', { detail })), { type, ...fields });
  }
  await event('conversation.item.input_audio_transcription.delta', { item_id: 'one', delta: 'Draft words' });
  await expect(preview(page)).toContainText('Draft words');
  await event('conversation.item.input_audio_transcription.completed', { item_id: 'one', transcript: 'Confirmed words' });
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
  await page.getByRole('button', { name: 'Transcription settings' }).click();
  await page.getByLabel('Microphone model').selectOption('gladia/solaria-1');
  await page.getByRole('button', { name: 'Done', exact: true }).click();
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
