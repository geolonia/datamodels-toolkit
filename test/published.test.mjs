// A published version never changes (src/build/published.mjs, geolonia/datamodels#226):
// the release snapshots against a git ref, the pre-release flag, check --all-released,
// and the comparison with the site during the pre-release.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, readFile, rm, cp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { checkNode, buildNode } from '../src/build/index.mjs';
import { bumpSubject } from '../src/version.mjs';
import { releaseSubject } from '../src/release.mjs';

const run = promisify(execFile);
const BIN = join(import.meta.dirname, '..', 'bin', 'datamodels.mjs');
const datamodels = (...args) => run(process.execPath, [BIN, ...args]).then((r) => ({ code: 0, ...r }), (e) => ({ code: e.code, stdout: e.stdout, stderr: e.stderr }));
const BASE = 'https://models.example.org';
const OLD = 'models/road/releases/v0.1.0/context.jsonld';
// The test repositories do not use the git settings of whoever runs the tests (signing, hooks).
const GIT_ENV = { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1', GIT_AUTHOR_NAME: 'Test', GIT_AUTHOR_EMAIL: 'test@example.org', GIT_COMMITTER_NAME: 'Test', GIT_COMMITTER_EMAIL: 'test@example.org' };
const git = (dir, ...args) => run('git', ['-C', dir, ...args], { env: GIT_ENV });

/** A node whose subject road is at 0.2.0, with the snapshot of 0.1.0; `settings` go into node.yaml. */
async function node(settings = '') {
  const dir = await mkdtemp(join(tmpdir(), 'datamodels-published-'));
  await writeFile(join(dir, 'node.yaml'), `baseUrl: ${BASE}\npublisher: { name: { en: Example }, url: https://example.org/ }\nlicense: CC0-1.0\n${settings}`);
  const m = join(dir, 'models', 'road', 'RoadPatrol');
  await mkdir(join(m, 'examples'), { recursive: true });
  await writeFile(join(dir, 'models', 'road', 'subject.yaml'), 'name: road\nversion: 0.1.0\nsource: minted\ntitle: { en: Roads }\ndescription: { en: Roads. }\n');
  await writeFile(join(dir, 'models', 'road', 'context.jsonld'), JSON.stringify({ '@context': { road: `${BASE}/ns/road#`, RoadPatrol: 'road:RoadPatrol', route: 'road:route' } }));
  await writeFile(join(m, 'schema.json'), JSON.stringify({ $id: `${BASE}/schema/road/RoadPatrol/v0.1.0.json`, type: 'object', properties: { id: { type: 'string' }, type: { const: 'RoadPatrol' }, route: { type: 'string', 'x-iri': `${BASE}/ns/road#route` } } }));
  await writeFile(join(m, 'catalog.yaml'), 'title: { en: Road patrol }\ndescription: { en: A run. }\nattributes:\n  route: { en: The route }\n');
  await bumpSubject(dir, 'road', 'minor', { offline: true });
  return dir;
}

/** Commit everything on main, as the base branch of a pull request. */
async function commit(dir) {
  await git(dir, 'init', '-q', '-b', 'main');
  await git(dir, 'add', '-A');
  await git(dir, 'commit', '-q', '-m', 'base');
}
const setNode = async (dir, from, to) => writeFile(join(dir, 'node.yaml'), (await readFile(join(dir, 'node.yaml'), 'utf8')).replace(from, to));

test('--base: a release snapshot that changed or is gone since the base branch is a problem; a new one is not', async () => {
  const dir = await node();
  await commit(dir);
  assert.deepEqual(await checkNode(dir, { offline: true, base: 'main' }), { problems: [], notes: ['offline: the published files and the models this node extends were not checked'] });
  await writeFile(join(dir, OLD), '{}\n');
  await rm(join(dir, 'models', 'road', 'releases', 'v0.1.0', 'vocab.jsonld'));
  // A new release (0.2.0) is an addition.
  await bumpSubject(dir, 'road', 'patch', { offline: true });
  const { problems } = await checkNode(dir, { offline: true, base: 'main' });
  assert.deepEqual(problems, [
    `${OLD}: changed since main. A published version never changes and stays online; give the subject a new version instead`,
    'models/road/releases/v0.1.0/vocab.jsonld: removed since main. A published version never changes and stays online; give the subject a new version instead',
  ]);
});

test('--base in a node in a folder of the repository, and a base that cannot be read', async () => {
  const dir = await node();
  await commit(dir);
  const repo = await mkdtemp(join(tmpdir(), 'datamodels-repo-'));
  await cp(dir, join(repo, 'node'), { recursive: true });
  await rm(join(repo, 'node', '.git'), { recursive: true, force: true });
  await commit(repo);
  await writeFile(join(repo, 'node', OLD), '{}\n');
  assert.deepEqual((await checkNode(join(repo, 'node'), { offline: true, base: 'main' })).problems, [`${OLD}: changed since main. A published version never changes and stays online; give the subject a new version instead`]);
  assert.deepEqual((await checkNode(join(repo, 'node'), { offline: true, base: 'origin/main' })).problems, [`--base origin/main: not a commit in ${join(repo, 'node')}. Fetch it first, for example: git fetch origin main`]);
  const plain = await node();
  assert.deepEqual((await checkNode(plain, { offline: true, base: 'main' })).problems, [`--base main: ${plain} is not in a git checkout`]);
});

test('pre-release: corrections in place are notes while the base branch and the change both say so', async () => {
  const dir = await node('prerelease: true\n');
  await commit(dir);
  await writeFile(join(dir, OLD), '{}\n');
  const r = await checkNode(dir, { offline: true, base: 'main' });
  assert.deepEqual(r.problems, []);
  assert.ok(r.notes.includes(`${OLD}: changed since main, corrected in place during the pre-release (prerelease: true in node.yaml)`), r.notes.join('\n'));
  // The launch: false in the change, so the correction is a problem.
  await setNode(dir, 'prerelease: true', 'prerelease: false');
  assert.match((await checkNode(dir, { offline: true, base: 'main' })).problems[0], /changed since main\. A published version never changes/);
});

test('pre-release: a whole version may be removed (a note); a release folder without its context.jsonld stops the build', async () => {
  const dir = await node('prerelease: true\n');
  await commit(dir);
  const v010 = join(dir, 'models', 'road', 'releases', 'v0.1.0');
  await rm(join(v010, 'context.jsonld'));
  assert.deepEqual((await checkNode(dir, { offline: true, base: 'main' })).problems, [
    `road v0.1.0: ${join(v010, 'context.jsonld')} is missing. A release folder needs its context.jsonld: restore it, or remove the whole folder ${v010} to remove the version (during the pre-release only)`,
  ]);
  await rm(v010, { recursive: true });
  const r = await checkNode(dir, { offline: true, base: 'main' });
  assert.deepEqual(r.problems, []);
  assert.ok(r.notes.includes(`${OLD}: removed since main, corrected in place during the pre-release (prerelease: true in node.yaml)`), r.notes.join('\n'));
});

test('pre-release: the flag cannot be removed, nor turned back on, once the base branch has it', async () => {
  const launched = await node('prerelease: false\n');
  await commit(launched);
  await setNode(launched, 'prerelease: false', 'prerelease: true');
  await writeFile(join(launched, OLD), '{}\n');
  assert.deepEqual((await checkNode(launched, { offline: true, base: 'main' })).problems, [
    'node.yaml: sets "prerelease" back to true; main is launched, and published versions cannot become correctable again',
    `${OLD}: changed since main. A published version never changes and stays online; give the subject a new version instead`,
  ]);
  await setNode(launched, 'prerelease: true\n', '');
  assert.deepEqual((await checkNode(launched, { offline: true, base: 'main' })).problems[0], 'node.yaml: removes "prerelease"; main has it, so it stays (false after the launch)');
  // A base without the flag: it may be added, and counts from the next change on.
  const fresh = await node();
  await commit(fresh);
  await setNode(fresh, 'license: CC0-1.0\n', 'license: CC0-1.0\nprerelease: true\n');
  await writeFile(join(fresh, OLD), '{}\n');
  assert.deepEqual((await checkNode(fresh, { offline: true, base: 'main' })).problems, [`${OLD}: changed since main. A published version never changes and stays online; give the subject a new version instead`]);
  await setNode(fresh, 'prerelease: true', 'prerelease: yes please');
  assert.match((await checkNode(fresh, { offline: true })).problems[0], /prerelease must be true or false/);
});

test('--all-released: the current version of every subject needs its snapshot', async () => {
  const dir = await node();
  assert.deepEqual((await checkNode(dir, { offline: true, allReleased: true })).problems, ['road v0.2.0 has no release snapshot: run datamodels release road (check --all-released)']);
  await releaseSubject(dir, 'road', { offline: true });
  assert.deepEqual((await checkNode(dir, { offline: true, allReleased: true })).problems, []);
});

test('online: a released current version is compared once, and during the pre-release a change is a note with --base', async () => {
  const dir = await node();
  await releaseSubject(dir, 'road', { offline: true });
  const site = await mkdtemp(join(tmpdir(), 'datamodels-site-'));
  const { exactPaths } = await buildNode(dir, { out: site, pages: false });
  const online = Object.fromEntries(await Promise.all([...new Set(exactPaths)].map(async (p) => [`${BASE}${p}`, await readFile(join(site, p.slice(1)))])));
  online[`${BASE}/context/road/v0.2.0.jsonld`] = '{}';
  const fetch = async (url) => (url in online ? new Response(online[url]) : new Response('', { status: 404 }));
  const changed = `${BASE}/context/road/v0.2.0.jsonld: a published version changed. A published file never changes; give the subject a new version instead.`;
  assert.deepEqual(await checkNode(dir, { fetch }), { problems: [changed], notes: [] });
  // The flag alone, without --base, does not allow a correction: it may have just been added.
  await setNode(dir, 'license: CC0-1.0\n', 'license: CC0-1.0\nprerelease: true\n');
  assert.deepEqual(await checkNode(dir, { fetch }), { problems: [changed], notes: ['prerelease: true in node.yaml allows corrections in place only with --base, which checks that the base branch has the flag too'] });
  // With the flag in the base branch and in the change, the correction is a note.
  await commit(dir);
  const r = await checkNode(dir, { fetch, base: 'main' });
  assert.deepEqual(r, { problems: [], notes: [`${BASE}/context/road/v0.2.0.jsonld: differs from the published file, corrected in place during the pre-release (prerelease: true in node.yaml)`] });
});

test('datamodels check --base and --all-released on the command line', async () => {
  const dir = await node();
  await commit(dir);
  await writeFile(join(dir, OLD), '{}\n');
  let r = await datamodels('check', dir, '--offline', '--base', 'main');
  assert.equal(r.code, 1);
  assert.match(r.stderr, /changed since main/);
  r = await datamodels('check', dir, '--offline', '--all-released');
  assert.equal(r.code, 1);
  assert.match(r.stderr, /road v0\.2\.0 has no release snapshot/);
  r = await datamodels('check', dir, '--base');
  assert.equal(r.code, 2);
  assert.match(r.stderr, /^--base needs a value\nusage: datamodels check/);
});
