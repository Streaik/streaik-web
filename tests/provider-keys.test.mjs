import assert from 'node:assert/strict';
import test from 'node:test';
import directory from '../packages/chat/src/provider-directory.json' with { type: 'json' };
import { agentProviderHeaders, catalogKeyProviders, providerHeaders } from '../samples/byok/src/providerKeys.ts';
import { createVault, unlockVault } from '../samples/byok/src/vault.ts';

test('BYOK sources key providers from the bundled catalog, using xai as the SpaceXAI routing ID', () => {
  const providers = catalogKeyProviders(directory.providers);
  assert.equal(providers.size, directory.providers.length - 1); // Echo is keyless.
  assert.equal(providers.get('mistral'), 'Mistral');
  assert.equal(providers.get('xai'), 'SpaceXAI');
  assert.equal(providers.has('spacexai'), false);
  assert.equal(providers.has('echo'), false);
});

test('new BYOK providers send only the requested provider key except on discovery of models', () => {
  const keys = { mistral: 'fixture-mistral', xai: 'fixture-xai' };
  assert.deepEqual(Object.fromEntries(providerHeaders(keys, { kind: 'models' })), {
    'x-mistral-key': 'fixture-mistral', 'x-xai-key': 'fixture-xai',
  });
  for (const kind of ['chat', 'decision', 'image', 'video', 'transcription', 'speech', 'realtime', 'skill']) {
    assert.deepEqual([...providerHeaders(keys, { kind, provider: 'mistral' })], [['x-mistral-key', 'fixture-mistral']]);
    assert.deepEqual([...providerHeaders(keys, { kind, provider: 'spacexai' })], []);
  }
  assert.deepEqual([...agentProviderHeaders(keys, ['mistral/model', 'mistral/other'])], [['x-mistral-key', 'fixture-mistral']]);
});

test('the encrypted vault keeps legacy and additional catalog IDs, even beyond the old 14 KB limit', async () => {
  const keys = { xai: 'fixture-xai', mistral: 'fixture-mistral', openai: 'fixture-openai',
    ...Object.fromEntries(Array.from({ length: 12 }, (_, i) => [`fixture-${i}`, 'a'.repeat(4096)])),
  };
  const passphrase = 'test-only-passphrase';
  const scope = 'https://gateway.example.test/';
  const encrypt = await createVault(passphrase, scope);
  const raw = await encrypt(keys);
  assert.ok(raw.length > 14_000);
  assert.ok(!raw.includes('fixture-mistral'));
  assert.deepEqual((await unlockVault(raw, passphrase, scope)).keys, keys);
});
