import assert from 'node:assert/strict';
import { test } from 'node:test';
import { describeToolOutput } from '../packages/chat/src/toolOutputContent.ts';

const image = { type: 'image', mimeType: 'image/png', data: 'AQID' };
const src = 'data:image/png;base64,AQID';
const text = { type: 'text', text: 'A tool result' };

test('tailored MCP panels cover a mixed result without a redundant Output panel', () => {
  const structuredContent = { country: 'Poland', population: 38_000_000 };
  const payload = { content: [text, image, { type: 'text', text: 'More text' }], structuredContent, isError: false };
  const snapshot = structuredClone(payload);
  const display = describeToolOutput(payload);
  assert.deepEqual(display.structured, structuredContent);
  assert.deepEqual(display.images, [src]);
  assert.deepEqual(display.text, ['A tool result', 'More text']);
  assert.equal(display.output, undefined);
  assert.deepEqual(payload, snapshot);
});

test('residual Output contains only unhandled blocks and fields', () => {
  const link = { type: 'resource_link', uri: 'https://example.test/file.png', mimeType: 'image/png' };
  const audio = { type: 'audio', mimeType: 'audio/wav', data: 'AQID' };
  const extra = { notes: ['metadata'] };
  const display = describeToolOutput({ content: [{ ...text, ...extra }, image, audio, link], structuredContent: {}, trace: 42 });
  assert.deepEqual(display.output, { trace: 42, content: [{ type: 'text', ...extra }, audio, link] });
  assert.deepEqual(display.text, [text.text]);
  assert.deepEqual(display.images, [src]);
});

test('generic, empty, and unrecognized results remain inspectable', () => {
  for (const value of [undefined, null, false, 0, 'failure', [], { content: 'summary' },
    { content: [{ type: 'new-block', detail: true }] }, { content: [], isError: false }]) {
    assert.equal(describeToolOutput(value).output, value);
  }
  assert.deepEqual(describeToolOutput({ content: [], structuredContent: {} }).structured, {});
});

test('image previews are bounded and never convert unsupported or remote content', () => {
  const oversized = { ...image, data: 'A'.repeat(7_000_004) };
  const svg = { ...image, mimeType: 'image/svg+xml' };
  const remote = { ...image, data: 'https://example.test/image' };
  const display = describeToolOutput({ content: [oversized, svg, remote, ...Array(5).fill(image)] });
  assert.deepEqual(display.images, Array(4).fill(src));
  assert.deepEqual(display.output, { content: [oversized, svg, remote, image] });
});

test('MCP errors keep their text reviewable and do not preview images', () => {
  const display = describeToolOutput({ content: [text, image], isError: true });
  assert.equal(display.isError, true);
  assert.deepEqual(display.text, [text.text]);
  assert.deepEqual(display.images, []);
  assert.deepEqual(display.output, { content: [image] });
});

test('embedded resources and resource reads preserve URI metadata without repeating their payload', () => {
  const metadata = { uri: 'fixture://cover', mimeType: 'image/png' };
  const resource = { ...metadata, blob: image.data };
  const embedded = describeToolOutput({ content: [{ type: 'resource', resource }] });
  assert.deepEqual(embedded.images, [src]);
  assert.deepEqual(embedded.output, { content: [{ type: 'resource', resource: metadata }] });
  const standalone = describeToolOutput({ contents: [resource, { uri: 'fixture://description', text: 'A cover' }] });
  assert.deepEqual(standalone.images, [src]);
  assert.deepEqual(standalone.text, ['A cover']);
  assert.deepEqual(standalone.output, { contents: [metadata, { uri: 'fixture://description' }] });
});
