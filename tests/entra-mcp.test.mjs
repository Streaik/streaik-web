import assert from 'node:assert/strict';
import test from 'node:test';
import { createEntraMcpHeaders, withEntraMcpAuth } from '../samples/entra/src/mcpAuth.ts';
import { readMcpScopes } from '../samples/entra/src/auth.ts';
import { discoverMcpServer, expandMcpResource, fetchMcpCatalog, filterMcpCatalog, McpDescriptorAuthUnsupported, mcpAppAuth, mcpAppDescriptorHeaders, preferredMcpRemote, readMcpResource } from '../packages/chat/src/mcp.ts';
import { chatHostedMcp, withMcpHeaders } from '../packages/chat/src/chatModelContext.ts';
import { apiChatHostedMcp, withResponsesHostedMcp } from '../packages/gateway/src/hostedMcp.ts';
import { byokRegistryRemote } from '../samples/shared/mcpConfig.ts';

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

test('BYOK hides marked Entra remotes but keeps anonymous, header-auth and third-party remotes', async t => {
  const byok = 'https://mcp.example.test/team/byok/google-images';
  const graph = new URL('microsoft-onenote', base).href;
  const countries = new URL('github-rest-countries', base).href;
  const thirdParty = 'https://other.example.test/public';
  const streamable = (url, headers) => ({ type: 'streamable-http', url, headers });
  const metadata = (...urls) => ({ 'net.streaik/entra-protected-remotes': urls });
  t.mock.method(globalThis, 'fetch', async () => Response.json({ servers: [
    { server: { name: 'test.example.mcp/Google-Images', remotes: [streamable(byok, [{ name: 'x-goog-api-key', isSecret: true }]), streamable(endpoint)],
      _meta: metadata(endpoint, null, 'not a URL') } },
    { server: { name: 'test.example.mcp/Microsoft-OneNote', remotes: [streamable(graph)], _meta: metadata(graph) } },
    { server: { name: 'test.example.mcp/GitHub-RESTCountries', remotes: [streamable(countries)] } },
    { server: { name: 'test.example.other/public', remotes: [streamable(thirdParty)] } },
  ] }));
  const { servers } = await fetchMcpCatalog(new URL('https://registry.example.test/v0.1/servers'), new AbortController().signal);
  assert.equal(servers.length, 4);
  assert.equal(servers[0].remotes[1].requiresEntra, true);
  assert.equal(preferredMcpRemote(servers[0].remotes, { base }).endpoint, endpoint);
  assert.deepEqual(filterMcpCatalog(servers, byokRegistryRemote).map(server => server.remotes.map(remote => remote.endpoint)), [[byok], [countries], [thirdParty]]);
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
    const custom = await override(url, init);
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

const managedServer = { id: 'images', title: 'Images', endpoint, declarations: [], source: 'registry', auth: 'app', extraNames: [] };

test('Hosted and Provider tool descriptors await the same MCP bearer as browser auth on both Gateway routes', async t => {
  const requests = mockFetch(t, url => url === `${issuer}/token` && Response.json({ token_type: 'Bearer',
    access_token: 'mcp1.endpoint_fixture', expires_in: 120, issued_token_type: accessTokenType }));
  const { auth, calls } = mockAuth();
  const options = withEntraMcpAuth({ base }, auth, 'spa-client-id');
  const signal = new AbortController().signal;
  const browser = mcpAppAuth(options, managedServer);
  assert.equal(browser.challengeOnly, true);
  assert.equal(new Headers(await browser.headers(signal)).get('authorization'), 'Bearer mcp1.endpoint_fixture');
  for (const mode of ['hosted', 'provider']) {
    const descriptors = chatHostedMcp({ execution: mode }, [{ record: managedServer }]);
    const wire = await withMcpHeaders(descriptors, url => {
      assert.equal(url, endpoint);
      return mcpAppDescriptorHeaders(options, managedServer, signal);
    });
    assert.equal(descriptors[0].headers, undefined);
    const apiChat = apiChatHostedMcp(wire[0]).inputSchema.mcp;
    const responses = JSON.parse(withResponsesHostedMcp('{}', wire)).tools[0];
    for (const tool of [apiChat, responses]) {
      assert.equal(tool.server_url, endpoint);
      assert.equal(tool.execution, mode === 'provider' ? 'server' : undefined);
      assert.deepEqual(tool.headers, { authorization: 'Bearer mcp1.endpoint_fixture' });
      assert.doesNotMatch(JSON.stringify(tool), /entra-0/);
    }
  }
  assert.deepEqual(calls, ['images']);
  assert.deepEqual(requests.map(([url]) => url), [resourceDocument, issuerDocument, `${issuer}/token`]);
});

test('managed descriptors leave public servers credential-free and do not fall back to browser-only credentials', async t => {
  const publicUrl = new URL('github-rest-countries', base).href;
  const metadata = `${base.origin}/.well-known/oauth-protected-resource/team/entra/github-rest-countries`;
  const requests = mockFetch(t, url => url === metadata && new Response(null, { status: 404 }));
  const { auth, calls } = mockAuth();
  const options = withEntraMcpAuth({ base }, auth, 'spa-client-id');
  const record = { ...managedServer, endpoint: publicUrl };
  const plan = chatHostedMcp({ execution: 'provider' }, [{ record }]);
  assert.deepEqual(await withMcpHeaders(plan, () => mcpAppDescriptorHeaders(options, record)), plan);
  assert.equal(mcpAppDescriptorHeaders(options, { ...record, endpoint: 'https://other.example.test/github-rest-countries' }), undefined);
  assert.equal(mcpAppDescriptorHeaders(options, { ...managedServer, source: 'manual' }), undefined);
  assert.throws(() => mcpAppDescriptorHeaders({ base, headersForRemote: () => ({ ready: true, challengeOnly: true,
    headers: () => assert.fail('Browser-only credentials must not be copied') }) }, managedServer), McpDescriptorAuthUnsupported);
  assert.deepEqual(calls, []);
  assert.deepEqual(requests.map(([url]) => url), [metadata]);
});

test('existing app adapters supply descriptor headers only for their configured MCP endpoint', async () => {
  const signal = new AbortController().signal;
  let acquisitions = 0;
  const headers = async received => {
    assert.equal(received, signal);
    acquisitions++;
    return { Authorization: 'Bearer fixture-mcp' };
  };
  const options = { base, headersForRemote: (_, url) => {
    assert.equal(url, endpoint);
    return { ready: true, headers };
  } };
  assert.deepEqual(await mcpAppDescriptorHeaders(options, managedServer, signal), { Authorization: 'Bearer fixture-mcp' });
  assert.equal(mcpAppDescriptorHeaders(options, { ...managedServer, endpoint: 'https://elsewhere.example.test/mcp' }, signal), undefined);
  assert.equal(mcpAppDescriptorHeaders(options, { ...managedServer, declarations: [{ name: 'Authorization', manualOnly: true }] }, signal), undefined);
  const locked = { base, headersForRemote: () => ({ ready: false, headers }) };
  assert.equal(mcpAppDescriptorHeaders(locked, managedServer, signal), undefined);
  assert.equal(acquisitions, 1);
});

test('the web MCP client lists and reads delegated data with the resource-bound bearer, not the Entra assertion', async t => {
  // Reuse the named-profile OAuth fixture; mock the MCP transport independently of the token issuer.
  const template = { name: 'my-calendar', uriTemplate: 'https://graph.microsoft.com/beta/me/calendarView?startDateTime={startDateTime}' };
  const resource = expandMcpResource(template.uriTemplate, { startDateTime: '2026-11-24T09:00:00+01:00' });
  assert.equal(resource, 'https://graph.microsoft.com/beta/me/calendarView?startDateTime=2026-11-24T09%3A00%3A00%2B01%3A00');
  const methods = [];
  mockFetch(t, async (request, init) => {
    if (!(request instanceof Request)) return;
    assert.equal(request.url, endpoint);
    assert.equal(init.headers.get('Mcp-Protocol-Version'), '2026-07-28');
    const { id, method, params } = await request.json();
    if (init.headers.get('Authorization') === null) {
      assert.equal(method, 'server/discover');
      methods.push('challenge');
      return new Response(null, { status: 401, headers: { 'WWW-Authenticate': 'Bearer' } });
    }
    assert.equal(init.headers.get('Authorization'), 'Bearer mcp1.entra-0');
    methods.push(method);
    const reply = { jsonrpc: '2.0', id };
    const complete = { resultType: 'complete', ttlMs: 0, cacheScope: 'private' };
    switch (method) {
      case 'server/discover': return Response.json({ ...reply, result: { supportedVersions: ['2026-07-28'], capabilities: { resources: {} } } });
      case 'resources/list': return Response.json({ ...reply, result: { ...complete, resources: [] } });
      case 'resources/templates/list': return Response.json({ ...reply, result: { ...complete, resourceTemplates: [template] } });
      case 'resources/read':
        assert.equal(params.uri, resource);
        return Response.json({ ...reply, result: { ...complete, contents: [{ uri: resource, text: 'calendar data' }] } });
      default: assert.fail(`Unexpected MCP method ${method}`);
    }
  });
  const { auth, calls } = mockAuth();
  const headers = createEntraMcpHeaders(base, auth, 'spa-client-id');
  const server = { id: 'calendar', title: 'Calendar', endpoint, challengeOnly: true, requestHeaders: signal => headers(endpoint, signal) };
  const signal = new AbortController().signal;
  assert.deepEqual(await discoverMcpServer(server, signal), { tools: [], hasResources: true, hasPrompts: false, hasCompletions: false,
    resources: [], resourceTemplates: [template], prompts: [], promptsFailed: false });
  assert.deepEqual(await readMcpResource(server, resource, signal), { contents: [{ uri: resource, text: 'calendar data' }], text: 'calendar data', images: [] });
  assert.deepEqual(calls, ['images']);
  assert.deepEqual(methods, ['challenge', 'server/discover', 'resources/list', 'resources/templates/list', 'challenge', 'server/discover', 'resources/read']);
});
