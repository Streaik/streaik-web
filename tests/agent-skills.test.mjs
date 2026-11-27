import assert from 'node:assert/strict';
import test from 'node:test';
import { browserChatSkills, hostedChatSkills } from '../packages/chat/src/agentChatSkills.ts';
import { emptyAgentData, readAgentData, saveAgentDefinition, serializeAgentData } from '../packages/chat/src/agentCatalog.ts';
import { createAgentDraft, saveAgentDraft } from '../packages/chat/src/agentDraft.ts';
import { agentSkillsTool, patchAgentSkills } from '../packages/chat/src/agentTools.ts';
import { downloadAgentSkill, embedAgentSkill, embeddedSkillOrigin, inlineAgentSkillZip, linkAgentSkill } from '../packages/chat/src/agentSkills.ts';
import { buildRequestContext, requestContextText } from '../packages/chat/src/chatContext.ts';
import { activeChatTools, filterLocalToolReplay } from '../packages/chat/src/localPlugins.ts';
import { exportSkillZip, importSkillZip, saveSkillVersion } from '../packages/chat/src/skillBundles.ts';
import { resolveSkillTool, skillTools } from '../packages/chat/src/skillTools.ts';
import { normalizeChatPreferences } from '../packages/chat/src/chatPreferences.ts';

const bundle = { metadata: { name: 'meeting-notes', description: 'Help with meeting notes.', metadata: { owner: 'docs' } },
  instructions: 'Use the private meeting template.', files: [{ path: 'references/template.md', data: new Blob(['Template contents']) }] };
const remote = { id: 'openai/skill_notes', name: 'provider-notes', description: 'Notes from the catalog.', latest_version: '3', default_version: '2' };

test('agent draft and storage round-trip both portable variants without altering unrelated entries', async () => {
  const reference = linkAgentSkill(remote.id);
  assert.deepEqual(reference, { type: 'skill_reference', skill_id: remote.id, version: 'latest' });
  assert.deepEqual(linkAgentSkill(remote.id, ''), { type: 'skill_reference', skill_id: remote.id });
  const origin = { id: remote.id, version: '2' };
  const inline = await embedAgentSkill(bundle, origin);
  assert.deepEqual(Object.keys(inline), ['type', 'name', 'description', 'source']);
  assert.equal(inline.source.type, 'base64');
  assert.equal(inline.source.media_type, 'application/zip');
  assert.deepEqual(await embeddedSkillOrigin(inline), origin);
  assert.equal((await importSkillZip(inlineAgentSkillZip(inline))).metadata.metadata.owner, 'docs');
  assert.equal(bundle.metadata.metadata['streaik-agent-skill-id'], undefined);
  const future = { type: 'future_tool', settings: { foo: [false, null] } };
  const source = { name: 'Test agent', description: 'A test.', instructions: 'Help.', tools: [future] };
  const edited = saveAgentDraft({ ...createAgentDraft(source), tools: patchAgentSkills(source.tools, { skills: [reference, inline], execution: 'server' }) }, source);
  const data = saveAgentDefinition(emptyAgentData(), [], edited, undefined, 'test');
  const { definition } = readAgentData(serializeAgentData(data)).local[0];
  assert.deepEqual(definition, edited);
  const adjusted = saveAgentDraft({ ...createAgentDraft(definition), tools: patchAgentSkills(definition.tools, { skills: [inline] }) }, definition);
  assert.deepEqual(agentSkillsTool(adjusted.tools), { type: 'skills', skills: [inline], execution: 'server' });
  const client = patchAgentSkills(adjusted.tools, { execution: 'client' });
  assert.equal(agentSkillsTool(client).execution, 'client');
  const defaults = saveAgentDraft({ ...createAgentDraft(adjusted), tools: patchAgentSkills(client, { execution: undefined }) }, adjusted);
  assert.deepEqual(defaults.tools, [future, { type: 'skills', skills: [inline] }]);
  assert.deepEqual(adjusted.tools[0], future);
  assert.deepEqual(source.tools, [future]);
});

test('agent links resolve Default, Latest and pinned versions without downloading when configured', async () => {
  const signal = new AbortController().signal;
  const calls = [];
  const gateway = { downloadSkill: async (...args) => { calls.push(args); return new Blob(); },
    listSkillVersions: async (...args) => { calls.push(args); return { data: [{ version: '4' }] }; } };
  await downloadAgentSkill(gateway, remote.id, undefined, remote, signal);
  await downloadAgentSkill(gateway, remote.id, 'latest', remote, signal);
  await downloadAgentSkill(gateway, remote.id, '1', remote, signal);
  await downloadAgentSkill(gateway, remote.id, 'latest', undefined, signal);
  assert.deepEqual(calls, [[remote.id, undefined, signal], [remote.id, '3', signal], [remote.id, '1', signal],
    [remote.id, { limit: 1, order: 'desc' }, signal], [remote.id, '4', signal]]);
});

test('browser agent chat uses the same catalog and lazy tools in Gateway and Direct, never in hosted execution', async () => {
  const inline = await embedAgentSkill(bundle, { id: 'local:fixture', version: '1' });
  const zip = await exportSkillZip(bundle);
  const downloads = [];
  const gateway = { downloadSkill: async (id, version) => { downloads.push([id, version]); return zip; } };
  const input = { skills: [inline, linkAgentSkill(remote.id, '1')], catalog: [remote], selectedIds: [remote.id], gateway,
    local: saveSkillVersion([], { ...bundle, metadata: { ...bundle.metadata, name: 'global-notes' } }) };

  for (const mode of ['gateway', 'direct']) {
    downloads.length = 0;
    const { local, archives } = browserChatSkills({ ...input, mode });
    const context = buildRequestContext('Streak', 'en', false, local, archives);
    assert.deepEqual(context.skills.skills.map(({ name }) => name), [...(mode === 'gateway' ? ['global-notes'] : []), 'meeting-notes', 'provider-notes']);
    assert.doesNotMatch(requestContextText(context).join('\n'), /private meeting template|Template contents/);
    assert.deepEqual(activeChatTools({ mode, endpoint: '/v1/responses' }, [], false, [], true).map(({ definition }) => definition), skillTools);
    assert.deepEqual(downloads, []);
    const turn = { skills: archives, bundles: new Map() };
    for (const skill of archives) {
      const args = { skill_id: skill.id, path: 'references/template.md' };
      assert.equal((await resolveSkillTool('read_skill_resource', args, local, turn)).isError, true);
      assert.equal((await resolveSkillTool('activate_skill', args, local, turn)).structuredContent.skill.instructions, bundle.instructions);
      assert.equal((await resolveSkillTool('read_skill_resource', args, local, turn)).structuredContent.skillResource.text, 'Template contents');
    }
    assert.deepEqual(downloads, [[remote.id, '1']]);
    const old = [{ id: 'm', role: 'assistant', parts: [{ type: 'dynamic-tool', toolCallId: 'old', toolName: 'activate_skill',
      state: 'output-available', input: { skill_id: archives[1].id }, output: 'Previous skill version' }] }];
    const changed = browserChatSkills({ ...input, mode, skills: [linkAgentSkill(remote.id, '2')] });
    assert.deepEqual(filterLocalToolReplay(old, skillTools, false, new Set(changed.archives.map(({ id }) => id))), []);
  }

  assert.deepEqual(browserChatSkills({ ...input, mode: 'agents' }), { local: [], archives: [], preferenceSkills: [], missingCatalog: false });
  const offline = browserChatSkills({ ...input, mode: 'direct', gateway: undefined });
  assert.deepEqual(offline.archives.map(({ name }) => name), ['meeting-notes']);
  assert.equal(browserChatSkills({ ...input, mode: 'direct', skills: undefined }).archives.length, 0);
});

test('Hosted chat packages enabled default versions and references without local tools, context or replay', async () => {
  const local = saveSkillVersion([], bundle);
  const version2 = { ...bundle, instructions: 'Updated private instructions', files: [] };
  const withVersions = saveSkillVersion(local, version2, local[0].id);
  const [enabled, disabled] = saveSkillVersion(withVersions, { ...bundle, metadata: { name: 'disabled', description: 'Disabled' } });
  const options = { mode: 'gateway', local: [{ ...enabled, defaultVersion: 1 }, { ...disabled, enabled: false }], catalog: [remote],
    selectedIds: [remote.id], gateway: { downloadSkill: () => assert.fail('A hosted reference should not be downloaded in the browser') } };
  for (const value of [undefined, 'client', 'hosted']) {
    assert.equal(normalizeChatPreferences({ skillExecution: value }).skillExecution, value);
  }
  assert.equal(Object.hasOwn(normalizeChatPreferences({ skillExecution: 'default' }), 'skillExecution'), false);
  const client = browserChatSkills(options);
  assert.equal(buildRequestContext('Streaik', 'en', false, client.local, client.archives).skills.skills.length, 2);
  const hosted = browserChatSkills({ ...options, hostedPreferences: true });
  assert.deepEqual([hosted.local, hosted.archives, hosted.preferenceSkills], [[], [], [remote]]);
  const context = buildRequestContext('Streaik', 'en', false, hosted.local, hosted.archives);
  assert.equal(context.skills, undefined);
  assert.equal(context.system.systemInformation.appName, 'Streaik');
  const mcp = { name: 'unrelated_mcp_tool', inputSchema: { type: 'object' } };
  const oldSkill = { type: 'dynamic-tool', toolName: 'activate_skill', toolCallId: 'old', state: 'output-available',
    input: { skill_id: remote.id }, output: 'Previous instructions' };
  const oldMcp = { ...oldSkill, toolName: mcp.name, toolCallId: 'mcp', output: 'MCP result' };
  const replay = filterLocalToolReplay([{ id: 'assistant', role: 'assistant', parts: [oldSkill, oldMcp] }], [mcp], false, new Set());
  assert.deepEqual(replay[0].parts, [oldMcp]);
  const prepare = hostedChatSkills(options.local, hosted.preferenceSkills);
  assert.equal(prepare(), prepare());
  const [inline, reference] = await prepare();
  assert.equal(inline.name, bundle.metadata.name);
  const archive = await importSkillZip(inlineAgentSkillZip(inline));
  assert.equal(archive.instructions, bundle.instructions);
  assert.equal(await archive.files[0].data.text(), 'Template contents');
  assert.deepEqual(reference, { type: 'skill_reference', skill_id: remote.id });
  assert.equal(hostedChatSkills([], []), undefined);
  assert.deepEqual(browserChatSkills({ ...options, mode: 'direct' }).preferenceSkills, []);
});
