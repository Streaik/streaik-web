import type { Page } from '@playwright/test';

export async function recordVideoFixture(page: Page) {
  const bytes = await page.evaluate(async () => {
    const canvas = document.createElement('canvas');
    canvas.width = 32;
    canvas.height = 24;
    const ctx = canvas.getContext('2d')!;
    const stream = canvas.captureStream(20);
    const recorder = new MediaRecorder(stream, { mimeType: 'video/webm;codecs=vp8' });
    const chunks: Blob[] = [];
    recorder.ondataavailable = ({ data }) => chunks.push(data);
    const stopped = new Promise<void>(resolve => { recorder.onstop = () => resolve(); });
    recorder.start();
    for (let frame = 0; frame < 5; frame++) {
      ctx.fillStyle = frame % 2 ? 'green' : 'blue';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      await new Promise(resolve => setTimeout(resolve, 70));
    }
    recorder.stop();
    await stopped;
    stream.getTracks().forEach(track => track.stop());
    return [...new Uint8Array(await new Blob(chunks).arrayBuffer())];
  });
  return Buffer.from(bytes).toString('base64');
}
