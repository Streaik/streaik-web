import assert from 'node:assert/strict';
import test from 'node:test';
import { browserChatSkills } from '../packages/chat/src/agentChatSkills.ts';
import { emptyAgentData, readAgentData, saveAgentDefinition, serializeAgentData } from '../packages/chat/src/agentCatalog.ts';
import { createAgentDraft, saveAgentDraft } from '../packages/chat/src/agentDraft.ts';
import { downloadAgentSkill, embedAgentSkill, embeddedSkillOrigin, inlineAgentSkillZip, linkAgentSkill } from '../packages/chat/src/agentSkills.ts';
import { buildRequestContext, requestContextText } from '../packages/chat/src/chatContext.ts';
import { activeChatTools, filterLocalToolReplay } from '../packages/chat/src/localPlugins.ts';
import { exportSkillZip, importSkillZip, saveSkillVersion } from '../packages/chat/src/skillBundles.ts';
import { resolveSkillTool, skillTools } from '../packages/chat/src/skillTools.ts';

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
  const future = { type: 'future_skill', settings: { foo: [false, null] } };
  const source = { name: 'Test agent', description: 'A test.', instructions: 'Help.', skills: [future] };
  const edited = saveAgentDraft({ ...createAgentDraft(source), skills: [future, reference, inline] }, source);
  const data = saveAgentDefinition(emptyAgentData(), [], edited, undefined, 'test');
  const { definition } = readAgentData(serializeAgentData(data)).local[0];
  assert.deepEqual(definition, edited);
  assert.deepEqual(saveAgentDraft({ ...createAgentDraft(definition), skills: [future, inline] }, definition).skills, [future, inline]);
  assert.deepEqual(source.skills, [future]);
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
