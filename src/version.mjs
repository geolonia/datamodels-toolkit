// Version updates of a node: `upgrade` moves the node to a release of
// this toolkit, `bump` gives a subject a new version and keeps the old one
// online.
import { readdir, readFile, writeFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { loadNode } from './build/node.mjs';
import { releaseSubject } from './release.mjs';

const REPO = 'geolonia/datamodels-toolkit';
const TAG = /^v\d+\.\d+\.\d+$/;
// The first release on npmjs.org. Older releases run only from GitHub.
const FIRST_NPM = [0, 3, 8];
// How a node's Markdown runs the toolkit: from npm (`npx @geolonia/datamodels@0.3.8`),
// or from GitHub as before (`npx github:geolonia/datamodels-toolkit#v0.3.8`); not
// the start of a longer version such as 0.3.8-rc.1.
const NPX = /(?:@geolonia\/datamodels@|github:geolonia\/datamodels-toolkit#v)\d+\.\d+\.\d+(?![\w.-]*\w)/g;
const exists = (p) => stat(p).then(() => true, () => false);

/**
 * Move the node in `dir` to a release of the toolkit (`to`, default the
 * latest): the Action in its workflows is pinned to the release's commit SHA
 * with the tag as a comment, and `npx` in its Markdown files at the top runs
 * that release: `npx @geolonia/datamodels@X.Y.Z`, also where the file ran it
 * from GitHub (`npx github:geolonia/datamodels-toolkit#vX.Y.Z`); a release
 * from before npm stays with the GitHub form. Returns { version, sha, changed }.
 */
export async function upgradeNode(dir, { to, fetch: fetchUrl = globalThis.fetch, timeout = 20000 } = {}) {
  if (to !== undefined && !TAG.test(to)) throw new Error(`--to needs a release tag such as v0.3.0, got ${JSON.stringify(to)}`);
  const get = async (path) => {
    const url = `https://api.github.com/repos/${REPO}/${path}`;
    let res;
    try { res = await fetchUrl(url, { headers: { accept: 'application/vnd.github+json' }, signal: AbortSignal.timeout(timeout) }); } catch (e) { throw new Error(`${url} could not be read (${e.cause?.code ?? e.message})`); }
    if (res.status === 404 || res.status === 422) throw new Error(`${to ?? 'the latest release'} is not a release of ${REPO}`);
    if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
    return res.json();
  };
  // A release, not only a tag or branch of that name: the latest, or the one named.
  const version = (await get(to ? `releases/tags/${to}` : 'releases/latest')).tag_name;
  if (!TAG.test(version ?? '')) throw new Error(`the release of ${REPO} has no vX.Y.Z tag (${JSON.stringify(version)})`);
  const { sha } = await get(`commits/${version}`);
  if (!/^[0-9a-f]{40}$/.test(sha ?? '')) throw new Error(`${version}: no commit SHA from GitHub`);

  const changed = [];
  const rewrite = async (rel, change) => {
    const file = join(dir, rel);
    const before = await readFile(file, 'utf8');
    const after = change(before);
    if (after !== before) { await writeFile(file, after); changed.push(rel); }
  };
  const workflows = join(dir, '.github', 'workflows');
  if (await exists(workflows)) {
    for (const f of (await readdir(workflows)).filter((f) => /\.ya?ml$/.test(f)).sort()) {
      await rewrite(join('.github', 'workflows', f), (t) => t.replace(/(uses:\s*geolonia\/datamodels-toolkit@)[^\s#]+(?:[ \t]*#[^\n]*)?/g, `$1${sha} # ${version}`));
    }
  }
  const npx = npxSpec(version);
  for (const f of (await readdir(dir)).filter((f) => f.endsWith('.md')).sort()) {
    await rewrite(f, (t) => t.replace(NPX, npx));
  }
  return { version, sha, changed };
}

/** What `npx` runs for the release `version` (vX.Y.Z): the npm package, or GitHub before the first npm release. */
export function npxSpec(version) {
  const parts = version.slice(1).split('.').map(Number);
  const i = parts.findIndex((n, k) => n !== FIRST_NPM[k]);
  const onNpm = i === -1 || parts[i] > FIRST_NPM[i];
  return onNpm ? `@geolonia/datamodels@${version.slice(1)}` : `github:${REPO}#${version}`;
}

const LEVELS = ['patch', 'minor', 'major'];

/** The next version: `level` is patch, minor or major. */
export function nextVersion(version, level) {
  // BigInt: any number of digits stays exact (Number would round, or write 1e+21).
  const [major, minor, patch] = version.split('.').map(BigInt);
  if (level === 'major') return `${major + 1n}.0.0`;
  if (level === 'minor') return `${major}.${minor + 1n}.0`;
  return `${major}.${minor}.${patch + 1n}`;
}

/** A copy of `value` with every string $id and $ref that `rename` changes, changed; other keys untouched. */
function renameRefs(value, rename) {
  if (Array.isArray(value)) return value.map((v) => renameRefs(v, rename));
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, (k === '$id' || k === '$ref') && typeof v === 'string' ? rename(v) : renameRefs(v, rename)]));
}

/**
 * Give `subjectName` in the node in `dir` a new version: release the current
 * one first (datamodels release, so it stays online and is compared with the
 * published files), then raise `version` in subject.yaml and the version in
 * the subject's own schema URLs ($id, and $ref between its models).
 * Returns { subject, from, to, released, changed }.
 */
export async function bumpSubject(dir, subjectName, level, { offline = false, fetch, timeout } = {}) {
  if (!LEVELS.includes(level)) throw new Error(`the level is patch, minor or major; got ${JSON.stringify(level)}`);
  const { urls, subjects } = await loadNode(dir);
  const subject = subjects.find((s) => s.name === subjectName);
  if (!subject) throw new Error(`no subject ${subjectName} in ${join(dir, 'models')} (subjects: ${subjects.map((s) => s.name).join(', ') || 'none'})`);
  const from = subject.version;
  const to = nextVersion(from, level);
  // The new schemas first, so a schema that cannot be moved stops the bump before anything is written.
  const own = (type, version) => urls.modelUrls({ name: subjectName, version }, { type, schema: {} }).schemaExact;
  const schemas = [];
  for (const m of subject.models) {
    if (m.schema.$id !== undefined && m.schema.$id !== own(m.type, from)) throw new Error(`models/${subjectName}/${m.type}/schema.json: $id is ${m.schema.$id}, not ${own(m.type, from)}; correct it before bump`);
    // A schema URL of this subject at the old version, in $id or $ref (a fragment stays as it is).
    const rename = (url) => {
      const [base, fragment] = url.split(/(?=#)/);
      const hit = subject.models.find((x) => base === own(x.type, from));
      return hit ? `${own(hit.type, to)}${fragment ?? ''}` : url;
    };
    const next = renameRefs(m.schema, rename);
    if (JSON.stringify(next) !== JSON.stringify(m.schema)) schemas.push({ m, next });
  }
  // The version line too: one bump does all of it or nothing (a block scalar, say, is not changed by hand here).
  const yamlFile = join(subject.dir, 'subject.yaml');
  const yaml = await readFile(yamlFile, 'utf8');
  const line = new RegExp(`^(version:[ \\t]*)(["']?)${from.replaceAll('.', '\\.')}\\2([ \\t]*(?:#.*)?)$`, 'm');
  if (!line.test(yaml)) throw new Error(`${yamlFile}: no line "version: ${from}" to change; write it on one line before bump`);
  // The current version first: kept online, and refused if its sources changed after publishing.
  const released = await releaseSubject(dir, subjectName, { offline, ...(fetch ? { fetch } : {}), ...(timeout ? { timeout } : {}) });

  const changed = [];
  await writeFile(yamlFile, yaml.replace(line, `$1$2${to}$2$3`));
  changed.push(`models/${subjectName}/subject.yaml`);
  for (const { m, next } of schemas) {
    await writeFile(join(m.dir, 'schema.json'), `${JSON.stringify(next, null, 2)}\n`);
    changed.push(`models/${subjectName}/${m.type}/schema.json`);
  }
  return { subject: subjectName, from, to, released, changed };
}
