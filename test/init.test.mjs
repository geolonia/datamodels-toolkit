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
import { PassThrough, Writable } from 'node:stream';
import { initSettings, writeNode, publishToGitHub, askInit, answerProblem, answerValue } from '../src/init.mjs';

const run = promisify(execFile);
const BIN = join(import.meta.dirname, '..', 'bin', 'datamodels.mjs');
const datamodels = (...args) => run(process.execPath, [BIN, ...args]).then((r) => ({ code: 0, ...r }), (e) => ({ code: e.code, stdout: e.stdout, stderr: e.stderr }));
const OPTIONS = ['--base-url', 'https://models.example.org/', '--publisher', 'Example', '--publisher-url', 'https://example.org/', '--subject', 'road', '--languages', 'ja,en', '--yes'];

test('init writes a node that passes check and builds', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'datamodels-init-'));
  const r = await datamodels('init', dir, ...OPTIONS);
  assert.equal(r.code, 0, r.stderr);
  for (const f of ['node.yaml', 'models/road/subject.yaml', 'models/road/context.jsonld', '.github/workflows/publish.yml', '.github/dependabot.yml', 'README.md', 'LICENSE', '.gitignore']) assert.match(r.stderr, new RegExp(`added ${f.replace(/\./g, '\\.')}\\n`), f);
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
  // Pinned to a release: a commit SHA with the tag as a comment, as Dependabot expects.
  // The release this version of the toolkit writes: change both lines together with src/init.mjs.
  assert.ok(workflow.includes('uses: geolonia/datamodels-toolkit@bea3f9317d19043bac3ddbfd29702c8ac4f0287a # v0.3.8\n'));
  assert.match(workflow, /pages: write\n {6}id-token: write/);
  // The commands in the README run the same release as the workflow.
  const readme = await readFile(join(dir, 'README.md'), 'utf8');
  assert.ok(readme.includes('npx github:geolonia/datamodels-toolkit#v0.3.8 check\n'));
  assert.doesNotMatch(readme, /datamodels-toolkit (check|build)/);
  // The licence: its legal code as LICENSE, named in the README.
  assert.ok((await readFile(join(dir, 'LICENSE'), 'utf8')).startsWith('Creative Commons Legal Code\n\nCC0 1.0 Universal\n'));
  assert.match(readme, /Licence: \[CC0-1\.0\]\(LICENSE\)\./);
  assert.doesNotMatch(r.stderr, /no LICENSE/);
  // Dependabot proposes new releases of the pinned Actions.
  assert.match(await readFile(join(dir, '.github', 'dependabot.yml'), 'utf8'), /package-ecosystem: github-actions\n/);
});

test('init writes the licence it has a text for, and says when it has none', async () => {
  const by = await mkdtemp(join(tmpdir(), 'datamodels-init-'));
  let r = await datamodels('init', by, ...OPTIONS, '--license', 'CC-BY-4.0');
  assert.equal(r.code, 0, r.stderr);
  assert.ok((await readFile(join(by, 'LICENSE'), 'utf8')).startsWith('Attribution 4.0 International\n'));
  const other = await mkdtemp(join(tmpdir(), 'datamodels-init-'));
  r = await datamodels('init', other, ...OPTIONS, '--license', 'ODbL-1.0');
  assert.equal(r.code, 0, r.stderr);
  assert.doesNotMatch(r.stderr, /added LICENSE/);
  assert.match(r.stderr, /no LICENSE: init has no text of ODbL-1\.0/);
  assert.deepEqual((await readdir(other)).filter((f) => f.startsWith('LICENSE')), []);
  assert.match(await readFile(join(other, 'README.md'), 'utf8'), /Licence: ODbL-1\.0\./);
});

test('init in an existing repository adds what is missing and keeps every file', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'datamodels-init-'));
  await mkdir(join(dir, '.github', 'workflows'), { recursive: true });
  await writeFile(join(dir, 'README.md'), '# models\n\nMade by the scaffolder.\n');
  await writeFile(join(dir, 'catalog-info.yaml'), 'kind: Component\n');
  await writeFile(join(dir, '.gitignore'), '.DS_Store\nnode_modules\n');
  await writeFile(join(dir, 'LICENSE.md'), 'Our licence.\n');
  let r = await datamodels('init', dir, ...OPTIONS);
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stderr, /kept README\.md \(it exists\)/);
  // A licence file under another name is kept, and no LICENSE is added.
  assert.match(r.stderr, /kept LICENSE\.md \(it exists\)/);
  assert.doesNotMatch(r.stderr, /added LICENSE|no LICENSE/);
  // Without a README, the new one links to the licence file that is kept.
  const bare = await mkdtemp(join(tmpdir(), 'datamodels-init-'));
  await writeFile(join(bare, 'LICENSE.md'), 'Our licence.\n');
  assert.equal((await datamodels('init', bare, ...OPTIONS)).code, 0);
  assert.match(await readFile(join(bare, 'README.md'), 'utf8'), /Licence: \[CC0-1\.0\]\(LICENSE\.md\)\./);
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

test('each init answer is checked by the rules of the final check', () => {
  const ok = {
    baseUrl: ['https://models.example.org', 'http://models.example.org/', ' https://example.github.io/models '],
    languages: ['', '  ', 'en', 'ja,en', ' ja , en ', 'pt-BR'],
    publisherName: ['Example Inc.'],
    publisherUrl: ['https://example.org/'],
    license: ['', 'CC0-1.0', 'CC-BY-4.0', 'ODbL-1.0'],
    subject: ['road', 'road-2'],
    github: ['example/models'],
  };
  const wrong = {
    baseUrl: ['', 'models.example.org', 'ftp://models.example.org', 'https://models.example.org/?a=1', 'https://models.example.org/#x', 'https://user:pw@models.example.org'],
    // enja,en: what the old prompt gave when ja,en was typed after the pre-typed en.
    languages: ['enja,en', 'ja en', ',,', 'EN', 'japanese'],
    publisherName: ['', '   '],
    publisherUrl: ['', 'example.org'],
    subject: ['', 'Road', 'road/x'],
    github: ['', 'models', 'example/models/x'],
  };
  for (const [key, values] of Object.entries(ok)) for (const v of values) assert.equal(answerProblem(key, v), undefined, `${key}: ${JSON.stringify(v)}`);
  for (const [key, values] of Object.entries(wrong)) for (const v of values) assert.equal(typeof answerProblem(key, v), 'string', `${key}: ${JSON.stringify(v)}`);
  // An empty answer is the default; the rest is trimmed.
  assert.deepEqual(answerValue('languages', ''), ['en']);
  assert.deepEqual(answerValue('languages', ' ja , en '), ['ja', 'en']);
  assert.equal(answerValue('license', ''), 'CC0-1.0');
  assert.equal(answerValue('license', ' ODbL-1.0 '), 'ODbL-1.0');
  assert.equal(answerValue('baseUrl', ' https://models.example.org '), 'https://models.example.org');
  // Every answer the questions accept passes the final check.
  for (const [key, values] of Object.entries(ok)) for (const v of values) {
    const answers = { baseUrl: 'https://models.example.org', languages: ['en'], publisherName: 'Example', publisherUrl: 'https://example.org/', subject: 'road', [key]: answerValue(key, v) };
    assert.deepEqual(initSettings(answers).problems, [], `${key}: ${JSON.stringify(v)}`);
  }
});

/**
 * Answers the questions of init as a user at a terminal would: each step waits
 * for its text on the screen, then types its keys. Returns the answers and the screen.
 */
async function answerInit(steps, given = {}) {
  const input = new PassThrough();
  let screen = '', seen = 0;
  const output = new Writable({ write(chunk, _, done) { screen += chunk; done(); } });
  const result = askInit(given, { input, output });
  result.catch(() => {});
  for (const [text, keys] of steps) {
    const until = Date.now() + 5000;
    while (!screen.slice(seen).includes(text)) {
      if (Date.now() > until) throw new Error(`no ${JSON.stringify(text)} on the screen:\n${screen.slice(seen)}`);
      await new Promise((r) => setTimeout(r, 2));
    }
    seen = screen.length;
    input.write(keys);
  }
  return { answers: await result, screen };
}

const ENTER = '\r', CLEAR = '\x15';

test('init questions: what is typed replaces the default, Enter alone keeps it', async () => {
  let { answers } = await answerInit([
    ['Base URL', `https://models.example.org/${ENTER}`],
    ['IRI form', ENTER],
    ['Languages', `ja,en${ENTER}`],
    ['Publisher (who', `Example${ENTER}`],
    ["Publisher's web site", `https://example.org/${ENTER}`],
    ['Licence', ENTER],
    ['First subject', `road${ENTER}`],
    ['Create a public GitHub', ENTER],
  ]);
  assert.deepEqual(answers, { baseUrl: 'https://models.example.org/', iris: 'hash', languages: ['ja', 'en'], publisherName: 'Example', publisherUrl: 'https://example.org/', license: 'CC0-1.0', subject: 'road' });
  // Answers given as options are not asked again.
  ({ answers } = await answerInit([['Languages', ENTER], ['Licence', `CC-BY-4.0${ENTER}`]], { baseUrl: 'https://models.example.org', iris: 'slash', publisherName: 'Example', publisherUrl: 'https://example.org/', subject: 'road', github: 'example/models' }));
  assert.deepEqual([answers.languages, answers.license, answers.iris], [['en'], 'CC-BY-4.0', 'slash']);
});

test('init questions: a wrong answer is refused at once and can be typed again', async () => {
  const { answers, screen } = await answerInit([
    ['Base URL', `models.example.org${ENTER}`],
    ['An http(s) URL without a query', `${CLEAR}https://models.example.org${ENTER}`],
    ['IRI form', ENTER],
    ['Languages', `ja en${ENTER}`],
    ['Language tags separated by commas', `${CLEAR}ja,en${ENTER}`],
    ['Publisher (who', ENTER],
    ['A name, for example', `Example${ENTER}`],
    ["Publisher's web site", `https://example.org/${ENTER}`],
    ['Licence', ENTER],
    ['First subject', `Road${ENTER}`],
    ['Lower case letters', `${CLEAR}road${ENTER}`],
    ['Create a public GitHub', `y${ENTER}`],
    ['Repository (owner/name)', `models${ENTER}`],
    ['owner/name, for example', `${CLEAR}example/models${ENTER}`],
  ]);
  assert.deepEqual(answers, { baseUrl: 'https://models.example.org', iris: 'hash', languages: ['ja', 'en'], publisherName: 'Example', publisherUrl: 'https://example.org/', license: 'CC0-1.0', subject: 'road', github: 'example/models' });
  assert.match(screen, /Writing the files\./);
});

test('init questions: cancelling returns no answers', async () => {
  const { answers, screen } = await answerInit([['Base URL', '\x03']]);
  assert.equal(answers, null);
  assert.match(screen, /Nothing written\./);
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

async function newNode() {
  const dir = await mkdtemp(join(tmpdir(), 'datamodels-init-'));
  const { added } = await writeNode(dir, initSettings({ baseUrl: 'https://example.github.io/models', publisherName: 'Example', publisherUrl: 'https://example.org/', subject: 'road' }));
  return { dir, files: added };
}

test('--github in a new folder: commits only the files of init, creates the repository, turns on Pages', async () => {
  const { dir, files } = await newNode();
  const f = fakeRun({ answers: { 'git diff --cached --name-only': 'node.yaml\n' } });
  await publishToGitHub(dir, 'example/models', { ...f, files });
  assert.deepEqual(f.calls, [
    'gh auth status', 'git init -b main', `git add -- ${files.join(' ')}`, 'git diff --cached --name-only',
    'git commit -m Start a data model node (datamodels init)',
    `gh repo create example/models --public --source ${dir} --remote origin --push`,
    'gh api -X POST repos/example/models/pages -f build_type=workflow',
  ]);
  // Another file in the folder would be published too: stop before git init.
  await writeFile(join(dir, '.env'), 'X=1\n');
  const g = fakeRun();
  await assert.rejects(publishToGitHub(dir, 'example/models', { ...g, files }), /other files that would be published with the node: \.env/);
  assert.deepEqual(g.calls, ['gh auth status']);
});

test('--github in a repository without a remote: only on main, and only with no other changes', async () => {
  const { dir, files } = await newNode();
  await mkdir(join(dir, '.git'));
  const status = `?? node.yaml\0?? notes.txt\0`;
  let f = fakeRun({ answers: { 'git branch --show-current': 'master\n' } });
  await assert.rejects(publishToGitHub(dir, 'example/models', { ...f, files }), /publishes the branch main, but this repository is on master/);
  f = fakeRun({ answers: { 'git branch --show-current': 'main\n', 'git status --porcelain=v1 -z --untracked-files=all': status } });
  await assert.rejects(publishToGitHub(dir, 'example/models', { ...f, files }), /other changes in the folder would be published with the node: notes\.txt/);
  assert.ok(!f.calls.some((c) => c.startsWith('git add') || c.startsWith('gh repo create')), 'nothing staged or created');
  f = fakeRun({ answers: { 'git branch --show-current': 'main\n', 'git status --porcelain=v1 -z --untracked-files=all': `?? node.yaml\0` } });
  await publishToGitHub(dir, 'example/models', { ...f, files });
  assert.ok(f.calls.includes(`gh repo create example/models --public --source ${dir} --remote origin --push`));
});

test('--github with a remote: only the repository the remote points to, Pages switched to Actions', async () => {
  const { dir, files } = await newNode();
  await mkdir(join(dir, '.git'));
  // A repository made elsewhere (Backstage, by hand).
  let f = fakeRun({ answers: { 'git remote': 'origin\n', 'git remote get-url origin': 'git@github.com:example/models.git\n' }, fail: ['gh api -X POST'] });
  const steps = await publishToGitHub(dir, 'example/models', { ...f, files });
  assert.deepEqual(f.calls, ['gh auth status', 'git remote', 'git remote get-url origin', 'gh api -X POST repos/example/models/pages -f build_type=workflow', 'gh api -X PUT repos/example/models/pages -f build_type=workflow']);
  assert.match(steps[0], /kept the remote \(github\.com\/example\/models\)/);
  // A remote that is another repository: Pages would go to the wrong one.
  f = fakeRun({ answers: { 'git remote': 'origin\n', 'git remote get-url origin': 'https://github.com/example/other.git\n' } });
  await assert.rejects(publishToGitHub(dir, 'example/models', { ...f, files }), /remote \(https:\/\/github\.com\/example\/other\.git\) is not github\.com\/example\/models/);
  assert.ok(!f.calls.some((c) => c.startsWith('gh api')), 'Pages untouched');

  await assert.rejects(publishToGitHub(dir, 'models', fakeRun()), /--github needs owner\/name/);
  await assert.rejects(publishToGitHub(dir, 'example/models', fakeRun({ fail: ['gh auth status'] })), /gh auth status failed/);
});

test('a wrong --github stops init before it writes anything', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'datamodels-init-'));
  const r = await datamodels('init', dir, ...OPTIONS, '--github', 'models');
  assert.equal(r.code, 1);
  assert.match(r.stderr, /init: nothing written:\n {2}--github needs owner\/name, got "models"/);
  assert.deepEqual(await readdir(dir), []);
});
