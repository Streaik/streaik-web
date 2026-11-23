import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

const batchModel = 'openai/gpt-4o-transcribe';
const liveModel = 'openai/gpt-realtime-transcribe';
const googleModel = 'google/gemini-3.5-transcribe-live';
const googleSocket = 'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContentConstrained';
const file = { name: 'interview.wav', mimeType: 'audio/wav', buffer: Buffer.from('audio fixture') };
const start = (page: Page) => page.getByRole('button', { name: 'Real-time', exact: true });
const stop = (page: Page) => page.getByRole('button', { name: 'Stop Real-time', exact: true });
const preview = (page: Page) => page.getByRole('article', { name: 'Streaming transcript' });

async function openTranscriptions(page: Page, provider = 'OpenAI', models: { id: string; type: string; tags?: string[] }[] = [
    { id: batchModel, type: 'transcription' }, { id: liveModel, type: 'transcription', tags: ['realtime'] },
    { id: 'gladia/solaria-1', type: 'transcription', tags: ['realtime'] },
  ]) {
  await page.route('**/gateway/v1/models', route => route.fulfill({ json: { data: models } }));
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
      return route.fulfill({ json: { text: 'JSON transcript', segments: [{ text: 'JSON transcript', startSecond: 0, endSecond: 1 }],
        providerMetadata: { openai: { segments: [{ text: 'JSON transcript', start: 0, end: 1, speaker: 'A' }] } } } });
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
  await page.getByLabel('Real-time model').selectOption('gladia/solaria-1');
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

test('GPT Live Transcribe stays enabled with no file model and uses ephemeral WebSocket transcription', async ({ page }) => {
  const model = 'openai/gpt-live-transcribe';
  await mockAudio(page);
  await page.route('**/gateway/v1/realtime/client_secrets', async route => {
    expect(route.request().postDataJSON()).toEqual({ session: { type: 'transcription', audio: { input: {
      format: { type: 'audio/pcm', rate: 24000 }, transcription: { model, languages: ['nl'] }, turn_detection: null,
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
  await openTranscriptions(page, 'OpenAI', [{ id: model, type: 'transcription' }]);
  await expect(start(page)).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Dictate', exact: true })).toBeDisabled();
  await expect(page.getByText('Dictate needs a file transcription model.')).toBeVisible();
  await page.getByRole('button', { name: 'Transcription settings' }).click();
  await expect(page.getByLabel('Real-time model')).toHaveValue(model);
  await page.getByLabel('Audio language (optional)').fill('nl');
  await page.getByRole('button', { name: 'Done', exact: true }).click();
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
    inputAudioTranscription: { languageCodes: ['nl-NL'], mode: 'VERBATIM' } };
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
  await expect(start(page)).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Dictate', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Transcription settings' }).click();
  await expect(page.getByLabel('Real-time model')).toHaveValue(googleModel);
  await expect(page.getByLabel('Real-time model').locator('option')).toHaveCount(1);
  await page.getByLabel('Audio language (optional)').fill('nl-NL');
  await page.getByRole('button', { name: 'Done', exact: true }).click();
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

test('Google Live Transcribe rejects untrusted socket targets and releases the mic when setup is cancelled', async ({ page }) => {
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
    // Never acknowledge: this verifies capture stays cancellable while setup is pending.
  });
  await openTranscriptions(page, 'Google Gemini', [{ id: googleModel, type: 'transcription' }]);
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
});

test('Dictate warns, records only on confirmation, submits on Stop, and keeps a failed recording for retry', async ({ page }) => {
  await mockAudio(page);
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
