import assert from 'node:assert/strict';
import test from 'node:test';
import { callMcpTool, completeMcpArgument, discoverMcpServer, mcpAppAuth } from '../packages/chat/src/mcp.ts';
import { mcpDeclarations, mcpEndpoint, mcpHeaderFields, parseMcpServer, resolveMcpHeaders } from '../packages/chat/src/mcpConfiguration.ts';

test('MCP endpoints accept HTTPS and local HTTP without credentials or ambiguous paths', () => {
  assert.equal(mcpEndpoint(' HTTPS://mcp.example.org:443/tools '), 'https://mcp.example.org/tools');
  assert.equal(mcpEndpoint('http://localhost:5210/'), 'http://localhost:5210/');
  for (const endpoint of ['http://mcp.example.org/tools', 'https://user:pass@mcp.example.org/', 'https://mcp.example.org/../tools',
    'https://mcp.example.org/tools%2Fother', 'https://mcp.example.org/tools?key=secret', 'https://mcp.example.org/#fragment']) {
    assert.equal(mcpEndpoint(endpoint), undefined);
  }
});

test('header forms resolve required secret templates and validate public choices', () => {
  const declarations = mcpDeclarations([
    { name: 'Authorization', value: 'Bearer {access_token}', isRequired: true, variables: { access_token: { isSecret: true, default: 'ignore-me' } } },
    { name: 'X-Mode', isRequired: true, choices: ['read', 'write'], default: 'read' },
  ]);
  assert.ok(declarations);
  assert.deepEqual(mcpHeaderFields(declarations, new Map()).map(({ label, isSecret, value }) => [label, isSecret, value]), [
    ['access_token', true, ''], ['X-Mode', false, 'read'],
  ]);
  assert.throws(() => resolveMcpHeaders(declarations, new Map(), []), /required/);
  const fields = new Map([['authorization:access_token', 'fixture']]);
  const headers = resolveMcpHeaders(declarations, fields, []);
  assert.equal(headers.get('Authorization'), 'Bearer fixture');
  assert.equal(headers.get('X-Mode'), 'read');
  assert.throws(() => resolveMcpHeaders(declarations, new Map(fields).set('x-mode', 'other'), []), /valid value/);
  assert.throws(() => resolveMcpHeaders(declarations, fields, [{ name: 'AUTHORIZATION', value: 'duplicate' }]), /unique/);
  assert.throws(() => resolveMcpHeaders([], new Map(), [{ name: 'Origin', value: 'https://example.org' }]), /valid HTTP/);
});

test('installed records discard secrets and unsafe auth declarations cannot request app credentials', () => {
  const endpoint = 'https://mcp.example.org/tools/images';
  const record = parseMcpServer({ id: 'images', title: 'Images', endpoint, source: 'registry', auth: 'manual', extraNames: [],
    headers: { Authorization: 'untrusted-user-secret' },
    declarations: [{ name: 'Authorization', isRequired: true, isSecret: true, value: 'Bearer untrusted-registry-secret' }] });
  assert.ok(record);
  assert.equal(JSON.stringify(record).includes('secret'), false);
  assert.equal(record.declarations[0].manualOnly, true);
  const options = { base: new URL('https://mcp.example.org/tools/'), headersForRemote: () => { throw new Error('Policy should not run'); } };
  assert.equal(mcpAppAuth(options, record), undefined);
  assert.equal(mcpAppAuth(options, { source: 'registry', endpoint: 'https://mcp.example.org/tools-elsewhere/images', declarations: [] }), undefined);
  assert.equal(mcpAppAuth(options, { source: 'manual', endpoint, declarations: [] }), undefined);
});

test('installed MCP records round-trip the registry name separately from their display title and local ID', () => {
  const saved = { id: 'github_restcountries', title: 'GitHub RESTCountries.NET', endpoint: 'https://mcp.example.org/countries',
    source: 'registry', auth: 'manual', declarations: [], extraNames: [] };
  const registryName = 'invalid.default-mcp-host/GitHub-RESTCountries';
  const record = parseMcpServer({ ...saved, registryName });
  assert.deepEqual(parseMcpServer(JSON.parse(JSON.stringify(record))), { ...saved, registryName, needsSession: false });
  assert.deepEqual(parseMcpServer(saved), { ...saved, needsSession: false });
  assert.deepEqual(parseMcpServer({ ...saved, source: 'manual', registryName }), { ...saved, source: 'manual', needsSession: false });
});

test('MCP fails closed when a remote only supports an earlier protocol revision', async (t) => {
  const endpoint = 'https://mcp.example.org/tools';
  const attempts = [];
  t.mock.method(globalThis, 'fetch', async (request, init) => {
    const post = new Request(request, init);
    const { method, params } = await post.json();
    attempts.push([post.method, method, post.headers.get('Mcp-Protocol-Version'), params._meta?.['io.modelcontextprotocol/protocolVersion']]);
    return Response.json({ jsonrpc: '2.0', id: null, error: {
      code: -32022, message: 'Unsupported protocol revision', data: { supported: ['2025-11-25'] },
    } }, { status: 400 });
  });
  await assert.rejects(discoverMcpServer({ id: 'remote', title: 'Remote', endpoint, requestHeaders: () => ({}) },
    new AbortController().signal));
  assert.deepEqual(attempts, [['POST', 'server/discover', '2026-07-28', '2026-07-28']]);
});

test('MCP discovers and rechecks completion support before requesting argument values', async (t) => {
  const server = { id: 'fixture', title: 'Fixture', endpoint: 'https://mcp.example.org/complete', requestHeaders: () => ({ Authorization: 'Bearer fixture' }) };
  const signal = new AbortController().signal;
  const prompt = { ref: { type: 'ref/prompt', name: 'compare' }, argument: { name: 'second', value: '' } };
  const template = { ref: { type: 'ref/resource', uri: 'fixture://{group}/{name}' }, argument: { name: 'name', value: 'par' },
    context: { arguments: { group: 'Example' } } };
  const calls = [];
  let advertised = true;
  t.mock.method(globalThis, 'fetch', async (request, init) => {
    const post = new Request(request, init);
    assert.equal(post.url, server.endpoint);
    assert.equal(post.headers.get('Authorization'), 'Bearer fixture');
    const { id, method, params } = await post.json();
    if (method === 'server/discover') return Response.json({ jsonrpc: '2.0', id,
      result: { supportedVersions: ['2026-07-28'], capabilities: advertised ? { completions: {} } : {} } });
    assert.equal(method, 'completion/complete');
    assert.ok(advertised);
    const { _meta, ...args } = params;
    calls.push(args);
    return Response.json({ jsonrpc: '2.0', id, result: { resultType: 'complete', completion: {
      values: ['Paris', '', 'Paris', 'line\nbreak', 'a'.repeat(2049), 'Parma'], hasMore: true,
    } } });
  });
  assert.equal((await discoverMcpServer(server, signal)).hasCompletions, true);
  assert.deepEqual(await completeMcpArgument(server, prompt, signal), ['Paris', 'Parma']);
  assert.deepEqual(await completeMcpArgument(server, template, signal), ['Paris', 'Parma']);
  advertised = false;
  assert.equal((await discoverMcpServer(server, signal)).hasCompletions, false);
  assert.deepEqual(await completeMcpArgument(server, prompt, signal), []);
  assert.deepEqual(calls, [prompt, template]);
});

for (const protect of [false, true]) {
  test(`managed MCP negotiates credentials only on a discovery challenge (${protect ? 'protected' : 'public'})`, async (t) => {
    const endpoint = 'https://mcp.example.org/tools/arbitrary-route';
    const calls = [];
    let credentials = 0;
    t.mock.method(globalThis, 'fetch', async (request, init) => {
      const post = new Request(request, init);
      const { id, method } = await post.json();
      const authorization = post.headers.get('Authorization');
      calls.push([method, authorization]);
      if (protect && !authorization) return new Response(null, { status: 401, headers: { 'WWW-Authenticate': 'Bearer' } });
      const result = method === 'server/discover' ? { supportedVersions: ['2026-07-28'], capabilities: { tools: {} } } : { tools: [], resultType: 'complete', ttlMs: 0, cacheScope: 'private' };
      return Response.json({ jsonrpc: '2.0', id, result });
    });
    await discoverMcpServer({ id: 'fixture', title: 'Fixture', endpoint, challengeOnly: true,
      requestHeaders: () => { credentials++; return { Authorization: 'Bearer fixture' }; } }, new AbortController().signal);
    assert.deepEqual(calls, [['server/discover', null], ...(protect ? [['server/discover', 'Bearer fixture']] : []), ['tools/list', protect ? 'Bearer fixture' : null]]);
    assert.equal(credentials, protect ? 2 : 0);
  });
}

test('tool output carries full ordered content and structured data, not a display projection', async (t) => {
  const endpoint = 'https://mcp.example.org/tools';
  const content = [
    { type: 'text', text: 'a'.repeat(140 * 1024) },
    { type: 'image', mimeType: 'image/png', data: 'AQID' },
    { type: 'audio', mimeType: 'audio/wav', data: 'BAUG' },
    { type: 'resource_link', name: 'source', uri: 'fixture://source' },
    { type: 'resource', resource: { uri: 'fixture://record', mimeType: 'text/plain', text: 'complete embedded record' } },
  ];
  const structuredContent = { country: { code: 'PL', name: 'Poland' } };
  let rejectTool = false;
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (request, init) => {
    const { id, method } = await new Request(request, init).json();
    calls.push(method);
    if (rejectTool && method === 'tools/call') return new Response(null, { status: 401, headers: { 'WWW-Authenticate': 'Bearer' } });
    const result = method === 'server/discover' ? { supportedVersions: ['2026-07-28'], capabilities: { tools: {} } }
      : { resultType: 'complete', content, structuredContent, isError: false, _meta: { private: 'not model-visible' } };
    return Response.json({ jsonrpc: '2.0', id, result });
  });
  const server = { id: 'fixture', title: 'Fixture', endpoint, challengeOnly: true, requestHeaders: () => assert.fail('Unchallenged discovery must not request credentials') };
  const tool = { name: 'fixture', remoteName: 'fixture', inputSchema: { type: 'object' }, server };
  const result = await callMcpTool(tool, {}, new AbortController().signal);
  assert.deepEqual(result.output, { content, structuredContent, isError: false });
  rejectTool = true;
  await assert.rejects(callMcpTool(tool, {}, new AbortController().signal), /401/);
  assert.deepEqual(calls, ['server/discover', 'tools/call', 'server/discover', 'tools/call']);
});
