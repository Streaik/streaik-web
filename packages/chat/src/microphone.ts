import { GatewayError } from '@streaik/gateway';

export function stopTracks(stream: MediaStream) {
  for (const track of stream.getTracks()) track.stop();
}

export async function getMicrophone(signal: AbortSignal) {
  if (!navigator.mediaDevices?.getUserMedia) throw new GatewayError('Microphone access requires a secure browser context.');
  signal.throwIfAborted();
  let stream: MediaStream;
  try { stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1 } }); }
  catch (error) {
    if (error instanceof DOMException && error.name === 'NotAllowedError') throw new GatewayError('Allow microphone access to start transcription.');
    throw new GatewayError('Could not access a microphone.');
  }
  if (signal.aborted) {
    stopTracks(stream);
    signal.throwIfAborted();
  }
  return stream;
}

const formats = [['audio/webm', 'webm'], ['audio/mp4', 'm4a'], ['audio/ogg', 'ogg']] as const;

export function dictationFormat() {
  return typeof MediaRecorder === 'undefined' ? undefined : formats.find(([mime]) => MediaRecorder.isTypeSupported(mime));
}

export async function recordDictation(signal: AbortSignal, finish: AbortSignal, maxBytes: number, onReady: () => void): Promise<File> {
  const format = dictationFormat();
  if (!format) throw new GatewayError('Dictate recording is not supported in this browser.');
  const [mimeType, extension] = format;
  const stream = await getMicrophone(signal);
  try {
    signal.throwIfAborted();
    const recorder = new MediaRecorder(stream, { mimeType });
    return await new Promise<File>((resolve, reject) => {
      const chunks: Blob[] = [];
      let bytes = 0;
      let settled = false;
      function cleanup() {
        settled = true;
        signal.removeEventListener('abort', abort);
        finish.removeEventListener('abort', stop);
        recorder.ondataavailable = recorder.onstop = recorder.onerror = null;
        if (recorder.state !== 'inactive') recorder.stop();
        stopTracks(stream);
      }
      function fail(error: unknown) { if (!settled) { cleanup(); reject(error); } }
      function abort() { fail(signal.reason); }
      function stop() {
        if (recorder.state === 'inactive') return;
        recorder.stop(); // Queues the final dataavailable event before stop.
        stopTracks(stream);
      }
      recorder.ondataavailable = ({ data }) => {
        if (!data.size) return;
        bytes += data.size;
        if (bytes > maxBytes) { fail(new GatewayError('This dictation exceeds the upload limit. Use Real-time for longer recordings.')); return; }
        chunks.push(data);
      };
      recorder.onerror = () => fail(new GatewayError('Could not record the dictation.'));
      recorder.onstop = () => {
        if (!bytes) { fail(new GatewayError('No audio was recorded.')); return; }
        cleanup();
        resolve(new File(chunks, `dictation-${Date.now()}.${extension}`, { type: mimeType }));
      };
      signal.addEventListener('abort', abort, { once: true });
      finish.addEventListener('abort', stop, { once: true });
      try { recorder.start(250); onReady(); if (finish.aborted) stop(); }
      catch { fail(new GatewayError('Could not record the dictation.')); }
    });
  } finally { stopTracks(stream); }
}
