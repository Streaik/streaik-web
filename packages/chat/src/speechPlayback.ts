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
