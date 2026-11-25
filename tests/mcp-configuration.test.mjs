import assert from 'node:assert/strict';
import test from 'node:test';
import { callMcpTool, discoverMcpServer, mcpAppAuth } from '../packages/chat/src/mcp.ts';
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
  assert.deepEqual(result.images, ['data:image/png;base64,AQID']);
  rejectTool = true;
  await assert.rejects(callMcpTool(tool, {}, new AbortController().signal), /401/);
  assert.deepEqual(calls, ['server/discover', 'tools/call', 'server/discover', 'tools/call']);
});
