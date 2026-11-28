// Mistral delivers fragments of a PCM WAV, not a separate WAV per event.
export class StreamingWave {
  private header = new Uint8Array(0);
  private riff = false;
  private rate = 0;
  private data = false;
  private remaining?: number;
  private readonly output: (bytes: Uint8Array<ArrayBuffer>, rate: number) => void;

  constructor(output: (bytes: Uint8Array<ArrayBuffer>, rate: number) => void) { this.output = output; }

  push(bytes: Uint8Array<ArrayBuffer>) {
    if (this.data) return this.pcm(bytes);
    const combined = new Uint8Array(this.header.length + bytes.length);
    combined.set(this.header);
    combined.set(bytes, this.header.length);
    this.header = combined;
    const label = (offset: number) => String.fromCharCode(...this.header.subarray(offset, offset + 4));
    if (!this.riff) {
      if (this.header.length < 12) return;
      if (label(0) !== 'RIFF' || label(8) !== 'WAVE') throw new Error('Invalid WAV header');
      this.riff = true;
      this.header = this.header.subarray(12);
    }
    while (this.header.length >= 8) {
      const kind = label(0), view = new DataView(this.header.buffer, this.header.byteOffset, this.header.byteLength);
      const size = view.getUint32(4, true);
      if (kind === 'data') {
        if (!this.rate || size !== 0xffffffff && size % 2) throw new Error('Invalid WAV data chunk');
        this.data = true;
        // Streaming WAV headers can leave the data size unset until the stream ends.
        this.remaining = size === 0 || size === 0xffffffff ? undefined : size;
        const audio = this.header.subarray(8);
        this.header = new Uint8Array(0);
        return this.pcm(audio);
      }
      const end = 8 + size + size % 2;
      if (end > 65536) throw new Error('Oversized WAV header');
      if (this.header.length < end) return;
      if (kind === 'fmt ') {
        if (this.rate || size < 16 || view.getUint16(8, true) !== 1 || view.getUint16(10, true) !== 1 ||
            view.getUint16(20, true) !== 2 || view.getUint16(22, true) !== 16) throw new Error('Unsupported WAV format');
        this.rate = view.getUint32(12, true);
        if (this.rate < 8000 || this.rate > 96000 || view.getUint32(16, true) !== this.rate * 2) throw new Error('Invalid WAV sample rate');
      }
      this.header = this.header.subarray(end);
    }
  }

  private pcm(bytes: Uint8Array<ArrayBuffer>) {
    if (this.remaining !== undefined) {
      this.remaining -= bytes.length;
      if (this.remaining < 0) throw new Error('Too much WAV data');
    }
    if (bytes.length) this.output(bytes, this.rate);
  }

  finish() {
    if (!this.data || this.remaining) throw new Error('Incomplete WAV data');
  }
}
