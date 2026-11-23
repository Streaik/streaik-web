import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BlobWriter, TextReader, ZipWriter } from '@zip.js/zip.js';
import { createGateway } from '../packages/gateway/src/index.ts';
import { buildSkillMarkdown, exportSkillZip, importSkillZip, parseSkillMarkdown, saveSkillVersion } from '../packages/chat/src/skillBundles.ts';
import { resolveSkillTool, skillSystemBlock, skillTools } from '../packages/chat/src/skillTools.ts';
import { activeChatTools, filterLocalToolReplay } from '../packages/chat/src/localPlugins.ts';

const bundle = {
  metadata: { name: 'daily-notes', description: 'Summarize meeting notes: tailor the examples.', compatibility: 'Streaik', license: 'MIT',
    metadata: { version: '1.0' }, 'allowed-tools': 'Read' },
  instructions: '# Summarize the notes\n\nUse references/guide.md.',
  files: [{ path: 'references/guide.md', data: new Blob(['reference payload']) }],
};

test('Agent Skills round-trip frontmatter and resources and reject invalid YAML and archive paths', async () => {
  assert.deepEqual(parseSkillMarkdown(buildSkillMarkdown(bundle)), { metadata: bundle.metadata, instructions: bundle.instructions });
  const imported = await importSkillZip(await exportSkillZip(bundle));
  assert.deepEqual(imported.metadata, bundle.metadata);
  assert.equal(imported.instructions, bundle.instructions);
  assert.equal(imported.files[0].path, 'references/guide.md');
  assert.equal(await imported.files[0].data.text(), 'reference payload');
  assert.throws(() => parseSkillMarkdown('---\nname: double--hyphen\ndescription: Text\n---'), /lowercase/);
  assert.throws(() => parseSkillMarkdown('---\nname: daily-notes\nname: duplicate\ndescription: Text\n---'), /invalid YAML/);
  for (const [root, reason] of [['renamed', /match its name/], ['daily-notes/..', /safe path|unsafe filename/i]]) {
    const writer = new ZipWriter(new BlobWriter());
    await writer.add(`${root}/SKILL.md`, new TextReader(buildSkillMarkdown(bundle)), { useWebWorkers: false });
    await assert.rejects(importSkillZip(await writer.close()), reason);
  }
  const initial = saveSkillVersion([], bundle);
  assert.throws(() => saveSkillVersion(initial, bundle), /already exists/);
  const next = saveSkillVersion(initial, { ...bundle, instructions: 'Second version' }, initial[0].id);
  assert.equal(next[0].defaultVersion, 2);
  assert.equal(next[0].versions[0].instructions, bundle.instructions);
});

test('the catalog discloses exact IDs and metadata, and the tools reveal contents on demand', async () => {
  const skills = saveSkillVersion([], bundle);
  const id = skills[0].id;
  const context = skillSystemBlock(skills).availableSkills;
  assert.equal(context.activationExamples[0], `- skill_id=${id}; name=daily-notes: ${bundle.metadata.description}`);
  assert.deepEqual(context.skills[0], { id, skill_id: id, exact_skill_id_to_activate: id, name: bundle.metadata.name,
    description: bundle.metadata.description, activation: `Call activate_skill with skill_id "${id}".` });
  assert.doesNotMatch(JSON.stringify(context), /Summarize the notes|references\/guide\.md|reference payload/);
  assert.equal(skillSystemBlock([{ ...skills[0], enabled: false }]), undefined);
  assert.deepEqual(skillTools.map(({ name, inputSchema }) => [name, inputSchema.required]), [
    ['activate_skill', ['skill_id']], ['read_skill_resource', ['skill_id', 'path']],
  ]);
  const active = await resolveSkillTool('activate_skill', { skill_id: id }, skills);
  assert.equal(active.structuredContent.skill.instructions, bundle.instructions);
  assert.match(active.content[0].text, /^<skill_content/);
  assert.doesNotMatch(active.content[0].text, /reference payload/);
  const file = await resolveSkillTool('read_skill_resource', { skill_id: id, path: bundle.files[0].path }, skills);
  assert.equal(file.structuredContent.skillResource.text, 'reference payload');
  assert.match(file.content[0].text, /^<skill_resource/);
  assert.equal((await resolveSkillTool('read_skill_resource', { skill_id: id, path: '../keys' }, skills)).isError, true);
  assert.equal((await resolveSkillTool('activate_skill', { skill_id: bundle.metadata.name }, skills)).isError, true);
  assert.equal((await resolveSkillTool('activate_skill', { skill_id: id }, [])).isError, true);
  const route = { mode: 'gateway', endpoint: '/api/chat' };
  assert.deepEqual(activeChatTools(route, [], false, [], true).map(({ definition }) => definition.name), ['activate_skill', 'read_skill_resource']);
  assert.deepEqual(activeChatTools({ mode: 'direct', endpoint: '/v1/responses' }, [], false, [], true), []);
  const completion = [{ id: 'm', role: 'assistant', parts: [{ type: 'dynamic-tool', toolName: 'activate_skill', toolCallId: 'a',
    state: 'output-available', input: { skill_id: id }, output: active }] }];
  assert.deepEqual(filterLocalToolReplay(completion, skillTools, true, new Set([id])), completion);
  assert.deepEqual(filterLocalToolReplay(completion, skillTools, true, new Set()), []);
});

test('remote skill content is fetched only on activation, validated, and reused within the turn', async () => {
  const id = 'openai/skill_remote';
  const skill = { id, name: bundle.metadata.name, description: bundle.metadata.description };
  const zip = await exportSkillZip(bundle);
  const args = { skill_id: id, path: 'references/guide.md' };
  const calls = [];
  const remote = { skills: [skill], bundles: new Map(), download: async (...args) => { calls.push(args); return zip; } };
  const controller = new AbortController();
  const { signal } = controller;
  const local = saveSkillVersion([], { ...bundle, metadata: { ...bundle.metadata, name: 'local-notes' } });
  const { skills } = skillSystemBlock(local, [skill]).availableSkills;
  assert.deepEqual(skills.map(item => item.id), [local[0].id, id]);
  assert.doesNotMatch(JSON.stringify(skills), /Summarize the notes|reference payload/);
  assert.equal((await resolveSkillTool('activate_skill', { skill_id: 'openai/not-enabled' }, local, remote, signal)).isError, true);
  assert.match((await resolveSkillTool('read_skill_resource', args, local, remote, signal)).content[0].text, /Call activate_skill/);
  assert.deepEqual(calls, []);

  const activated = await resolveSkillTool('activate_skill', args, local, remote, signal);
  assert.equal(activated.structuredContent.skill.id, id);
  assert.equal(activated.structuredContent.skill.instructions, bundle.instructions);
  const resource = await resolveSkillTool('read_skill_resource', args, local, remote, signal);
  assert.equal(resource.structuredContent.skillResource.text, 'reference payload');
  await resolveSkillTool('activate_skill', args, local, remote, signal);
  assert.deepEqual(calls, [[id, undefined, signal]]);

  const invalid = { ...remote, bundles: new Map(), download: async () => new Blob(['not a ZIP']) };
  assert.equal((await resolveSkillTool('activate_skill', args, [], invalid)).isError, true);
  assert.equal(invalid.bundles.size, 0);
  const interrupted = { ...remote, bundles: new Map(), download: async () => { controller.abort(); return zip; } };
  await assert.rejects(resolveSkillTool('activate_skill', args, [], interrupted, signal), { name: 'AbortError' });
  assert.equal(interrupted.bundles.size, 0);
});

test('uploads use the selected provider and gateway paths remain under the configured base', async () => {
  const selected = [], calls = [];
  const gateway = createGateway(new URL('https://gateway.example/base/'), request => {
    selected.push(request);
    return { authorization: 'Bearer fixture' };
  }, async (url, init) => {
    calls.push({ url, init });
    if (url.endsWith('/providers')) return Response.json({ auth: 'provider-header', providers: ['openai'] });
    if (url.endsWith('/content')) return new Response('ZIP', { headers: { 'content-type': 'application/zip' } });
    if (init.method === 'POST') return Response.json({ id: 'openai/skill_2' });
    return Response.json({ data: [], has_more: false });
  });
  await gateway.listSkills({ after: 'openai/skill_1', order: 'asc', limit: 10 });
  await gateway.listSkillVersions('openai/with space');
  assert.equal(await (await gateway.downloadSkill('openai/with space', '1')).text(), 'ZIP');
  const targets = await gateway.skillUploadTargets();
  assert.equal((await gateway.uploadSkill('openai', new Blob(['ZIP']), targets)).id, 'openai/skill_2');
  assert.deepEqual(calls.map(({ url }) => url), [
    'https://gateway.example/base/v1/skills?after=openai%2Fskill_1&limit=10&order=asc',
    'https://gateway.example/base/v1/skills/openai/with%20space/versions',
    'https://gateway.example/base/v1/skills/openai/with%20space/versions/1/content',
    'https://gateway.example/base/v1/skills/providers', 'https://gateway.example/base/v1/skills',
  ]);
  assert.equal(calls.at(-1).init.headers.get('x-streaik-provider'), 'openai');
  assert.equal(calls.at(-1).init.headers.get('authorization'), 'Bearer fixture');
  assert.equal(await calls.at(-1).init.body.get('files').text(), 'ZIP');
  assert.deepEqual(selected.at(-1), { kind: 'skill', provider: 'openai' });
  await assert.rejects(gateway.downloadSkill('openai/..'), /invalid provider skill/i);
  await assert.rejects(gateway.uploadSkill('unknown', new Blob(['ZIP']), targets), /supported/);
  assert.equal(calls.length, 5);
});
