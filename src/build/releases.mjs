// Published exact versions live on in <subject>/releases/<version>/ as
// committed snapshots, so a catalog keeps serving every version it ever
// published while its models move on. Moved from geolonia/datamodels
// (scripts/lib/releases.mjs, #10).
//
//   <subject>/releases/v1.0.0/context.jsonld
//   <subject>/releases/v1.0.0/vocab.jsonld
//   <subject>/releases/v1.0.0/schema/<Type>.json
import { mkdir, readdir, readFile, stat, lstat } from 'node:fs/promises';
import { join, dirname, basename } from 'node:path';
import { buildVocabulary } from './vocab.mjs';
import { writeNoFollow } from './load.mjs';

const json = (o) => JSON.stringify(o, null, 2) + '\n';
async function isDir(p) { try { return (await stat(p)).isDirectory(); } catch { return false; } }

// A snapshot is published byte for byte, so each part of it must be a real
// folder or file in the repository: a symbolic link would publish whatever it
// points to, a file outside the node included. lstat, unlike stat, does not
// follow the link. Returns false when the path is absent.
async function plain(p, what) {
  let s;
  try { s = await lstat(p); } catch (e) { if (e.code === 'ENOENT') return false; throw e; }
  if (s.isSymbolicLink()) throw new Error(`${p} is a symbolic link. A release snapshot is published as it is, so it must hold real files and folders: replace the link with the file it points to, or remove it`);
  if (what === 'dir' ? !s.isDirectory() : !s.isFile()) throw new Error(`${p} is not a ${what === 'dir' ? 'folder' : 'regular file'}`);
  return true;
}

/**
 * What the snapshot of the subject's current version must contain: { dir,
 * entries: [{ file, content, what, url }] }, `url` where the file is published.
 */
export function releaseContents(subject, options) {
  const dir = join(subject.dir, 'releases', `v${subject.version}`);
  const at = `${subject.name} v${subject.version}`;
  const v = options.urls.versionUrls(subject.name, subject.version);
  return {
    dir,
    entries: [
      { file: join(dir, 'context.jsonld'), content: json(subject.context), what: `${at} context`, url: v.context },
      { file: join(dir, 'vocab.jsonld'), content: json(buildVocabulary(subject, options)), what: `${at} vocabulary`, url: v.vocab },
      ...subject.models.map((model) => ({ file: join(dir, 'schema', `${model.type}.json`), content: json(model.schema), what: `${at} ${model.type} schema`, url: v.schema(model.type) })),
    ],
  };
}

/** Write the snapshot of the subject's current version (idempotent). `options`: { urls, languages }. */
export async function snapshotRelease(subject, options) {
  const { dir, entries } = releaseContents(subject, options);
  // Written only into real folders and files, also when called without loadSubjects (which refuses links).
  for (const d of [dirname(dir), dir, join(dir, 'schema')]) await plain(d, 'dir');
  await mkdir(join(dir, 'schema'), { recursive: true });
  for (const e of entries) await writeIfAbsentOrEqual(e.file, e.content, e.what);
  return dir;
}

/**
 * The snapshot of the current version, when it exists, must hold exactly what
 * the sources produce. `recorded`: whether this version's files are already in
 * the published-files manifest; a missing snapshot is only acceptable before
 * that. Returns a list of problems.
 */
export async function verifyRelease(subject, options, { recorded = false } = {}) {
  const { dir, entries } = releaseContents(subject, options);
  if (!(await isDir(dir))) return recorded ? [`${subject.name} v${subject.version}: recorded in the manifest but its snapshot ${dir} is missing`] : [];
  const problems = [];
  for (const e of entries) {
    let existing;
    try { existing = await readFile(e.file, 'utf8'); } catch (err) { if (err.code !== 'ENOENT') throw err; problems.push(`${e.what}: missing from ${dir}`); continue; }
    if (existing !== e.content) problems.push(`${e.what}: snapshot differs from the sources (${e.file})`);
  }
  const expected = new Set(entries.map((e) => e.file));
  const expectedDirs = new Set(entries.map((e) => dirname(e.file)).filter((d) => d !== dir).map((d) => basename(d)));
  for (const e of await readdir(dir, { withFileTypes: true })) {
    if (e.isDirectory() ? !expectedDirs.has(e.name) : !expected.has(join(dir, e.name))) problems.push(`${subject.name} v${subject.version}: snapshot has ${e.name}, which is not part of the snapshot`);
  }
  const schemaDir = join(dir, 'schema');
  if (await isDir(schemaDir)) for (const f of await readdir(schemaDir)) if (!expected.has(join(schemaDir, f))) problems.push(`${subject.name} v${subject.version}: snapshot has ${f}, which is not a model of the subject`);
  return problems;
}

async function writeIfAbsentOrEqual(file, content, what) {
  await plain(file, 'file');
  try {
    const existing = await readFile(file, 'utf8');
    if (existing !== content) throw new Error(`${what}: release snapshot ${file} differs from the current source. A published version never changes; bump the version instead.`);
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;
    await writeNoFollow(file, content, { create: true });
  }
}

/** All snapshots of a subject: [{ version, dir, files: [{ url, path }] }]. */
export async function listReleases(subject, { urls }) {
  const base = join(subject.dir, 'releases');
  if (!(await plain(base, 'dir'))) return [];
  const out = [];
  const bySemver = (a, b) => { const pa = a.slice(1).split('.').map(Number), pb = b.slice(1).split('.').map(Number); return pa[0] - pb[0] || pa[1] - pb[1] || pa[2] - pb[2]; };
  const names = (await readdir(base)).filter((n) => /^v\d+\.\d+\.\d+$/.test(n)).sort(bySemver);
  for (const name of names) {
    const version = name.slice(1);
    const dir = join(base, name);
    if (!(await plain(dir, 'dir'))) continue;
    const v = urls.versionUrls(subject.name, version);
    const files = [{ url: v.context, path: join(dir, 'context.jsonld') }];
    // A version is removed as a whole (its folder), never one file of it; an older snapshot may lack vocab.jsonld.
    if (!(await plain(files[0].path, 'file'))) throw new Error(`${subject.name} v${version}: ${files[0].path} is missing. A release folder needs its context.jsonld: restore it, or remove the whole folder ${dir} to remove the version (during the pre-release only)`);
    if (await plain(join(dir, 'vocab.jsonld'), 'file')) files.push({ url: v.vocab, path: join(dir, 'vocab.jsonld') });
    const schemaDir = join(dir, 'schema');
    if (await plain(schemaDir, 'dir')) {
      for (const f of (await readdir(schemaDir)).sort()) {
        await plain(join(schemaDir, f), 'file');
        files.push({ url: v.schema(f.replace(/\.json$/, '')), path: join(schemaDir, f) });
      }
    }
    out.push({ version, dir, files });
  }
  return out;
}
