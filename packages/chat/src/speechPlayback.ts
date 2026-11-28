// Encoded audio frames aren't necessarily individual playable files. Feed them in
// order to MediaSource when supported; the gateway still assembles the final clip.
export function progressiveSpeech(audio: HTMLAudioElement, type: string, onClose: () => void) {
  if (!['audio/mpeg', 'audio/aac', 'audio/mp4', 'audio/webm'].includes(type) || typeof MediaSource === 'undefined' || !MediaSource.isTypeSupported(type)) return;
  const source = new MediaSource();
  const url = URL.createObjectURL(source);
  const queue: Uint8Array<ArrayBuffer>[] = [];
  let buffer: SourceBuffer | undefined;
  let closed = false, finished = false, attempted = false;

  function close() {
    if (closed) return;
    closed = true;
    queue.length = 0;
    source.removeEventListener('sourceopen', open);
    source.removeEventListener('sourceclose', close);
    buffer?.removeEventListener('updateend', pump);
    buffer?.removeEventListener('error', close);
    audio.removeEventListener('error', close);
    audio.removeEventListener('ended', close);
    audio.removeEventListener('pause', paused);
    audio.pause();
    audio.removeAttribute('src');
    audio.load();
    URL.revokeObjectURL(url);
    onClose();
  }

  function paused() { if (finished) close(); }

  function pump() {
    if (closed || !buffer || buffer.updating || source.readyState !== 'open') return;
    try {
      const bytes = queue.shift();
      if (bytes) {
        buffer.appendBuffer(bytes);
        if (!attempted) {
          attempted = true;
          // Autoplay policies can require the user to press Play on the live player.
          void audio.play().catch(() => { if (finished) close(); });
        }
      } else if (finished) source.endOfStream();
    } catch { close(); }
  }

  function open() {
    try {
      buffer = source.addSourceBuffer(type);
      buffer.addEventListener('updateend', pump);
      buffer.addEventListener('error', close);
      pump();
    } catch { close(); }
  }

  source.addEventListener('sourceopen', open, { once: true });
  source.addEventListener('sourceclose', close, { once: true });
  audio.addEventListener('error', close, { once: true });
  audio.addEventListener('ended', close, { once: true });
  audio.addEventListener('pause', paused);
  audio.src = url;
  return {
    append(bytes: Uint8Array<ArrayBuffer>) { if (!closed) { queue.push(bytes); pump(); } },
    finish() { finished = true; if (audio.paused) close(); else pump(); },
    close,
  };
}
// Open within the user's Send/Read aloud gesture. PCM plays as it arrives while the
// transport assembles the final WAV. Playback failure doesn't discard that clip.
export function pcmSpeechPlayback(onStart?: () => void) {
  let context: AudioContext;
  try { context = new AudioContext(); } catch { return; }
  const sources = new Set<AudioBufferSourceNode>();
  let end = 0, carry: number | undefined, played = false, closed = false, drained: (() => void) | undefined;
  const close = () => {
    if (closed) return;
    closed = true;
    for (const source of sources) {
      source.onended = null;
      try { source.stop(); } catch { /* Already ended. */ }
      source.disconnect();
    }
    sources.clear();
    void context.close().catch(() => {});
    drained?.();
  };
  void context.resume().catch(close);
  context.onstatechange = () => { if (played && context.state !== 'running') close(); };

  return {
    append(bytes: Uint8Array, rate: number) {
      if (closed || context.state !== 'running' || !bytes.length) return;
      try {
        if (carry !== undefined) {
          const joined = new Uint8Array(bytes.length + 1);
          joined[0] = carry;
          joined.set(bytes, 1);
          bytes = joined;
        }
        carry = bytes.length % 2 ? bytes[bytes.length - 1] : undefined;
        const samples = Math.floor(bytes.length / 2);
        if (!samples) return;
        if (end - context.currentTime + samples / rate > 90) { close(); return; }
        const buffer = context.createBuffer(1, samples, rate);
        const pcm = buffer.getChannelData(0), view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
        for (let i = 0; i < samples; i++) pcm[i] = view.getInt16(i * 2, true) / 32768;
        const source = context.createBufferSource();
        source.buffer = buffer;
        source.connect(context.destination);
        sources.add(source);
        source.onended = () => {
          sources.delete(source);
          source.disconnect();
          if (!sources.size) drained?.();
        };
        const start = end > context.currentTime ? end : context.currentTime + 0.015;
        end = start + buffer.duration;
        source.start(start);
        if (!played) { played = true; onStart?.(); }
      } catch { close(); }
    },
    async finish() {
      if (sources.size && context.state === 'running') await new Promise<void>(resolve => { drained = resolve; });
      close();
      return played;
    },
    close,
  };
}
