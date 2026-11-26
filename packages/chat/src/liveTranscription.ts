import { GatewayError, googleLiveTranscriptionSetup, openAITranscriptionSocket } from '@streaik/gateway';
import type { Gateway, Transcript, TranscriptSegment } from '@streaik/gateway';
import { assemblyAITranscript, deepgramTranscript } from './binaryTranscription';
import { getMicrophone, stopTracks } from './microphone';

type Update = (transcript: Transcript, partial: string) => void;
type Stop = { signal: AbortSignal; stop: AbortSignal; ready: () => void; update: Update };
type EventData = Record<string, unknown>;

function record(input: unknown): EventData {
  return input && typeof input === 'object' ? input as EventData : {};
}

function readEvent(data: unknown): EventData {
  if (typeof data !== 'string') return {};
  try { return record(JSON.parse(data)); } catch { return {}; }
}

function wait(target: EventTarget, name: string, signal: AbortSignal, ready = () => false): Promise<void> {
  return new Promise((resolve, reject) => {
    function clear() { target.removeEventListener(name, done); signal.removeEventListener('abort', abort); }
    function done() { clear(); resolve(); }
    function abort() { clear(); reject(signal.reason); }
    target.addEventListener(name, done, { once: true });
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort();
    else if (ready()) done();
  });
}

function untilStop(stop: AbortSignal, signal: AbortSignal) {
  return wait(stop, 'abort', signal, () => stop.aborted);
}

function pcmBase64(bytes: ArrayBuffer) {
  return btoa(String.fromCharCode(...new Uint8Array(bytes)));
}

export async function runMicrophone(gateway: Gateway, model: string, language: string | undefined, events: Stop) {
  const stream = await getMicrophone(events.signal);
  const release = () => stopTracks(stream);
  events.signal.addEventListener('abort', release, { once: true });
  try {
    events.signal.throwIfAborted();
    const credential = await gateway.liveTranscriptionCredential(model, language, AbortSignal.any([events.signal, AbortSignal.timeout(20_000)]));
    events.signal.throwIfAborted();
    if (credential.provider === 'openai') {
      if (openAITranscriptionSocket(model)) await openAISocket(stream, credential.secret, events);
      else await openAI(stream, credential.secret, events);
    } else if (credential.provider === 'google') {
      await google(stream, credential.url, googleLiveTranscriptionSetup(model, language), events);
    } else if (credential.provider === 'deepgram') {
      await binarySocket(stream, credential.url, events, {
        name: 'Deepgram', subprotocols: ['bearer', credential.secret], stop: 'CloseStream', terminal: 'Metadata', message: deepgramTranscript(events.update),
      });
    } else if (credential.provider === 'assemblyai') {
      await binarySocket(stream, credential.url, events, {
        name: 'AssemblyAI', begin: 'Begin', stop: 'Terminate', terminal: 'Termination', minBytes: 640, message: assemblyAITranscript(events.update),
      });
    } else await gladia(stream, credential.url, events);
  } finally { events.signal.removeEventListener('abort', release); release(); }
}

async function capturePcm(stream: MediaStream, rate: number, signal: AbortSignal, setup: AbortSignal, write: (bytes: ArrayBuffer) => void) {
  const audio = new AudioContext({ sampleRate: rate });
  const ready = new EventTarget();
  let source: MediaStreamAudioSourceNode | undefined;
  let pcm: AudioWorkletNode | undefined;
  let mute: GainNode | undefined;
  function close() {
    source?.disconnect();
    pcm?.port.close();
    pcm?.disconnect();
    mute?.disconnect();
    if (audio.state !== 'closed') void audio.close().catch(() => {});
  }
  try {
    // Closing the context aborts capture setup as well as a running worklet.
    setup.addEventListener('abort', close, { once: true });
    setup.throwIfAborted();
    await audio.audioWorklet.addModule(new URL('./microphonePcm.worklet.js', import.meta.url));
    setup.throwIfAborted();
    source = audio.createMediaStreamSource(stream);
    pcm = new AudioWorkletNode(audio, 'streaik-microphone-pcm', { channelCount: 1, channelCountMode: 'explicit' });
    mute = audio.createGain();
    mute.gain.value = 0;
    source.connect(pcm).connect(mute).connect(audio.destination);
    pcm.port.onmessage = event => {
      if (event.data === 'flushed') ready.dispatchEvent(new Event('flushed'));
      else if (!signal.aborted && event.data instanceof ArrayBuffer) write(event.data);
    };
    await audio.resume();
    setup.throwIfAborted();
    signal.addEventListener('abort', close, { once: true });
    return {
      async flush() {
        if (!pcm) return;
        const timeout = AbortSignal.timeout(300);
        const flushed = wait(ready, 'flushed', AbortSignal.any([signal, timeout]));
        pcm.port.postMessage('stop');
        await flushed.catch(error => { if (!timeout.aborted || signal.aborted) throw error; });
      },
      close() { signal.removeEventListener('abort', close); close(); },
    };
  } catch (error) {
    close();
    throw error;
  } finally { setup.removeEventListener('abort', close); }
}

async function binarySocket(stream: MediaStream, url: string, events: Stop, protocol: {
  name: string; subprotocols?: string[]; begin?: string; stop: string; terminal: string; minBytes?: number;
  message: (event: EventData) => void;
}) {
  const failure = new AbortController();
  const signal = AbortSignal.any([events.signal, failure.signal]);
  const startup = AbortSignal.any([signal, AbortSignal.timeout(25_000)]);
  const problem = () => new GatewayError(`${protocol.name} microphone transcription disconnected or failed.`);
  const fail = () => failure.abort(problem());
  let socket: WebSocket;
  try { socket = new WebSocket(url, protocol.subprotocols); } catch { throw problem(); }
  const changes = new EventTarget();
  let begun = !protocol.begin, stopping = false, finished = false;
  let capture: Awaited<ReturnType<typeof capturePcm>> | undefined;
  function send(payload: string | ArrayBuffer) {
    if (signal.aborted) return;
    if (socket.readyState !== WebSocket.OPEN || socket.bufferedAmount > 128_000) { fail(); return; }
    try { socket.send(payload); } catch { fail(); }
  }
  const stopMessage = JSON.stringify({ type: protocol.stop });
  const cancel = () => {
    if (!stopping && socket.readyState === WebSocket.OPEN) {
      try { socket.send(stopMessage); } catch { /* Best effort; do not wait for a response on cancellation. */ }
    }
    socket.close();
  };
  const closed = () => { if (!finished) fail(); };
  const message = (event: MessageEvent) => {
    if (signal.aborted || finished) return;
    const part = readEvent(event.data);
    if (part.type === 'Error' || part.type === 'error' || part.error || part.err_code) { fail(); return; }
    if (!begun && part.type === protocol.begin) { begun = true; changes.dispatchEvent(new Event('begin')); }
    if (!begun || (part.type === protocol.terminal && !stopping)) return;
    protocol.message(part);
    if (part.type === protocol.terminal) { finished = true; changes.dispatchEvent(new Event('finished')); }
  };
  events.signal.addEventListener('abort', cancel, { once: true });
  socket.addEventListener('message', message);
  socket.addEventListener('close', closed);
  socket.addEventListener('error', fail);
  try {
    await wait(socket, 'open', startup, () => socket.readyState === WebSocket.OPEN);
    if (protocol.begin) await wait(changes, 'begin', startup, () => begun);
    capture = await capturePcm(stream, 16000, signal, startup, bytes => {
      if (protocol.minBytes && bytes.byteLength < protocol.minBytes) {
        // A flushed tail can be shorter than AssemblyAI's 20 ms minimum.
        const padded = new Uint8Array(protocol.minBytes);
        padded.set(new Uint8Array(bytes));
        send(padded.buffer);
      } else send(bytes);
    });
    startup.throwIfAborted();
    events.ready();
    await untilStop(events.stop, signal);
    await capture.flush();
    capture.close();
    capture = undefined;
    stopTracks(stream);
    signal.throwIfAborted();
    stopping = true;
    send(stopMessage);
    const drain = AbortSignal.timeout(7000);
    await wait(changes, 'finished', AbortSignal.any([signal, drain]), () => finished).catch(error => {
      if (!drain.aborted || signal.aborted) throw error;
      throw new GatewayError(`${protocol.name} did not confirm the end of the microphone session.`);
    });
  } finally {
    capture?.close();
    events.signal.removeEventListener('abort', cancel);
    socket.removeEventListener('message', message);
    socket.removeEventListener('close', closed);
    socket.removeEventListener('error', fail);
    socket.close();
  }
}

async function openAISocket(stream: MediaStream, secret: string, events: Stop) {
  const failure = new AbortController();
  const signal = AbortSignal.any([events.signal, failure.signal]);
  const startup = AbortSignal.any([signal, AbortSignal.timeout(25_000)]);
  const fail = () => failure.abort(new GatewayError('OpenAI microphone transcription disconnected or failed.'));
  // Pass only the ephemeral client secret, in the provider's browser WebSocket subprotocol.
  const socket = new WebSocket('wss://api.openai.com/v1/realtime?intent=transcription', ['realtime', `openai-insecure-api-key.${secret}`]);
  const changes = new EventTarget();
  const turns = new Map<string, { partial: string; final?: string }>();
  let capture: Awaited<ReturnType<typeof capturePcm>> | undefined;
  let bytesSent = 0;
  let committing = false;
  let committedId = '';
  let finished = false;
  const close = () => socket.close();
  const sendAudio = (bytes: ArrayBuffer) => {
    if (socket.readyState !== WebSocket.OPEN || socket.bufferedAmount > 128_000) { fail(); return; }
    socket.send(JSON.stringify({ type: 'input_audio_buffer.append', audio: pcmBase64(bytes) }));
    bytesSent += bytes.byteLength;
  };
  const message = (event: MessageEvent) => {
    const part = readEvent(event.data);
    if (part.type === 'error' || part.type === 'conversation.item.input_audio_transcription.failed') { fail(); return; }
    const id = typeof part.item_id === 'string' ? part.item_id : '';
    if (committing && part.type === 'input_audio_buffer.committed') committedId = id;
    if (part.type !== 'conversation.item.input_audio_transcription.delta' && part.type !== 'conversation.item.input_audio_transcription.completed') return;
    const turn = turns.get(id) ?? { partial: '' };
    if (part.type === 'conversation.item.input_audio_transcription.delta' && typeof part.delta === 'string' && turn.final === undefined) {
      turn.partial += part.delta;
    }
    if (part.type === 'conversation.item.input_audio_transcription.completed' && typeof part.transcript === 'string') {
      turn.final = part.transcript;
      turn.partial = '';
      if (committing && (!committedId || id === committedId)) finished = true;
    }
    turns.set(id, turn);
    events.update({ text: [...turns.values()].map(turn => turn.final?.trim()).filter(Boolean).join(' '), segments: [] },
      [...turns.values()].map(turn => turn.partial.trim()).filter(Boolean).join(' '));
    if (finished) changes.dispatchEvent(new Event('finished'));
  };
  events.signal.addEventListener('abort', close, { once: true });
  socket.addEventListener('close', fail);
  socket.addEventListener('error', fail);
  socket.addEventListener('message', message);
  try {
    await wait(socket, 'open', startup, () => socket.readyState === WebSocket.OPEN);
    capture = await capturePcm(stream, 24000, signal, startup, sendAudio);
    startup.throwIfAborted();
    events.ready();
    await untilStop(events.stop, signal);
    await capture.flush();
    stopTracks(stream);
    if (!bytesSent) return;
    // The provider requires at least 100 ms in an explicitly committed buffer.
    if (bytesSent < 4800) sendAudio(new ArrayBuffer(4800 - bytesSent));
    signal.throwIfAborted();
    committing = true;
    socket.send(JSON.stringify({ type: 'input_audio_buffer.commit' }));
    const drain = AbortSignal.timeout(10_000);
    await wait(changes, 'finished', AbortSignal.any([signal, drain]), () => finished).catch(error => {
      if (!drain.aborted || signal.aborted) throw error;
      throw new GatewayError('OpenAI did not finish the last microphone segment.');
    });
  } finally {
    capture?.close();
    events.signal.removeEventListener('abort', close);
    socket.removeEventListener('close', fail);
    socket.removeEventListener('error', fail);
    socket.removeEventListener('message', message);
    close();
  }
}

async function openAI(stream: MediaStream, secret: string, events: Stop) {
  const failure = new AbortController();
  const signal = AbortSignal.any([events.signal, failure.signal]);
  const startup = AbortSignal.any([signal, AbortSignal.timeout(25_000)]);
  const fail = () => failure.abort(new GatewayError('OpenAI microphone transcription disconnected or failed.'));
  const pc = new RTCPeerConnection();
  const channel = pc.createDataChannel('oai-events');
  const changes = new EventTarget();
  const turns = new Map<string, { previous?: string; final?: string; partial: string }>();
  const pending = new Set<string>();
  let speaking: string | undefined;
  let awaitingCommit = false;
  let commitId = '';
  const close = () => { channel.close(); pc.close(); };
  const connectionState = () => { if (pc.connectionState === 'failed' || pc.connectionState === 'closed') fail(); };
  const message = (event: MessageEvent) => {
    const part = readEvent(event.data);
    const id = typeof part.item_id === 'string' ? part.item_id : undefined;
    const type = part.type;
    if (type === 'error') {
      const error = record(part.error);
      if (awaitingCommit && error.event_id === commitId && error.code === 'input_audio_buffer_commit_empty') {
        awaitingCommit = false;
        if (speaking) pending.delete(speaking);
        speaking = undefined;
      } else fail();
    }
    if (id) {
      const turn = turns.get(id) ?? { partial: '' };
      if (type === 'input_audio_buffer.speech_started') { speaking = id; pending.add(id); }
      if (type === 'input_audio_buffer.committed') {
        awaitingCommit = false;
        if (!speaking || speaking === id) speaking = undefined;
        if (turn.final === undefined) pending.add(id);
        if (typeof part.previous_item_id === 'string') turn.previous = part.previous_item_id;
      }
      if (type === 'conversation.item.input_audio_transcription.delta' && typeof part.delta === 'string' && turn.final === undefined) {
        turn.partial += part.delta;
        pending.add(id);
      }
      if (type === 'conversation.item.input_audio_transcription.completed' && typeof part.transcript === 'string') {
        turn.final = part.transcript;
        turn.partial = '';
        pending.delete(id);
      }
      if (type === 'conversation.item.input_audio_transcription.failed') fail();
      turns.set(id, turn);
      const ordered: (typeof turn)[] = [];
      const seen = new Set<string>();
      function visit(key: string) {
        const value = turns.get(key);
        if (!value || seen.has(key)) return;
        seen.add(key);
        if (value.previous) visit(value.previous);
        ordered.push(value);
      }
      for (const key of turns.keys()) visit(key);
      events.update({ text: ordered.flatMap(x => x.final?.trim() || []).join(' '), segments: [] },
        ordered.map(x => x.partial.trim()).filter(Boolean).join(' '));
    }
    changes.dispatchEvent(new Event('transcript'));
  };
  events.signal.addEventListener('abort', close, { once: true });
  pc.addEventListener('connectionstatechange', connectionState);
  channel.addEventListener('message', message);
  channel.addEventListener('close', fail);
  channel.addEventListener('error', fail);
  try {
    for (const track of stream.getAudioTracks()) pc.addTrack(track);
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    const response = await fetch('https://api.openai.com/v1/realtime/calls', { method: 'POST', body: offer.sdp, signal: startup,
      redirect: 'error', credentials: 'omit', cache: 'no-store', headers: { Authorization: `Bearer ${secret}`, 'Content-Type': 'application/sdp' } });
    if (!response.ok) throw new GatewayError('OpenAI could not start the microphone session. Start again.');
    await pc.setRemoteDescription({ type: 'answer', sdp: await response.text() });
    await wait(channel, 'open', startup, () => channel.readyState === 'open');
    events.ready();
    await untilStop(events.stop, signal);
    stopTracks(stream);
    if (speaking) {
      awaitingCommit = true;
      commitId = crypto.randomUUID();
      channel.send(JSON.stringify({ type: 'input_audio_buffer.commit', event_id: commitId }));
    }
    const drain = AbortSignal.timeout(5000);
    try {
      const deadline = AbortSignal.any([signal, drain]);
      while (awaitingCommit || pending.size) await wait(changes, 'transcript', deadline);
    } catch (error) {
      if (!drain.aborted || signal.aborted) throw error;
      throw new GatewayError('OpenAI did not finish the last microphone segment.');
    }
  } finally {
    events.signal.removeEventListener('abort', close);
    channel.removeEventListener('message', message);
    channel.removeEventListener('close', fail);
    channel.removeEventListener('error', fail);
    pc.removeEventListener('connectionstatechange', connectionState);
    close();
  }
}

async function google(stream: MediaStream, url: string, setup: ReturnType<typeof googleLiveTranscriptionSetup>, events: Stop) {
  const failure = new AbortController();
  const signal = AbortSignal.any([events.signal, failure.signal]);
  const startup = AbortSignal.any([signal, AbortSignal.timeout(25_000)]);
  const fail = () => failure.abort(new GatewayError('Google microphone transcription disconnected or failed.'));
  const ws = new WebSocket(url);
  ws.binaryType = 'arraybuffer';
  const changes = new EventTarget();
  const decoder = new TextDecoder();
  const confirmed: string[] = [];
  let partial = '', setupReady = false, sentAudio = false, stopping = false, closedCleanly = false;
  let capture: Awaited<ReturnType<typeof capturePcm>> | undefined;
  const close = () => ws.close();
  const closed = (event: CloseEvent) => {
    if (stopping && event.wasClean && event.code === 1000) {
      closedCleanly = true;
      changes.dispatchEvent(new Event('finished'));
    } else fail();
  };
  const message = (event: MessageEvent) => {
    const part = readEvent(event.data instanceof ArrayBuffer ? decoder.decode(event.data) : event.data);
    if (part.error) { fail(); return; }
    if (part.setupComplete && !setupReady) {
      setupReady = true;
      changes.dispatchEvent(new Event('setup'));
    }
    if (!setupReady || signal.aborted) return;
    const content = record(part.serverContent);
    const final = record(content.inputTranscription).text;
    const interim = record(content.interimInputTranscription).text;
    // VERBATIM finals are new segments, not replacements of the full transcript.
    // Never consume modelTurn or outputTranscription as microphone input.
    if (typeof final === 'string') {
      if (final.trim()) confirmed.push(final.trim());
      partial = '';
    }
    if (typeof interim === 'string') partial = interim.trim();
    if (typeof final === 'string' || typeof interim === 'string') events.update({ text: confirmed.join(' '), segments: [] }, partial);
  };
  events.signal.addEventListener('abort', close, { once: true });
  ws.addEventListener('message', message);
  ws.addEventListener('close', closed);
  ws.addEventListener('error', fail);
  try {
    await wait(ws, 'open', startup, () => ws.readyState === WebSocket.OPEN);
    ws.send(JSON.stringify({ setup }));
    await wait(changes, 'setup', startup, () => setupReady);
    capture = await capturePcm(stream, 16000, signal, startup, bytes => {
      if (ws.readyState !== WebSocket.OPEN || ws.bufferedAmount > 128_000) { fail(); return; }
      ws.send(JSON.stringify({ realtimeInput: { audio: { data: pcmBase64(bytes), mimeType: 'audio/pcm;rate=16000' } } }));
      sentAudio = true;
    });
    startup.throwIfAborted();
    events.ready();
    await untilStop(events.stop, signal);
    await capture.flush();
    capture.close();
    capture = undefined;
    stopTracks(stream);
    if (!sentAudio) return;
    signal.throwIfAborted();
    stopping = true;
    ws.send(JSON.stringify({ realtimeInput: { audioStreamEnd: true } }));
    // Input transcripts can arrive independently of turnComplete. Allow a bounded drain even if a turn already ended.
    const drain = AbortSignal.timeout(2500);
    await wait(changes, 'finished', AbortSignal.any([signal, drain]), () => closedCleanly).catch(error => {
      if (!drain.aborted || signal.aborted) throw error;
    });
    if (partial) throw new GatewayError('Google did not finish the last microphone segment.');
  } finally {
    capture?.close();
    events.signal.removeEventListener('abort', close);
    ws.removeEventListener('message', message);
    ws.removeEventListener('close', closed);
    ws.removeEventListener('error', fail);
    close();
  }
}

async function gladia(stream: MediaStream, url: string, events: Stop) {
  const failure = new AbortController();
  const signal = AbortSignal.any([events.signal, failure.signal]);
  const startup = AbortSignal.any([signal, AbortSignal.timeout(25_000)]);
  const fail = () => failure.abort(new GatewayError('Gladia microphone transcription disconnected or failed.'));
  const ws = new WebSocket(url);
  let capture: Awaited<ReturnType<typeof capturePcm>> | undefined;
  let stopping = false, finished = false;
  const changes = new EventTarget();
  const confirmed: TranscriptSegment[] = [];
  const close = () => { ws.close(); };
  const closed = (event: CloseEvent) => {
    if (stopping && event.wasClean) { finished = true; changes.dispatchEvent(new Event('finished')); }
    else fail();
  };
  const message = (event: MessageEvent) => {
    const part = readEvent(event.data);
    if (part.type === 'error') { fail(); return; }
    const data = record(part.data);
    if (stopping && part.type === 'post_final_transcript') { finished = true; changes.dispatchEvent(new Event('finished')); }
    if (part.type !== 'transcript') return;
    const { text, start, end, speaker, language } = record(data.utterance);
    if (typeof text !== 'string') return;
    if (data.is_final) confirmed.push({ text, startSecond: typeof start === 'number' ? start : 0,
      endSecond: typeof end === 'number' ? end : 0, speaker: typeof speaker === 'string' || typeof speaker === 'number' ? String(speaker) : undefined });
    events.update({ text: confirmed.map(segment => segment.text.trim()).filter(Boolean).join(' '), segments: [...confirmed],
      language: typeof language === 'string' ? language : undefined }, data.is_final ? '' : text);
  };
  events.signal.addEventListener('abort', close, { once: true });
  ws.addEventListener('message', message);
  ws.addEventListener('close', closed);
  ws.addEventListener('error', fail);
  try {
    await wait(ws, 'open', startup, () => ws.readyState === WebSocket.OPEN);
    capture = await capturePcm(stream, 16000, signal, startup, bytes => {
      if (ws.readyState !== WebSocket.OPEN) return;
      if (ws.bufferedAmount > 128_000) { fail(); return; }
      ws.send(bytes);
    });
    startup.throwIfAborted();
    events.ready();
    await untilStop(events.stop, signal);
    await capture.flush();
    stopTracks(stream);
    stopping = true;
    ws.send(JSON.stringify({ type: 'stop_recording' }));
    const drain = AbortSignal.timeout(7000);
    await wait(changes, 'finished', AbortSignal.any([signal, drain]), () => finished).catch(error => {
      if (!drain.aborted || signal.aborted) throw error;
      throw new GatewayError('Gladia did not confirm the end of the microphone session.');
    });
  } finally {
    capture?.close();
    events.signal.removeEventListener('abort', close);
    ws.removeEventListener('message', message);
    ws.removeEventListener('close', closed);
    ws.removeEventListener('error', fail);
    close();
  }
}
