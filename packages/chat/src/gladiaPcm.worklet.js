// AudioWorklet runs outside the UI thread. Gladia expects little-endian PCM16.
class GladiaPcm extends AudioWorkletProcessor {
  buffer = new DataView(new ArrayBuffer(2048));
  count = 0;
  stopped = false;

  constructor() {
    super();
    this.port.onmessage = () => {
      this.stopped = true;
      if (this.count) this.emit();
      this.port.postMessage('flushed');
    };
  }

  emit() {
    const bytes = this.buffer.buffer.slice(0, this.count * 2);
    this.port.postMessage(bytes, [bytes]);
    this.count = 0;
  }

  process(inputs) {
    if (this.stopped) return false;
    for (const sample of inputs[0]?.[0] ?? []) {
      const value = Math.max(-1, Math.min(1, sample));
      this.buffer.setInt16(this.count++ * 2, value * (value < 0 ? 32768 : 32767), true);
      if (this.count === 1024) this.emit();
    }
    return true;
  }
}

registerProcessor('streaik-gladia-pcm', GladiaPcm);
