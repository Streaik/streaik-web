import assert from 'node:assert/strict';
import test from 'node:test';
import { discoverMcpTools, mcpAppAuth } from '../packages/chat/src/mcp.ts';
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
  await assert.rejects(discoverMcpTools({ id: 'remote', title: 'Remote', endpoint, requestHeaders: () => ({}) },
    new AbortController().signal));
  assert.deepEqual(attempts, [['POST', 'server/discover', '2026-07-28', '2026-07-28']]);
});
