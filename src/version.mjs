// Version updates of a node: `upgrade` moves the node to a release of
// this toolkit, `bump` gives a subject a new version and keeps the old one
// online.
import { readdir, readFile, writeFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { loadNode } from './build/node.mjs';
import { releaseSubject } from './release.mjs';

const REPO = 'geolonia/datamodels-toolkit';
const TAG = /^v\d+\.\d+\.\d+$/;
const exists = (p) => stat(p).then(() => true, () => false);

/**
 * Move the node in `dir` to a release of the toolkit (`to`, default the
 * latest): the Action in its workflows is pinned to the release's commit SHA
 * with the tag as a comment, and `npx github:…#vX.Y.Z` in its Markdown files
 * at the top runs that release. Returns { version, sha, changed }.
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
  const version = to ?? (await get('releases/latest')).tag_name;
  if (!TAG.test(version ?? '')) throw new Error(`the latest release of ${REPO} has no vX.Y.Z tag (${JSON.stringify(version)})`);
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
  for (const f of (await readdir(dir)).filter((f) => f.endsWith('.md')).sort()) {
    await rewrite(f, (t) => t.replace(/(github:geolonia\/datamodels-toolkit)#v\d+\.\d+\.\d+/g, `$1#${version}`));
  }
  return { version, sha, changed };
}

const LEVELS = ['patch', 'minor', 'major'];

/** The next version: `level` is patch, minor or major. */
export function nextVersion(version, level) {
  const [major, minor, patch] = version.split('.').map(Number);
  if (level === 'major') return `${major + 1}.0.0`;
  if (level === 'minor') return `${major}.${minor + 1}.0`;
  return `${major}.${minor}.${patch + 1}`;
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
  // The current version first: kept online, and refused if its sources changed after publishing.
  const released = await releaseSubject(dir, subjectName, { offline, ...(fetch ? { fetch } : {}), ...(timeout ? { timeout } : {}) });

  const changed = [];
  const yamlFile = join(subject.dir, 'subject.yaml');
  const yaml = await readFile(yamlFile, 'utf8');
  const line = new RegExp(`^(version:[ \\t]*)(["']?)${from.replaceAll('.', '\\.')}\\2([ \\t]*(?:#.*)?)$`, 'm');
  if (!line.test(yaml)) throw new Error(`${yamlFile}: no line "version: ${from}" to change`);
  await writeFile(yamlFile, yaml.replace(line, `$1$2${to}$2$3`));
  changed.push(`models/${subjectName}/subject.yaml`);
  // Schema URLs of this subject at the old version: /schema/<subject>/<Type>/v<from>.json.
  const old = new RegExp(`(${urls.baseUrl.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}/schema/${subjectName}/[^/"]+/v)${from.replaceAll('.', '\\.')}(\\.json)`, 'g');
  for (const m of subject.models) {
    const file = join(m.dir, 'schema.json');
    const text = await readFile(file, 'utf8');
    const next = text.replace(old, `$1${to}$2`);
    if (next !== text) { await writeFile(file, next); changed.push(`models/${subjectName}/${m.type}/schema.json`); }
  }
  return { subject: subjectName, from, to, released, changed };
}
