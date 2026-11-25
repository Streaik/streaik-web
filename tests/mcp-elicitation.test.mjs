import assert from 'node:assert/strict';
import test from 'node:test';
import { elicitationDefaults, elicitationFields, validateElicitation } from '../packages/chat/src/elicitation.ts';
import { defaultMcpPreferences } from '../packages/chat/src/mcpPreferences.ts';
import { callMcpTool, getMcpPrompt, readMcpResource } from '../packages/chat/src/mcp.ts';

test('elicitation validates and preserves primitive values and titled or untitled choices', () => {
  const fields = elicitationFields({ type: 'object', required: ['number', 'stamp'], properties: {
    number: { type: 'integer', minimum: 0, maximum: 30 },
    allowed: { type: 'boolean', default: false },
    rating: { type: 'number', default: 0.5 },
    color: { type: 'string', oneOf: [{ const: '', title: 'Clear' }, { const: 'blue', title: 'Blue' }], default: '' },
    sizes: { type: 'array', minItems: 1, maxItems: 2, items: { anyOf: [{ const: 's', title: 'Small' }, { const: 'l', title: 'Large' }] }, default: ['l'] },
    tag: { type: 'string', enum: ['one', 'two'], enumNames: ['First', 'Second'] },
    extra: { type: 'array', items: { type: 'string', enum: ['one', 'two'] }, default: ['missing'] },
    stamp: { type: 'string', format: 'date-time' },
    date: { type: 'string', format: 'date', default: '2026-11-25' },
    address: { type: 'string', format: 'email' },
    uri: { type: 'string', format: 'uri' },
    note: { type: 'string', minLength: 2, maxLength: 4 },
  } });
  const values = elicitationDefaults(fields);
  assert.deepEqual([...validateElicitation(fields, values).errors], [['number', 'required'], ['stamp', 'required']]);
  assert.deepEqual(fields.find(field => field.name === 'color').options[0], { const: '', title: 'Clear' });
  assert.equal(fields.find(field => field.name === 'tag').options[1].title, 'Second');
  for (const [name, value] of Object.entries({ number: '2.5', stamp: '2026-02-30T12:00:00Z', sizes: ['s', 's'], date: '2026-02-29',
    address: 'not-an-email', note: '💬', uri: '/relative/path' })) values.set(name, value);
  assert.equal(validateElicitation(fields, values).errors.size, 7);
  for (const [name, value] of Object.entries({ number: '0', stamp: '2024-02-29T12:00:00+01:00', sizes: ['s', 'l'], date: '2024-02-29',
    address: 'a@example.test', note: '💬a', uri: 'mailto:a@example.test' })) values.set(name, value);
  values.set('extra-key-from-client', 'ignored');
  assert.deepEqual(validateElicitation(fields, values), { errors: new Map(), content: {
    number: 0, allowed: false, rating: 0.5, color: '', sizes: ['s', 'l'], stamp: '2024-02-29T12:00:00+01:00', date: '2024-02-29',
    address: 'a@example.test', note: '💬a', uri: 'mailto:a@example.test',
  } });
});

const server = { id: 'fixture', title: 'Model Context Utils', endpoint: 'https://fixture.example.test/mcp', requestHeaders: () => ({}) };
const tool = { server, name: 'mcp_fixture_example', remoteName: 'example', inputSchema: { type: 'object' } };
const signal = () => new AbortController().signal;
const requests = {
  form: { method: 'elicitation/create', params: { mode: 'form', message: 'Choose',
    requestedSchema: { type: 'object', properties: { answer: { type: 'string' } }, required: ['answer'] } } },
  url: { method: 'elicitation/create', params: { mode: 'url', message: 'Open', url: 'https://fixture.example.test/form', elicitationId: 'session' } },
};
const capsKey = 'io.modelcontextprotocol/clientCapabilities';

function remote(t, action) {
  return t.mock.method(globalThis, 'fetch', async (request, options) => {
    assert.equal(request.url, server.endpoint);
    assert.equal(request.method, 'POST');
    assert.equal(options.headers.has('Mcp-Session-Id'), false);
    const rpc = await request.json();
    if (rpc.method === 'notifications/cancelled') return new Response(null, { status: 202 });
    const result = rpc.method === 'server/discover' ? { supportedVersions: ['2026-07-28'], capabilities: { tools: {}, prompts: {}, resources: {} } }
      : await action(rpc, options);
    if (result instanceof Response) return result;
    return Response.json({ jsonrpc: '2.0', id: rpc.id, result });
  });
}

test('the pinned SDK advertises form support and resumes tools, prompts, and resources with typed responses', async (t) => {
  const state = 'opaque-state/ü+42';
  const replies = {
    'tools/call': { content: [{ type: 'text', text: 'Tool finished' }] },
    'prompts/get': { messages: [{ role: 'user', content: { type: 'text', text: 'Prompt finished' } }] },
    'resources/read': { ttlMs: 0, cacheScope: 'private', contents: [{ uri: 'fixture://resource', text: 'Resource finished' }] },
  };
  const actions = { 'tools/call': { action: 'accept', content: { answer: 'typed value' } }, 'prompts/get': { action: 'decline' }, 'resources/read': { action: 'cancel' } };
  for (const [method, invoke] of Object.entries({
    'tools/call': ask => callMcpTool(tool, { original: 42 }, signal(), defaultMcpPreferences, ask),
    'prompts/get': ask => getMcpPrompt(server, 'example', { original: '42' }, signal(), ask),
    'resources/read': ask => readMcpResource(server, 'fixture://resource', signal(), ask),
  })) await t.test(method, async sub => {
    const legs = [];
    remote(sub, rpc => {
      assert.equal(rpc.method, method);
      assert.deepEqual(rpc.params._meta[capsKey].elicitation, { form: {} });
      legs.push(rpc);
      return legs.length === 1 ? { resultType: 'input_required', requestState: state, inputRequests: { question: requests.form } }
        : { resultType: 'complete', ...replies[method] };
    });
    await invoke(async (params, source, formSignal) => {
      assert.equal(params.requestedSchema.properties.answer.type, 'string');
      assert.deepEqual(source, { title: server.title, origin: new URL(server.endpoint).origin });
      assert.equal(formSignal.aborted, false);
      return actions[method];
    });
    assert.equal(legs.length, 2);
    assert.notEqual(legs[0].id, legs[1].id);
    assert.equal(legs[1].params.requestState, state);
    assert.deepEqual(legs[1].params.inputResponses, { question: actions[method] });
    for (const key of ['name', 'arguments', 'uri']) assert.deepEqual(legs[1].params[key], legs[0].params[key]);
    if (method === 'tools/call') assert.ok('progressToken' in legs[0].params._meta);
  });
});

test('disabled and unsupported URL requests open no form and cannot resume a tool', async (t) => {
  for (const enabled of [false, true]) await t.test(enabled ? 'URL' : 'disabled', async sub => {
    let calls = 0;
    remote(sub, ({ params }) => {
      calls++;
      assert.deepEqual(params._meta[capsKey]?.elicitation, enabled ? { form: {} } : undefined);
      assert.equal(params._meta.progressToken, undefined);
      return { resultType: 'input_required', requestState: 'not-resumed', inputRequests: { question: enabled ? requests.url : requests.form } };
    });
    let prompts = 0;
    await assert.rejects(callMcpTool(tool, {}, signal(), { ...defaultMcpPreferences, formElicitation: enabled, resetTimeoutOnProgress: false }, async () => {
      prompts++;
      return { action: 'accept', content: {} };
    }));
    assert.equal(prompts, 0);
    assert.equal(calls, 1);
  });
});

test('aborting the whole MCP operation dismisses outstanding form input without a continuation', async (t) => {
  const controller = new AbortController();
  let calls = 0;
  remote(t, () => {
    calls++;
    return { resultType: 'input_required', inputRequests: { question: requests.form } };
  });
  await assert.rejects(callMcpTool(tool, {}, controller.signal, defaultMcpPreferences, (_params, _source, formSignal) => {
    const wait = new Promise((_resolve, reject) => formSignal.addEventListener('abort', () => reject(formSignal.reason), { once: true }));
    controller.abort();
    return wait;
  }), { name: 'AbortError' });
  assert.equal(calls, 1);
});

test('tool progress can extend the configured timeout but not the hard deadline', async (t) => {
  for (const scenario of ['complete after progress', 'timeout without reset', 'hard deadline']) await t.test(scenario, async sub => {
    sub.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
    sub.mock.method(AbortSignal, 'timeout', (delay) => {
      const controller = new AbortController();
      setTimeout(() => controller.abort(new DOMException('Timed out', 'TimeoutError')), delay);
      return controller.signal;
    });
    const resetTimeoutOnProgress = scenario !== 'timeout without reset';
    const streamOpened = Promise.withResolvers();
    remote(sub, ({ id, method, params }, { signal }) => {
      assert.equal(method, 'tools/call');
      assert.equal('progressToken' in params._meta, resetTimeoutOnProgress);
      const encoder = new TextEncoder();
      const stream = new ReadableStream({ start(controller) {
        signal.addEventListener('abort', () => controller.error(signal.reason), { once: true });
        const frame = value => controller.enqueue(encoder.encode(`data: ${JSON.stringify({ jsonrpc: '2.0', ...value })}\n\n`));
        streamOpened.resolve({ progress: value => frame({ method: 'notifications/progress', params: { progressToken: params._meta.progressToken, progress: value } }),
          complete: () => { frame({ id, result: { resultType: 'complete', content: [] } }); controller.close(); } });
      } });
      return new Response(stream, { headers: { 'content-type': 'text/event-stream' } });
    });
    const outcome = callMcpTool(tool, {}, signal(), { ...defaultMcpPreferences, toolTimeoutMinutes: 1, resetTimeoutOnProgress })
      .then(value => ({ value }), error => ({ error }));
    const stream = await streamOpened.promise;
    const flush = () => new Promise(resolve => setImmediate(resolve));
    await flush();
    if (!resetTimeoutOnProgress) {
      sub.mock.timers.tick(60_000);
      assert.match((await outcome).error.message, /timed out/i);
    } else {
      sub.mock.timers.tick(40_000);
      stream.progress(1);
      await flush();
      sub.mock.timers.tick(40_000);
      if (scenario === 'complete after progress') {
        stream.complete();
        assert.deepEqual((await outcome).value.output, { content: [] });
      } else {
        stream.progress(2);
        await flush();
        sub.mock.timers.tick(40_000);
        assert.match((await outcome).error.message, /timed out/i);
      }
    }
  });
});
