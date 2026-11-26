import type { Gateway } from '@streaik/gateway';
import { capturePcm } from './liveTranscription';
import { stopTracks } from './microphone';
import { encodeVoiceAudio, voicePlayback, voiceSampleRate } from './socketVoiceAudio';
import { createSocketVoiceProtocol } from './socketVoiceProtocol';
import type { SocketVoiceSetup } from './socketVoiceSettings';
import type { VoiceCallbacks, VoiceSession } from './voiceConversation';

export async function startSocketVoiceConversation(gateway: Gateway, model: string, setup: SocketVoiceSetup,
  signal: AbortSignal, events: VoiceCallbacks): Promise<VoiceSession> {
  signal.throwIfAborted();
  const label = setup.provider === 'google' ? 'Gemini Live' : 'Grok Voice';
  const lifetime = new AbortController();
  const audio = new AudioContext();
  const playback = voicePlayback(audio, setup.output);
  const resumed = audio.resume();
  void resumed.catch(() => {});
  let stream: MediaStream | undefined, socket: WebSocket | undefined, capture: Awaited<ReturnType<typeof capturePcm>> | undefined;
  let stopped = false, stopping = false, ready = false;
  let closeTimer: ReturnType<typeof setTimeout> | undefined;
  const startup = setTimeout(() => finish(new Error(`${label} did not connect in time.`)), 30_000);
  const abort = () => finish();
  let opened!: () => void, closed!: (error: Error) => void;
  const handshake = new Promise<void>((resolve, reject) => { opened = resolve; closed = reject; });
  void handshake.catch(() => {});
  // Abort releases resources immediately even if the browser leaves its microphone prompt open.
  const cancelled = new Promise<never>((_, reject) => lifetime.signal.addEventListener('abort', () => reject(lifetime.signal.reason), { once: true }));
  void cancelled.catch(() => {});
  const adapter = createSocketVoiceProtocol(setup, { ...events, closed: () => finish() }, {
    send(event) {
      if (socket?.readyState !== WebSocket.OPEN || socket.bufferedAmount > 1024 * 1024) throw new Error(`${label} connection cannot accept more data.`);
      const payload = JSON.stringify(event);
      if (payload.length > 256_000) throw new Error('A voice session message exceeded the size limit.');
      socket.send(payload);
    },
    ready: opened, play: playback.play, interrupt: playback.interrupt,
  });
  function finish(error?: Error) {
    if (stopped) return;
    stopped = true;
    clearTimeout(startup); clearTimeout(closeTimer);
    signal.removeEventListener('abort', abort);
    capture?.close();
    if (stream) stopTracks(stream);
    playback.interrupt();
    if (audio.state !== 'closed') void audio.close().catch(() => {});
    if (socket) { socket.onopen = socket.onmessage = socket.onerror = socket.onclose = null; socket.close(); }
    const reason = error ?? new DOMException('Aborted', 'AbortError');
    closed(reason);
    lifetime.abort(reason);
    if (error) events.failure(error); else events.closed();
  }
  // Never pass through a WebSocket exception or close reason; the URL can contain a temporary credential.
  const failure = () => new Error(`${label} disconnected. Check the selected model and realtime settings.`);
  function run(action: () => void) {
    if (!stopped) try { action(); } catch (error) { finish(error instanceof Error ? error : failure()); }
  }
  signal.addEventListener('abort', abort, { once: true });
  try {
    await Promise.race([cancelled, (async () => {
      const microphone = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true } });
      if (lifetime.signal.aborted) { stopTracks(microphone); lifetime.signal.throwIfAborted(); }
      stream = microphone;
      if (!stream.getAudioTracks().length) throw new DOMException('No microphone was found.', 'NotFoundError');
      const credential = await gateway.realtimeVoiceCredential(model, setup.tokenOptions, lifetime.signal);
      lifetime.signal.throwIfAborted();
      try { socket = new WebSocket(credential.url, credential.protocols); } catch { throw failure(); }
      socket.binaryType = 'arraybuffer';
      socket.onopen = () => run(adapter.open);
      socket.onerror = socket.onclose = () => finish(stopping ? undefined : failure());
      socket.onmessage = ({ data }) => run(() => {
        const json = typeof data === 'string' ? data.length <= 512_000 ? data : undefined
          : data instanceof ArrayBuffer && data.byteLength <= 512_000 ? new TextDecoder().decode(data) : undefined;
        if (!json) throw failure();
        let event: unknown;
        try { event = JSON.parse(json); } catch { throw failure(); }
        adapter.receive(event);
      });
      await Promise.all([handshake, resumed]);
      lifetime.signal.throwIfAborted();
      capture = await capturePcm(stream, voiceSampleRate(setup.input), lifetime.signal, lifetime.signal,
        pcm => run(() => { if (ready && !stopping) adapter.audio(encodeVoiceAudio(pcm, setup.input), pcm.byteLength); }));
      lifetime.signal.throwIfAborted();
      ready = true;
    })()]);
    clearTimeout(startup);
  } catch (error) {
    if (!stopped) finish(error instanceof Error ? error : failure());
    throw error;
  }
  return {
    manualTurn: () => run(adapter.manualTurn),
    toolResult: (id, value) => run(() => adapter.toolResult(id, value)),
    continueTools: (choice, end) => run(() => adapter.continueTools(choice, end)),
    comment: () => {}, // Client delegation belongs to OpenAI GPT Live only.
    stop: () => run(() => {
      if (stopping) return;
      stopping = true;
      capture?.close(); capture = undefined;
      if (stream) { stopTracks(stream); stream = undefined; }
      if (adapter.stop()) closeTimer = setTimeout(() => finish(), 1200); else finish();
    }),
  };
}
