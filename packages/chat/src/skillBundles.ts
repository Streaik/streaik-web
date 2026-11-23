import { maxSkillZipBytes } from '@streaik/gateway';
import { parseDocument, stringify } from 'yaml';

const manifestLimit = 256 * 1024;
const fileLimit = 512;
const skillName = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export type SkillMetadata = { name: string; description: string; license?: string; compatibility?: string;
  metadata?: Record<string, string>; 'allowed-tools'?: string };
export type SkillFile = { path: string; data: Blob };
export type SkillBundle = { metadata: SkillMetadata; instructions: string; files: SkillFile[] };
export type SkillVersion = SkillBundle & { version: number; createdAt: number };
export type LocalSkill = { id: string; enabled: boolean; defaultVersion: number; versions: SkillVersion[] };

export function defaultSkillVersion(skill: LocalSkill): SkillVersion {
  return skill.versions.find(({ version }) => version === skill.defaultVersion)!;
}

export function saveSkillVersion(skills: LocalSkill[], bundle: SkillBundle, id?: string): LocalSkill[] {
  if (skills.some(skill => skill.id !== id && defaultSkillVersion(skill).metadata.name === bundle.metadata.name)) {
    throw new Error('A local skill with this name already exists.');
  }
  const current = id && skills.find(skill => skill.id === id);
  if (!id) return [...skills, { id: `local:${crypto.randomUUID()}`, enabled: true, defaultVersion: 1,
    versions: [{ ...bundle, version: 1, createdAt: Date.now() }] }];
  if (!current) throw new Error('This skill no longer exists.');
  const version = (current.versions.at(-1)?.version ?? 0) + 1;
  return skills.map(skill => skill.id !== id ? skill : { ...skill, defaultVersion: version,
    versions: [...skill.versions, { ...bundle, version, createdAt: Date.now() }] });
}

export function validateSkillMetadata(input: unknown): SkillMetadata {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('SKILL.md frontmatter must be a YAML mapping.');
  const { name, description, license, compatibility, metadata, 'allowed-tools': allowed } = input as Record<string, unknown>;
  if (typeof name !== 'string' || name.length > 64 || !skillName.test(name)) {
    throw new Error('Use a name of 1–64 lowercase letters, numbers, and single hyphens.');
  }
  if (typeof description !== 'string' || !description.trim() || Array.from(description).length > 1024) {
    throw new Error('A description of 1–1024 characters is required.');
  }
  if (compatibility !== undefined && (typeof compatibility !== 'string' || !compatibility.trim() || Array.from(compatibility).length > 500)) {
    throw new Error('Compatibility must be 1–500 characters when provided.');
  }
  if (license !== undefined && typeof license !== 'string') throw new Error('License must be text.');
  if (allowed !== undefined && typeof allowed !== 'string') throw new Error('Allowed tools must be text.');
  if (metadata !== undefined && (!metadata || typeof metadata !== 'object' || Array.isArray(metadata) ||
      !Object.values(metadata).every(value => typeof value === 'string'))) throw new Error('Metadata must map text keys to text values.');
  return { name, description, ...(license !== undefined && { license }), ...(compatibility !== undefined && { compatibility }),
    ...(metadata !== undefined && { metadata: metadata as Record<string, string> }), ...(allowed !== undefined && { 'allowed-tools': allowed }) };
}

export function buildSkillMarkdown(bundle: Pick<SkillBundle, 'metadata' | 'instructions'>): string {
  return `---\n${stringify(bundle.metadata)}---\n${bundle.instructions ? `\n${bundle.instructions}\n` : ''}`;
}

export function parseSkillMarkdown(text: string): Omit<SkillBundle, 'files'> {
  if (new Blob([text]).size > manifestLimit) throw new Error('SKILL.md exceeds 256 KiB.');
  const match = /^(?:\uFEFF)?---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(text);
  if (!match) throw new Error('SKILL.md must start with YAML frontmatter between --- delimiters.');
  const parsed = parseDocument(match[1], { uniqueKeys: true, stringKeys: true });
  if (parsed.errors.length || parsed.warnings.length) throw new Error('SKILL.md contains invalid YAML frontmatter.');
  return { metadata: validateSkillMetadata(parsed.toJS({ maxAliasCount: 0 })), instructions: text.slice(match[0].length).trim() };
}

export function skillRelativePath(path: string) {
  if (path.length > 512 || /[\\:\u0000-\u001f\u007f]/.test(path) || path.split('/').some(part => !part.trim() || part === '.' || part === '..')) {
    throw new Error('Use a safe path relative to the skill folder.');
  }
  return path;
}

export function validateSkillBundle(bundle: SkillBundle): SkillBundle {
  const metadata = validateSkillMetadata(bundle.metadata);
  const manifest = new Blob([buildSkillMarkdown({ ...bundle, metadata })]);
  if (manifest.size > manifestLimit) throw new Error('SKILL.md exceeds 256 KiB.');
  if (bundle.files.length + 1 > fileLimit) throw new Error('A skill can contain at most 512 files.');
  let size = manifest.size;
  const paths = new Set(['skill.md']);
  for (const { path, data } of bundle.files) {
    const key = skillRelativePath(path).toLowerCase();
    if (paths.has(key) || key.endsWith('/skill.md')) throw new Error(`Duplicate or reserved skill path: ${path}`);
    paths.add(key);
    size += data.size;
  }
  for (const path of paths) {
    const segments = path.split('/');
    for (let i = 1; i < segments.length; i++) if (paths.has(segments.slice(0, i).join('/'))) throw new Error('A skill path cannot be both a file and a folder.');
  }
  if (size > maxSkillZipBytes) throw new Error('The expanded skill exceeds 16 MiB.');
  return { ...bundle, metadata };
}

export async function importSkillZip(blob: Blob): Promise<SkillBundle> {
  if (!blob.size || blob.size > maxSkillZipBytes) throw new Error('The skill ZIP must be between 1 byte and 16 MiB.');
  const { BlobReader, ZipReader } = await import('@zip.js/zip.js');
  const zip = new ZipReader(new BlobReader(blob));
  try {
    const paths = new Set<string>();
    const entries: { path: string; read: () => Promise<Blob> }[] = [];
    let declared = 0, actual = 0;
    for await (const entry of zip.getEntriesGenerator()) {
      const path = skillRelativePath(entry.directory ? entry.filename.replace(/\/$/, '') : entry.filename);
      const key = path.toLowerCase();
      if (paths.has(key) || entry.encrypted || ((entry.unixExternalUpper ?? 0) & 0xf000) === 0xa000) {
        throw new Error('The ZIP contains a duplicate, encrypted, or linked entry.');
      }
      paths.add(key);
      if (paths.size > fileLimit * 2) throw new Error('The skill ZIP contains too many entries.');
      if (entry.directory) continue;
      declared += entry.uncompressedSize;
      if (entries.length >= fileLimit || declared > maxSkillZipBytes) throw new Error('The expanded skill exceeds archive limits.');
      entries.push({ path, read: async () => {
        const chunks: BlobPart[] = [];
        let count = 0;
        const bound = path.split('/').at(-1) === 'SKILL.md' ? manifestLimit : maxSkillZipBytes;
        await entry.getData(new WritableStream<Uint8Array>({ write(bytes) {
          count += bytes.byteLength; actual += bytes.byteLength;
          if (count > bound || count > entry.uncompressedSize || actual > maxSkillZipBytes) throw new Error('The expanded skill exceeds archive limits.');
          chunks.push(new Uint8Array(bytes));
        } }), { checkSignature: true, useWebWorkers: false });
        return new Blob(chunks);
      } });
    }
    const manifests = entries.filter(({ path }) => path.split('/').at(-1) === 'SKILL.md');
    if (manifests.length !== 1) throw new Error('The ZIP must contain one skill with SKILL.md.');
    const manifest = manifests[0];
    const split = manifest.path.split('/');
    if (split.length > 2) throw new Error('Place SKILL.md at the top of the skill folder.');
    const prefix = split.length === 1 ? '' : `${split[0]}/`;
    if (entries.some(({ path }) => !path.startsWith(prefix))) throw new Error('The ZIP must contain a single skill folder.');
    const fields = parseSkillMarkdown(await (await manifest.read()).text());
    if (prefix && split[0] !== fields.metadata.name) throw new Error('The skill folder must match its name in SKILL.md.');
    const files: SkillFile[] = [];
    for (const entry of entries) if (entry !== manifest) files.push({ path: entry.path.slice(prefix.length), data: await entry.read() });
    return validateSkillBundle({ ...fields, files });
  } finally { await zip.close(); }
}

export async function exportSkillZip(input: SkillBundle): Promise<Blob> {
  const bundle = validateSkillBundle(input);
  const { BlobReader, BlobWriter, TextReader, ZipWriter } = await import('@zip.js/zip.js');
  const zip = new ZipWriter(new BlobWriter('application/zip'));
  const options = { useWebWorkers: false };
  const root = bundle.metadata.name;
  await zip.add(`${root}/SKILL.md`, new TextReader(buildSkillMarkdown(bundle)), options);
  for (const { path, data } of bundle.files) await zip.add(`${root}/${path}`, new BlobReader(data), options);
  const blob = await zip.close();
  if (blob.size > maxSkillZipBytes) throw new Error('The skill ZIP exceeds 16 MiB.');
  return blob;
}
