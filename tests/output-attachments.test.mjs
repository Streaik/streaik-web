import assert from 'node:assert/strict';
import { test } from 'node:test';
import { outputAttachmentsByReply } from '../packages/chat/src/outputAttachments.ts';

const assistant = (id, ...parts) => ({ id, role: 'assistant', parts });
const file = (mediaType, url, filename) => ({ type: 'file', mediaType, url, filename });
const tool = (output, fields) => ({ type: 'dynamic-tool', toolCallId: 'tool-1', state: 'output-available', output, ...fields });
const image = { type: 'image', mimeType: 'image/png', data: 'cG5n' };

test('collects streamed and MCP files across assistant steps, without changing the source messages', () => {
  const pdf = { type: 'resource', resource: { uri: 'artifact://files/quarterly%20report.pdf', mimeType: 'Application/PDF', blob: 'JVBERg==' } };
  const video = { type: 'resource', resource: { uri: 'video://files/clip.webm', mimeType: 'video/webm', blob: 'Y2xpcA==' } };
  const messages = [
    { id: 'user1', role: 'user', parts: [file('image/png', 'data:image/png;base64,dXNlcg==')] },
    assistant('tool', tool({ content: [image, pdf, video, { type: 'text', text: 'not a file' }] })),
    assistant('answer', file('image/jpeg', 'data:image/jpeg;base64,anBn', 'folder/house.jpg')),
    { id: 'user2', role: 'user', parts: [] },
    assistant('resource', tool({ contents: [{ uri: 'file:///notes.bin', blob: 'Ynl0ZXM=' }, { uri: 'test://note', text: 'text' }] })),
  ];
  const original = structuredClone(messages);
  const replies = outputAttachmentsByReply(messages);
  assert.deepEqual([...replies.keys()], ['answer', 'resource']);
  assert.deepEqual(replies.get('answer').map(({ name, url, preview }) => [name, url, preview]), [
    ['image-1.png', 'data:image/png;base64,cG5n', 'image'],
    ['quarterly report.pdf', 'data:application/pdf;base64,JVBERg==', undefined],
    ['clip.webm', 'data:video/webm;base64,Y2xpcA==', 'video'],
    ['house.jpg', 'data:image/jpeg;base64,anBn', 'image'],
  ]);
  assert.equal(replies.get('resource')[0].name, 'notes.bin');
  assert.equal(replies.get('resource')[0].mediaType, 'application/octet-stream');
  assert.deepEqual(messages, original);
});

test('only uses usable URLs and final tool results; preserves unsupported files for download', () => {
  const reply = assistant('reply',
    tool({ isError: true, content: [image] }),
    tool({ content: [image] }, { preliminary: true }),
    tool({ content: [image] }, { state: 'output-denied' }),
    tool({ content: [
      { type: 'resource_link', mimeType: 'image/png', name: 'cloud.png', uri: 'https://files.example.test/item?id=123' },
      { type: 'resource_link', name: 'MCP-only', uri: 'file:///temp/notes.txt' },
      { type: 'image', mimeType: 'image/png', data: 'https://files.example.test/hidden.png' },
    ] }),
    file('image/png', 'javascript:void(0)'),
    file('image/png', 'https://person:password@files.example.test/file.png'),
    file('image/png', 'data:image/png;base64,not base64'),
    file('image/png', 'data:text/html,<p>download only</p>'),
    file('image/svg+xml', 'data:image/svg+xml,%3Csvg%2F%3E'),
    file('video/mp4', 'https://files.example.test/My%20clip.mp4?sig=fixture'));
  assert.deepEqual(outputAttachmentsByReply([reply]).get('reply').map(({ name, preview, reference }) => [name, preview, reference]), [
    ['cloud.png', undefined, true],
    ['attachment-2.png', undefined, undefined],
    ['attachment-3.svg', undefined, undefined],
    ['My clip.mp4', 'video', false],
  ]);
});
