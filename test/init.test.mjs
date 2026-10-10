// datamodels init (#11): the files of a new node, into an empty folder or an
// existing repository, and the GitHub step with a stand-in for git and gh.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { checkNode } from '../src/build/index.mjs';
import { initSettings, writeNode, publishToGitHub } from '../src/init.mjs';

const run = promisify(execFile);
const BIN = join(import.meta.dirname, '..', 'bin', 'datamodels.mjs');
const datamodels = (...args) => run(process.execPath, [BIN, ...args]).then((r) => ({ code: 0, ...r }), (e) => ({ code: e.code, stdout: e.stdout, stderr: e.stderr }));
const OPTIONS = ['--base-url', 'https://models.example.org/', '--publisher', 'Example', '--publisher-url', 'https://example.org/', '--subject', 'road', '--languages', 'ja,en', '--yes'];

test('init writes a node that passes check and builds', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'datamodels-init-'));
  const r = await datamodels('init', dir, ...OPTIONS);
  assert.equal(r.code, 0, r.stderr);
  for (const f of ['node.yaml', 'models/road/subject.yaml', 'models/road/context.jsonld', '.github/workflows/publish.yml', 'README.md', '.gitignore']) assert.match(r.stderr, new RegExp(`added ${f.replace(/\./g, '\\.')}\\n`), f);
  // An empty subject is a valid node.
  assert.deepEqual((await checkNode(dir, { offline: true })).problems, []);
  const b = await datamodels('build', dir);
  assert.equal(b.code, 0, b.stderr);
  const catalog = JSON.parse(await readFile(join(dir, '_site', 'catalog.json'), 'utf8'));
  assert.deepEqual(catalog.publisher, { name: { ja: 'Example' }, url: 'https://example.org/' });
  assert.equal(JSON.parse(await readFile(join(dir, 'models', 'road', 'context.jsonld'), 'utf8'))['@context'].road, 'https://models.example.org/ns/road#');
  const subject = await readFile(join(dir, 'models', 'road', 'subject.yaml'), 'utf8');
  assert.match(subject, /title:\n {2}ja: road\n {2}en: road\n/);
  const workflow = await readFile(join(dir, '.github', 'workflows', 'publish.yml'), 'utf8');
  assert.match(workflow, /uses: actions\/checkout@[0-9a-f]{40} # v/);
  assert.match(workflow, /uses: geolonia\/datamodels-toolkit@/);
  assert.match(workflow, /pages: write\n {6}id-token: write/);
});

test('init in an existing repository adds what is missing and keeps every file', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'datamodels-init-'));
  await mkdir(join(dir, '.github', 'workflows'), { recursive: true });
  await writeFile(join(dir, 'README.md'), '# models\n\nMade by the scaffolder.\n');
  await writeFile(join(dir, 'catalog-info.yaml'), 'kind: Component\n');
  await writeFile(join(dir, '.gitignore'), '.DS_Store\nnode_modules\n');
  let r = await datamodels('init', dir, ...OPTIONS);
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stderr, /kept README\.md \(it exists\)/);
  assert.match(r.stderr, /added lines to \.gitignore/);
  assert.equal(await readFile(join(dir, 'README.md'), 'utf8'), '# models\n\nMade by the scaffolder.\n');
  assert.equal(await readFile(join(dir, 'catalog-info.yaml'), 'utf8'), 'kind: Component\n');
  // node_modules is already ignored (without the slash); only _site/ is added.
  assert.equal(await readFile(join(dir, '.gitignore'), 'utf8'), '.DS_Store\nnode_modules\n_site/\n');
  // A second run changes nothing.
  const before = await readdir(dir, { recursive: true });
  r = await datamodels('init', dir, ...OPTIONS);
  assert.equal(r.code, 0, r.stderr);
  assert.doesNotMatch(r.stderr, /added/);
  assert.deepEqual(await readdir(dir, { recursive: true }), before);
});

test('init writes nothing when an answer is wrong, and asks for missing ones only in a terminal', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'datamodels-init-'));
  let r = await datamodels('init', dir, '--base-url', 'models.example.org', '--publisher', 'Example', '--publisher-url', 'https://example.org/', '--subject', 'Road', '--yes');
  assert.equal(r.code, 1);
  assert.match(r.stderr, /init: nothing written:\n {2}baseUrl must be[^]*first subject needs a name/);
  assert.deepEqual(await readdir(dir), []);
  // Not a terminal (as in CI): no questions, a usage error that names what is missing.
  r = await datamodels('init', dir, '--publisher', 'Example');
  assert.equal(r.code, 2);
  assert.match(r.stderr, /^missing --base-url, --publisher-url, --subject\nusage: datamodels init /);
});

/** A stand-in for running git and gh: records each command, answers from `answers`, fails on `fail`. */
function fakeRun({ answers = {}, fail = [] } = {}) {
  const calls = [];
  const fn = async (cmd, args) => {
    const line = [cmd, ...args].join(' ');
    calls.push(line);
    if (fail.some((f) => line.startsWith(f))) throw new Error(`${line} failed`);
    return answers[line] ?? '';
  };
  return { calls, run: fn };
}

test('--github: a new folder becomes a repository with Pages; an existing remote is kept', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'datamodels-init-'));
  await writeNode(dir, initSettings({ baseUrl: 'https://example.github.io/models', publisherName: 'Example', publisherUrl: 'https://example.org/', subject: 'road' }));
  let f = fakeRun({ answers: { 'git diff --cached --name-only': 'node.yaml\n' } });
  await publishToGitHub(dir, 'example/models', f);
  assert.deepEqual(f.calls, [
    'gh auth status', 'git init -b main', 'git add -A', 'git diff --cached --name-only',
    'git commit -m Start a data model node (datamodels init)',
    `gh repo create example/models --public --source ${dir} --remote origin --push`,
    'gh api -X POST repos/example/models/pages -f build_type=workflow',
  ]);

  // A repository made elsewhere (Backstage, by hand): no new repository, Pages switched to Actions.
  await mkdir(join(dir, '.git'));
  f = fakeRun({ answers: { 'git remote': 'origin\n' }, fail: ['gh api -X POST'] });
  const steps = await publishToGitHub(dir, 'example/models', f);
  assert.deepEqual(f.calls, ['gh auth status', 'git remote', 'gh api -X POST repos/example/models/pages -f build_type=workflow', 'gh api -X PUT repos/example/models/pages -f build_type=workflow']);
  assert.match(steps[0], /kept the remote \(origin\)/);

  await assert.rejects(publishToGitHub(dir, 'models', fakeRun()), /--github needs owner\/name/);
  await assert.rejects(publishToGitHub(dir, 'example/models', fakeRun({ fail: ['gh auth status'] })), /gh auth status failed/);
});
