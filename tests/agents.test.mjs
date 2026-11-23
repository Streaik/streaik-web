import assert from 'node:assert/strict';
import test from 'node:test';
import { primaryAgentModel } from '../packages/chat/src/agentDefinition.ts';
import { agentIconSources, createAgentDraft, saveAgentDraft } from '../packages/chat/src/agentDraft.ts';
import { buildAgentCatalog, defaultAgentKey, emptyAgentData, readAgentData, removeAgentChange, roleAssignment,
  saveAgentDefinition, setRoleAssignment } from '../packages/chat/src/agentCatalog.ts';

const fixture = {
  name: 'ExampleAgent', description: 'An example.', instructions: 'Use the supplied context.',
  model: { id: 'provider/main', providerMetadata: { provider: { customOption: true } } },
  models: [{ id: 'provider/router', type: 'decision' }, { id: 'provider/main', options: { temperature: 0 } }],
  transcription: null, speech: { model: { id: 'provider/tts' }, voice: null, outputFormat: { type: 'pcm', rate: 24000 } },
  tags: ['test'], owned_by: 'example', argumentHint: null,
  responseFormat: { type: 'json_schema', json_schema: { name: 'result', schema: { type: 'object' }, strict: true } },
  mcpServers: { example: { type: 'http', url: 'https://example.test/mcp', allowed_tools: [], defer_loading: true } },
  mcpClient: { capabilities: {}, policy: { readOnlyHint: true } },
  skills: [{ type: 'skill_reference', skill_id: 'provider/skill', version: 'latest' }],
  tools: [{ type: 'function', name: 'lookup', allowed_callers: ['direct'] }],
  icons: [{ src: 'https://example.test/icon.svg' }],
  plugins: [{ type: 'base64', media_type: 'application/zip', data: 'dGVzdA==' }],
  evaluations: { localEvaluator: { nonEmpty: { minLength: 1 } } },
  futureField: { nested: [null, false, { unknown_key: 'kept' }] },
};
const sample = { id: 'stable-sample', definition: fixture };
const role = { id: 'welcome', label: 'Welcome', defaultAgentId: sample.id };
const config = { defaults: [sample], roles: [role] };

test('portable agent JSON keeps unedited wire fields through draft editing and storage', () => {
  const draft = createAgentDraft(fixture);
  assert.deepEqual(saveAgentDraft(draft, fixture), fixture);
  const edited = saveAgentDraft({ ...draft, name: ' LocalExample ', description: 'Edited only here.' }, fixture);
  const stored = saveAgentDefinition(emptyAgentData(), [], edited, undefined, 'test-id');
  const [local] = readAgentData(JSON.stringify(stored)).local;
  assert.deepEqual(local.definition, { ...fixture, name: 'LocalExample', description: 'Edited only here.' });
  assert.equal(local.id, 'test-id');
  assert.equal(Object.hasOwn(local.definition, 'source'), false);
});

test('invalid drafts and incompatible storage versions are rejected', () => {
  const draft = createAgentDraft(fixture);
  assert.throws(() => saveAgentDraft({ ...draft, models: [{}] }, fixture), /model ID/);
  assert.throws(() => saveAgentDraft({ ...draft, description: '\n ' }, fixture), /required/);
  assert.throws(() => saveAgentDraft({ ...draft, speech: { ...draft.speech, speed: '-1' } }, fixture), /positive number/);
  assert.throws(() => saveAgentDraft({ ...draft, speech: { ...draft.speech, rate: '44100.5' } }, fixture), /positive whole number/);
  assert.throws(() => saveAgentDraft({ ...draft, speech: { ...draft.speech, mime: 'text/plain' } }, fixture), /audio MIME type/);
  assert.throws(() => saveAgentDraft({ ...draft, icons: [{ key: 1, src: 'file:///icon.png', theme: '' }] }, fixture), /valid icon URL/);
  assert.throws(() => readAgentData('{"version":2}'), /Unsupported/);
});

test('model edits preserve the order and metadata of retained configurations and legacy definitions', () => {
  const draft = createAgentDraft(fixture);
  const reordered = saveAgentDraft({ ...draft, models: [...draft.models].reverse() }, fixture);
  assert.deepEqual(reordered.model, fixture.model);
  assert.deepEqual(reordered.models, [fixture.models[1], fixture.models[0]]);
  assert.equal(primaryAgentModel(fixture), fixture.models[1]);
  const { models: _, ...legacy } = fixture;
  const legacyDraft = createAgentDraft(legacy);
  const expanded = saveAgentDraft({ ...legacyDraft, models: [...legacyDraft.models, fixture.models[0]] }, legacy);
  assert.deepEqual(expanded.models, [fixture.model, fixture.models[0]]);
  assert.deepEqual(expanded.model, fixture.model);
  const cleared = saveAgentDraft({ ...createAgentDraft(expanded), models: [] }, expanded);
  assert.equal(primaryAgentModel(cleared), undefined);
  assert.equal(Object.hasOwn(cleared, 'model'), false);
  assert.deepEqual(cleared.models, []);
});

test('nested edits keep unrelated audio and icon metadata and preserve other extensions', () => {
  const source = { ...fixture, icons: [{ ...fixture.icons[0], mimeType: 'image/svg+xml', sizes: ['any'], future: 'kept' }],
    speech: { ...fixture.speech, outputFormat: { ...fixture.speech.outputFormat, channels: 1 }, future: { enabled: true } } };
  const draft = createAgentDraft(source);
  const edited = saveAgentDraft({ ...draft, owner: '', argumentHint: ' Ask about the result ', tags: ['docs'],
    icons: [{ ...draft.icons[0], theme: 'dark' }], transcription: { id: 'provider/asr', type: 'transcription' },
    speech: { ...draft.speech, speed: '1.25', mime: 'audio/pcm', rate: '16000' } }, source);
  assert.deepEqual(edited.icons, [{ ...source.icons[0], theme: 'dark' }]);
  assert.deepEqual(edited.speech, { ...source.speech, speed: 1.25, outputFormat: { type: 'audio/pcm', rate: 16000, channels: 1 } });
  assert.deepEqual(edited.transcription, { id: 'provider/asr', type: 'transcription' });
  assert.equal(Object.hasOwn(edited, 'owned_by'), false);
  assert.deepEqual(edited.tags, ['docs']);
  assert.equal(edited.argumentHint, 'Ask about the result');
  assert.deepEqual(edited.responseFormat, source.responseFormat);
  assert.deepEqual(edited.futureField, source.futureField);
});

test('icon sources prefer the active scheme and skip invalid or mismatched images', () => {
  const icons = [{ src: '/plain.svg' }, { src: 'https://example.test/light.svg', theme: 'light' },
    { src: 'javascript:alert(1)', theme: 'dark' }, { src: 'https://a:b@example.test/dark.svg', theme: 'dark' },
    { src: 'data:image/png;base64,abc', theme: 'dark' }, null];
  assert.deepEqual(agentIconSources(icons, 'dark'), ['data:image/png;base64,abc', '/plain.svg']);
  assert.deepEqual(agentIconSources(icons, 'light'), ['https://example.test/light.svg', '/plain.svg']);
});

test('sample override and reset keep the sample identity and role assignment', () => {
  const base = setRoleAssignment(emptyAgentData(), role, defaultAgentKey(role));
  const entries = buildAgentCatalog(config, base);
  const definition = { ...fixture, instructions: 'A local override.' };
  const data = readAgentData(JSON.stringify(saveAgentDefinition(base, entries, definition, entries[0])));
  const [edited] = buildAgentCatalog(config, data);
  assert.equal(fixture.instructions, 'Use the supplied context.');
  assert.equal(edited.key, 'sample:stable-sample');
  assert.equal(edited.overridden, true);
  assert.deepEqual(edited.definition, definition);
  const reset = removeAgentChange(data, edited);
  const [restored] = buildAgentCatalog(config, reset);
  assert.equal(restored.overridden, false);
  assert.equal(restored.definition, fixture);
  assert.equal(roleAssignment(reset, role), restored.key);
  assert.throws(() => saveAgentDefinition(base, entries, { ...fixture, name: 'Renamed' }, entries[0]), /cannot be changed/);
});

test('renaming preserves local identity; deletion never substitutes a similarly named agent', () => {
  let data = emptyAgentData();
  const entries = buildAgentCatalog(config, data);
  assert.throws(() => saveAgentDefinition(data, entries, { ...fixture, name: 'exampleagent' }, undefined, 'local-id'), /already exists/);
  data = saveAgentDefinition(data, entries, { ...fixture, name: 'Custom' }, undefined, 'same-id');
  const local = buildAgentCatalog(config, data).find((entry) => entry.source === 'local');
  data = setRoleAssignment(data, role, local.key);
  data = saveAgentDefinition(data, [local, ...entries], { ...local.definition, name: 'Renamed' }, local);
  assert.equal(buildAgentCatalog(config, data).find((entry) => entry.key === local.key).definition.name, 'Renamed');
  data = removeAgentChange(data, local);
  data = saveAgentDefinition(data, entries, { ...fixture, name: 'Renamed' }, undefined, 'new-id');
  assert.equal(roleAssignment(data, role), local.key);
  assert.equal(buildAgentCatalog(config, data).some((entry) => entry.key === local.key), false);
  data = readAgentData(JSON.stringify(setRoleAssignment(data, role, null)));
  assert.equal(roleAssignment(data, role), null);
  assert.equal(roleAssignment(setRoleAssignment(data, role, undefined), role), undefined);
});
