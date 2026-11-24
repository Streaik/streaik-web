import assert from 'node:assert/strict';
import test from 'node:test';
import { createEntraMcpHeaders } from '../samples/entra/src/mcpAuth.ts';
import { readMcpScopes } from '../samples/entra/src/auth.ts';
import { preferredMcpRemote } from '../packages/chat/src/mcp.ts';

const base = new URL('https://mcp.example.test/team/entra/');
const endpoint = new URL('google-images', base).href;
const scope = 'api://images-id/access_as_user';
const issuer = new URL('oauth/images', base).href;
const resourceDocument = `${base.origin}/.well-known/oauth-protected-resource/team/entra/google-images`;
const issuerDocument = `${base.origin}/.well-known/oauth-authorization-server/team/entra/oauth/images`;
const grant = 'urn:ietf:params:oauth:grant-type:token-exchange';
const accessTokenType = 'urn:ietf:params:oauth:token-type:access_token';

test('only local profile scopes are accepted in configuration', () => {
  assert.deepEqual(readMcpScopes(`{"images":"${scope}"}`), { images: scope });
  assert.throws(() => readMcpScopes('{"images":"https://graph.microsoft.com/.default"}'));
});

test('the registry prefers the Entra remote over the BYOK remote when the Entra base is configured', () => {
  const byok = { endpoint: 'https://mcp.example.test/team/byok/google-images', declarations: [{ name: 'x-goog-api-key' }] };
  const managed = { endpoint, declarations: [] };
  assert.equal(preferredMcpRemote([byok, managed], { base }), managed);
  assert.equal(preferredMcpRemote([byok, managed], { base: new URL('https://mcp.example.test/team/byok/') }), byok);
});

function mockAuth() {
  const calls = [];
  let revision = 0;
  return { calls, changeAccount: () => { revision++; }, auth: {
    sessionVersion: () => revision, getAccount: () => ({ homeAccountId: `account-${revision}` }),
    mcpScopeFor: profile => profile === 'images' ? scope : undefined,
    mcpHeaders: async profile => { calls.push(profile); return { Authorization: `Bearer entra-${revision}` }; },
  } };
}

function mockFetch(t, override = () => undefined) {
  const original = globalThis.fetch;
  const requests = [];
  t.after(() => { globalThis.fetch = original; });
  globalThis.fetch = async (url, init) => {
    requests.push([url, init]);
    assert.equal(init.redirect, 'error');
    assert.equal(init.credentials, 'omit');
    const custom = override(url, init);
    if (custom) return custom;
    if (url === resourceDocument) return Response.json({ resource: endpoint, authorization_servers: [issuer], scopes_supported: [scope] });
    if (url === issuerDocument) return Response.json({ issuer, token_endpoint: `${issuer}/token`, grant_types_supported: [grant] });
    if (url === `${issuer}/token`) {
      assert.equal(init.method, 'POST');
      assert.equal(init.body.get('grant_type'), grant);
      assert.equal(init.body.get('resource'), endpoint);
      assert.equal(init.body.get('client_id'), 'spa-client-id');
      return Response.json({ token_type: 'Bearer', access_token: 'mcp1.' + init.body.get('subject_token'), expires_in: 120, issued_token_type: accessTokenType });
    }
    assert.fail(`Unexpected request to ${url}`);
  };
  return requests;
}

test('uses named-profile metadata, exchanges only at the pinned token endpoint, and caches per account', async t => {
  const requests = mockFetch(t);
  const { auth, calls, changeAccount } = mockAuth();
  const headersFor = createEntraMcpHeaders(base, auth, 'spa-client-id');
  assert.equal((await headersFor(endpoint)).Authorization, 'Bearer mcp1.entra-0');
  assert.equal((await headersFor(endpoint)).Authorization, 'Bearer mcp1.entra-0');
  assert.deepEqual(requests.map(([url]) => url), [resourceDocument, issuerDocument, `${issuer}/token`]);
  assert.deepEqual(calls, ['images']);
  changeAccount();
  assert.equal((await headersFor(endpoint)).Authorization, 'Bearer mcp1.entra-1');
  assert.deepEqual(calls, ['images', 'images']);
});

test('rejects out-of-base routes and spoofed token endpoints before acquiring an Entra assertion', async t => {
  const requests = mockFetch(t, (url) => url === issuerDocument && Response.json({
    issuer, token_endpoint: 'https://other.example.test/token', grant_types_supported: [grant],
  }));
  const { auth, calls } = mockAuth();
  const headersFor = createEntraMcpHeaders(base, auth, 'spa-client-id');
  await assert.rejects(headersFor('https://mcp.example.test/team/entra-other/google-images'));
  await assert.rejects(headersFor('https://other.example.test/team/entra/google-images'));
  await assert.rejects(headersFor(endpoint));
  assert.deepEqual(requests.map(([url]) => url), [resourceDocument, issuerDocument]);
  assert.deepEqual(calls, []);
});

test('does not return a wrapped bearer if the signed-in account changes during exchange', async t => {
  const { auth, changeAccount } = mockAuth();
  mockFetch(t, url => {
    if (url !== `${issuer}/token`) return;
    changeAccount();
    return Response.json({ token_type: 'Bearer', access_token: 'mcp1.stale', expires_in: 120, issued_token_type: accessTokenType });
  });
  await assert.rejects(createEntraMcpHeaders(base, auth, 'spa-client-id')(endpoint), /sign-in changed/);
});
