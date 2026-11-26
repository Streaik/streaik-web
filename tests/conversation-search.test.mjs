import assert from 'node:assert/strict';
import test from 'node:test';
import { createConversationSearch } from '../packages/chat/src/conversationSearch.ts';

const text = text => ({ type: 'text', text });
const message = (role, ...parts) => ({ role, parts });
const chat = (id, name, ...messages) => ({ id, metadata: { name }, messages });
const ids = hits => hits.map(({ id }) => id);

test('history search matches titles and visible text from both roles with one hit per conversation', async () => {
  const index = createConversationSearch();
  const records = [chat('travel', 'Itinerary',
    message('user', text('Questions about Reykjavík'), text('Could we find a late train?')),
    message('assistant', text('The geothermal lagoon is near the station.'), text('Reykjavík is a good base.'))),
  chat('other', 'Other trip', message('user', text('Ταξίδι στην Αθήνα')))];

  assert.deepEqual(await index.search(records, 'REYKJAV'), [{ id: 'travel', excerpt: 'Questions about Reykjavík Could we find a late train? The geothermal lagoon is near the station. Reykjavík is a good base.' }]);
  assert.deepEqual(ids(await index.search(records, 'lagoon')), ['travel']);
  assert.deepEqual(ids(await index.search(records, 'train geothermal')), ['travel']);
  assert.deepEqual(await index.search(records, 'itinerary'), [{ id: 'travel', excerpt: undefined }]);
  assert.deepEqual(ids(await index.search(records, 'αθήνα')), ['other']);
  assert.deepEqual(await index.search(records, 'lagoon unrelated'), []);
  assert.deepEqual(await index.search(records, '…'), []);
});

test('history search excludes reasoning, tools, system parts and attached content', async () => {
  const index = createConversationSearch();
  const records = [chat('files', undefined,
    message('system', text('systemneedle')),
    message('user', text('Visible question'),
      { ...text('convertedneedle'), providerMetadata: { streaik: { attachmentName: 'notes.txt' } } },
      { type: 'file', filename: 'hidden.txt', url: 'data:text/plain;base64,uploadneedle' }),
    message('assistant', { type: 'reasoning', text: 'reasoningneedle' },
      { type: 'tool-example', output: 'toolneedle' }, text('Visible answer')))];

  for (const term of ['systemneedle', 'convertedneedle', 'uploadneedle', 'reasoningneedle', 'toolneedle']) {
    assert.deepEqual(await index.search(records, term), [], term);
  }
  assert.deepEqual(ids(await index.search(records, 'visible')), ['files']);
});

test('history search replaces updated text and titles and removes deleted documents', async () => {
  const index = createConversationSearch();
  const before = chat('a', 'Original title', message('user', text('First turn')));
  const after = chat('a', 'Revised title', ...before.messages, message('assistant', text('New answer')));
  const other = chat('b', 'Other', message('user', text('New answer elsewhere')));

  assert.deepEqual(ids(await index.search([before, other], 'original')), ['a']);
  await index.sync([after, other]);
  assert.deepEqual(ids(await index.search([after, other], 'revised')), ['a']);
  assert.deepEqual(await index.search([after, other], 'original'), []);
  assert.deepEqual(ids(await index.search([after, other], 'new answer')).sort(), ['a', 'b']);

  const edited = { ...after, messages: before.messages };
  assert.deepEqual(ids(await index.search([edited, other], 'elsewhere')), ['b']);
  assert.deepEqual(ids(await index.search([edited, other], 'new answer')), ['b']);
  await index.sync([other]);
  assert.deepEqual(await index.search([other], 'revised'), []);
  assert.deepEqual(await index.search([], 'elsewhere'), []);
});

test('tool history index follows edits and removals and remains scoped to its own profile', async () => {
  const first = createConversationSearch();
  const second = createConversationSearch();
  const old = chat('shared-id', 'Old title', { ...message('user', text('Original wording')), id: 'original' });
  const fresh = chat('shared-id', 'New title', { ...message('user', text('Edited wording')), id: 'edited' });
  const kept = chat('other', 'Separate thread', { ...message('assistant', text('Other wording')), id: 'kept' });
  const total = (index, records, query) => index.searchText(records, query, 5).then(result => result.total);

  assert.equal(await total(first, [old, kept], 'original'), 1);
  await first.sync([fresh, kept]);
  assert.equal(await total(first, [fresh, kept], 'original'), 0);
  const edited = await first.searchText([fresh, kept], 'edited', 5);
  assert.deepEqual(edited.results.map(hit => [hit.messageId, hit.conversationName]), [['edited', 'New title']]);
  assert.equal(await total(first, [kept], 'edited'), 0);
  assert.equal(await total(first, [kept], 'wording'), 1);
  assert.equal(await total(second, [old], 'edited'), 0);
  assert.equal(await total(second, [old], 'original'), 1);
});
