import assert from 'node:assert/strict';
import test from 'node:test';
import { createVault, unlockVault } from '../samples/byok/src/vault.ts';
import { createEntraAuth } from '../samples/entra/src/auth.ts';
import { createGateway } from '../packages/gateway/src/index.ts';

test('vault authenticates its gateway scope and ciphertext, and uses a fresh IV for each save', async () => {
  const passphrase = 'a test-only passphrase';
  const scope = 'https://example.invalid/gateway/';
  const keys = { openai: 'test-provider-key' };
  const encrypt = await createVault(passphrase, scope);
  const encoded = await encrypt(keys);
  assert.ok(!encoded.includes(keys.openai) && !encoded.includes(passphrase));
  const record = JSON.parse(encoded);
  assert.notEqual(record.iv, JSON.parse(await encrypt(keys)).iv);
  const unlocked = await unlockVault(encoded, passphrase, scope);
  assert.deepEqual(unlocked.keys, keys);
  assert.deepEqual((await unlockVault(await unlocked.encrypt({}), passphrase, scope)).keys, {});
  await assert.rejects(unlockVault(encoded, 'not the passphrase', scope));
  await assert.rejects(unlockVault(encoded, passphrase, 'https://other.invalid/gateway/'));
  record.iv = (record.iv.startsWith('A') ? 'B' : 'A') + record.iv.slice(1);
  await assert.rejects(unlockVault(JSON.stringify(record), passphrase, scope));
});

test('Entra uses a delegated gateway scope, sends only the access token, and disarms on sign-out', async () => {
  const tenantId = '11111111-1111-1111-1111-111111111111';
  const clientId = '22222222-2222-2222-2222-222222222222';
  const scope = 'api://33333333-3333-3333-3333-333333333333/access_as_user';
  const account = { tenantId, homeAccountId: 'mock-account', username: 'test@example.invalid' };
  const site = new URL('https://streaik.example.invalid/chat/');
  let active = null;
  let completeRefresh;
  const auth = await createEntraAuth({ tenantId, clientId, scope }, site, (config) => {
    assert.equal(config.auth.authority, `https://login.microsoftonline.com/${tenantId}`);
    assert.equal(config.auth.redirectUri, `${site.href}auth-redirect.html`);
    assert.equal(config.cache.cacheLocation, 'sessionStorage');
    return {
      initialize: async () => {}, getAllAccounts: () => [], getActiveAccount: () => active,
      setActiveAccount: (item) => { active = item; },
      loginPopup: async (request) => { assert.deepEqual(request.scopes, [scope]); return { account }; },
      logoutPopup: async (request) => { assert.equal(request.account, account); },
      acquireTokenSilent: async (request) => {
        assert.equal(request.account, account);
        assert.deepEqual(request.scopes, [scope]);
        if (completeRefresh === null) await new Promise((resolve) => { completeRefresh = resolve; });
        return { accessToken: 'test-access-token', idToken: 'test-id-token' };
      },
    };
  });
  await assert.rejects(auth.headers(), /Sign in with Microsoft/);
  assert.equal(await auth.signIn(), account);
  const gateway = createGateway(new URL('https://streaik.example.invalid/gateway/'), auth.headers, async (url, init) => {
    assert.equal(url, 'https://streaik.example.invalid/gateway/v1/models');
    assert.deepEqual([...init.headers], [['authorization', 'Bearer test-access-token']]);
    return Response.json({ data: [] });
  });
  await gateway.listModels();
  completeRefresh = null;
  const pending = auth.headers();
  await auth.signOut();
  completeRefresh();
  await assert.rejects(pending, /Sign in again/);
  assert.equal(active, null);
  await assert.rejects(auth.headers(), /Sign in with Microsoft/);
});

test('Entra acquires MCP and chat tokens for their separate audiences', async () => {
  const tenantId = '11111111-1111-1111-1111-111111111111';
  const clientId = '22222222-2222-2222-2222-222222222222';
  const scope = 'api://33333333-3333-3333-3333-333333333333/access_as_user';
  const mcpScope = 'api://44444444-4444-4444-4444-444444444444/mcp_access';
  const account = { tenantId, homeAccountId: 'mock-account' };
  let active = null;
  const auth = await createEntraAuth({ tenantId, clientId, scope, mcpScope }, new URL('https://example.invalid/'), () => ({
    initialize: async () => {}, getAllAccounts: () => [], getActiveAccount: () => active,
    setActiveAccount: (item) => { active = item; },
    loginPopup: async (request) => { assert.deepEqual(request.scopes, [scope]); assert.deepEqual(request.extraScopesToConsent, [mcpScope]); return { account }; },
    logoutPopup: async () => {},
    acquireTokenSilent: async (request) => {
      assert.equal(request.account, account);
      assert.equal(request.scopes.length, 1);
      assert.ok([scope, mcpScope].includes(request.scopes[0]));
      return { accessToken: request.scopes[0] === scope ? 'chat-token' : 'mcp-token' };
    },
  }));
  await assert.rejects(auth.mcpHeaders(), /Sign in/);
  await auth.signIn();
  assert.deepEqual(await auth.headers(), { Authorization: 'Bearer chat-token' });
  assert.deepEqual(await auth.mcpHeaders(), { Authorization: 'Bearer mcp-token' });
  await auth.signOut();
  await assert.rejects(auth.mcpHeaders(), /Sign in/);
});
