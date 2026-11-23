import { GatewayError } from '@streaik/gateway';
import type { Gateway, Transcript, TranscriptSegment } from '@streaik/gateway';

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

function stopTracks(stream: MediaStream) {
  for (const track of stream.getTracks()) track.stop();
}

export async function runMicrophone(gateway: Gateway, model: string, language: string | undefined, events: Stop) {
  if (!navigator.mediaDevices?.getUserMedia) throw new GatewayError('Microphone access requires a secure browser context.');
  let stream: MediaStream;
  try { stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1 } }); }
  catch (error) {
    if (error instanceof DOMException && error.name === 'NotAllowedError') throw new GatewayError('Allow microphone access to start transcription.');
    throw new GatewayError('Could not access a microphone.');
  }
  const release = () => stopTracks(stream);
  events.signal.addEventListener('abort', release, { once: true });
  try {
    events.signal.throwIfAborted();
    const credential = await gateway.liveTranscriptionCredential(model, language, AbortSignal.any([events.signal, AbortSignal.timeout(20_000)]));
    events.signal.throwIfAborted();
    if (credential.provider === 'openai') await openAI(stream, credential.secret, events);
    else await gladia(stream, credential.url, events);
  } finally { events.signal.removeEventListener('abort', release); release(); }
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

async function gladia(stream: MediaStream, url: string, events: Stop) {
  const failure = new AbortController();
  const signal = AbortSignal.any([events.signal, failure.signal]);
  const startup = AbortSignal.any([signal, AbortSignal.timeout(25_000)]);
  const fail = () => failure.abort(new GatewayError('Gladia microphone transcription disconnected or failed.'));
  const ws = new WebSocket(url);
  let audio: AudioContext | undefined;
  let source: MediaStreamAudioSourceNode | undefined;
  let pcm: AudioWorkletNode | undefined;
  let mute: GainNode | undefined;
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
    audio = new AudioContext({ sampleRate: 16000 });
    await Promise.all([wait(ws, 'open', startup, () => ws.readyState === WebSocket.OPEN),
      audio.audioWorklet.addModule(new URL('./gladiaPcm.worklet.js', import.meta.url))]);
    startup.throwIfAborted();
    source = audio.createMediaStreamSource(stream);
    pcm = new AudioWorkletNode(audio, 'streaik-gladia-pcm', { channelCount: 1, channelCountMode: 'explicit' });
    mute = audio.createGain();
    mute.gain.value = 0;
    source.connect(pcm).connect(mute).connect(audio.destination);
    pcm.port.onmessage = event => {
      if (event.data === 'flushed') { changes.dispatchEvent(new Event('flushed')); return; }
      if (signal.aborted || ws.readyState !== WebSocket.OPEN) return;
      if (ws.bufferedAmount > 128_000) { fail(); return; }
      ws.send(event.data);
    };
    await audio.resume();
    startup.throwIfAborted();
    events.ready();
    await untilStop(events.stop, signal);
    stopTracks(stream);
    const flush = AbortSignal.timeout(300);
    pcm.port.postMessage('stop');
    await wait(changes, 'flushed', AbortSignal.any([signal, flush])).catch(error => { if (!flush.aborted || signal.aborted) throw error; });
    stopping = true;
    ws.send(JSON.stringify({ type: 'stop_recording' }));
    const drain = AbortSignal.timeout(7000);
    await wait(changes, 'finished', AbortSignal.any([signal, drain]), () => finished).catch(error => {
      if (!drain.aborted || signal.aborted) throw error;
      throw new GatewayError('Gladia did not confirm the end of the microphone session.');
    });
  } finally {
    events.signal.removeEventListener('abort', close);
    ws.removeEventListener('message', message);
    ws.removeEventListener('close', closed);
    ws.removeEventListener('error', fail);
    close();
    source?.disconnect();
    pcm?.port.close();
    pcm?.disconnect();
    mute?.disconnect();
    if (audio && audio.state !== 'closed') await audio.close().catch(() => {});
  }
}
