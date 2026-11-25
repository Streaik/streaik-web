import assert from 'node:assert/strict';
import test from 'node:test';
import { createCatalogSearch } from '../packages/chat/src/catalogSearch.ts';

test('catalog search ranks titles and matches Unicode prefixes across fields in any order', async () => {
  const search = await createCatalogSearch([
    { title: 'Other assistant', text: 'Draft a résumé for the support team.' },
    { title: 'Résumé support', text: 'Write a professional profile.' },
    { title: 'Résumé assistant', text: 'Contact support for help.' },
    { title: 'हिन्दी सहायक', text: 'हिन्दी में योजना बनाएँ।' },
    { title: 'Support only', text: 'Unrelated entry.' },
  ]);
  const [first, ...rest] = await search(' SUPP resu ');
  assert.equal(first, 1);
  assert.deepEqual(rest.sort(), [0, 2]);
  assert.deepEqual(await search('हिन्दी'), [3]);
  assert.deepEqual(await search('unavailable'), []);
  assert.deepEqual(await search('… /'), []);
});

test('catalog indexes are independent and return all matching positions', async () => {
  const local = await createCatalogSearch(Array.from({ length: 35 }, () => ({ title: 'Local skill', text: '' })));
  const central = await createCatalogSearch([{ title: 'Central skill', text: 'openai/skill_fixture' }]);
  assert.equal((await local('skill')).length, 35);
  assert.deepEqual(await local('openai'), []);
  assert.deepEqual(await central('fixture openai'), [0]);
  assert.deepEqual(await central('local'), []);
});
