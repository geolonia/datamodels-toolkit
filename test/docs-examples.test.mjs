// The command examples of the toolkit pages on datamodels.jp (site/toolkit/ in
// geolonia/datamodels), run in the order a reader follows them, against golden
// files: what each command prints, its exit code and the files it writes.
// A change in any of them fails here, so the pages get updated with the code.
// The test does not read the pages: a page that changes its example changes
// nothing here, so update the example below with it.
//
// Offline and in this order: each example works on the files the ones before
// it wrote, so a failure early on makes the later ones fail too.
// - convert and mapping read test/fixtures/site/ (--site is added); the inputs
//   are test/fixtures/docs/.
// - check, bump and release run with --offline (the pages show them without).
// - Not covered: search, nodes and export of a catalog model (they read https
//   only), extend, upgrade, check --base, and build --out.
// Paths are compared with '/', as on Linux and macOS; Windows is not supported.
//
// After an intended change, rewrite the golden files and review their diff:
//   npm run golden
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, readdir, readFile, writeFile, cp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);
const ROOT = join(import.meta.dirname, '..');
const BIN = join(ROOT, 'bin', 'datamodels.mjs');
const SITE_DIR = join(import.meta.dirname, 'fixtures', 'site');
const INPUTS = join(import.meta.dirname, 'fixtures', 'docs');
const GOLDEN = join(import.meta.dirname, 'golden', 'docs');
const UPDATE = process.env.UPDATE_GOLDEN === '1';
const { version } = JSON.parse(await readFile(join(ROOT, 'package.json'), 'utf8'));
// init pins the Action release before this one (a release cannot pin its own tag), in its
// workflow and its README's npx commands, so that version is normalized too.
const { ACTION_VERSION, ACTION_REF } = await import(join(ROOT, 'src', 'init.mjs'));

test('init pins a released Action: a version tag no newer than this package, at a full commit SHA', () => {
  const m = /^v(\d+)\.(\d+)\.(\d+)$/.exec(ACTION_VERSION);
  assert.ok(m, ACTION_VERSION);
  const [pa, pb, pc] = version.split('.').map(Number);
  const [a, b, c] = m.slice(1).map(Number);
  assert.ok(a < pa || (a === pa && (b < pb || (b === pb && c <= pc))), `${ACTION_VERSION} is newer than ${version}`);
  assert.match(ACTION_REF, /^[0-9a-f]{40}$/);
});
const PAGES = 'https://datamodels.jp/en/toolkit';
// Commands that read the catalog get the fixtures copy of the site.
const READS_SITE = new Set(['convert', 'mapping']);
// Longer files are recorded by a hash of their contents; the built site's files by path only.
// (The draft of mapping is shown; init's LICENSE, the CC0 text, is not.)
const SHOW_MAX = 6500;

// Where the examples run: the inputs, then the node that init makes.
const work = await realpath(await mkdtemp(join(tmpdir(), 'datamodels-docs-')));
after(() => rm(work, { recursive: true, force: true }));
await cp(INPUTS, work, { recursive: true });
// The commands see no settings of whoever runs the tests (NODE_OPTIONS, colours, git or npm config).
const HOME = join(work, '.home');
await mkdir(HOME);
const ENV = { PATH: process.env.PATH, HOME, NO_COLOR: '1', NODE_NO_WARNINGS: '1', LANG: 'C.UTF-8', TZ: 'UTC' };
let cwd = work;

/** Every file under the work folder but HOME, relative path → contents. */
async function files() {
  const out = new Map();
  for (const e of await readdir(work, { recursive: true, withFileTypes: true })) {
    const path = join(e.parentPath, e.name);
    if (e.isFile() && !path.startsWith(`${HOME}/`)) out.set(relative(work, path), await readFile(path));
  }
  return out;
}

/**
 * Output that does not depend on the machine or the release: the temporary paths,
 * pinned SHAs, the Action release init pins, and the toolkit's version in npx
 * commands (not other version numbers).
 */
const stable = (text) => text
  .replaceAll(work, '<work>')
  .replaceAll(SITE_DIR, '<site>')
  .replace(/\b[0-9a-f]{40}\b/g, '<sha>')
  .replaceAll(`datamodels-toolkit@<sha> # ${ACTION_VERSION}`, 'datamodels-toolkit@<sha> # v<version>')
  .replaceAll(`@geolonia/datamodels@${version}`, '@geolonia/datamodels@<version>')
  .replaceAll(`@geolonia/datamodels@${ACTION_VERSION.slice(1)}`, '@geolonia/datamodels@<version>');

const byCodePoint = ([a], [b]) => (a < b ? -1 : a > b ? 1 : 0);
/** The command as a POSIX shell reads it: an argument with spaces or other special characters in single quotes. */
const shell = (args) => args.map((a) => (/^[\w@%+=:,./-]+$/.test(a) ? a : `'${a.replaceAll("'", "'\\''")}'`)).join(' ');

/** The golden text of a command: the page, the command, its exit code, output and the files it added or changed. */
async function record(page, args, r, before) {
  const lines = [
    `# ${PAGES}/${page}`,
    `$ ${relative(work, cwd) ? `cd ${shell([relative(work, cwd)])} && ` : ''}datamodels ${shell(args)}`,
    `exit: ${r.code}`,
    '--- stdout', r.stdout.trimEnd(),
    '--- stderr', r.stderr.trimEnd(),
  ];
  for (const [path, body] of [...(await files())].sort(byCodePoint)) {
    const old = before.get(path);
    if (old?.equals(body)) continue;
    const head = `--- ${old ? 'changed' : 'added'} ${path}`;
    if (path.split('/').includes('_site')) lines.push(head);
    else if (body.length > SHOW_MAX) lines.push(`${head} (sha256 ${createHash('sha256').update(body).digest('hex').slice(0, 16)})`);
    else lines.push(head, body.toString('utf8').trimEnd());
  }
  return `${stable(lines.join('\n'))}\n`;
}

const written = new Set();
let n = 0;
/** One documented example: run it and compare with test/golden/docs/<nn>-<name>.txt. `exit` is the exit code it must have. */
function example(name, page, args, { before, exit = 0 } = {}) {
  const file = join(GOLDEN, `${String(++n).padStart(2, '0')}-${name}.txt`);
  written.add(file);
  test(`${page}: datamodels ${args.join(' ')}`, async () => {
    await before?.();
    const was = await files();
    const extra = READS_SITE.has(args[0]) ? ['--site', SITE_DIR] : [];
    const r = await run(process.execPath, [BIN, ...args, ...extra], { cwd, env: ENV })
      .then((x) => ({ code: 0, ...x }), (e) => ({ code: e.code, stdout: e.stdout ?? '', stderr: e.stderr ?? String(e) }));
    // Also when updating: an unexpected failure must not become the golden file.
    assert.equal(r.code, exit, `exit code of datamodels ${args.join(' ')}:\n${r.stderr}`);
    const actual = await record(page, args, r, was);
    if (UPDATE) {
      await mkdir(GOLDEN, { recursive: true });
      await writeFile(file, actual);
      return;
    }
    const expected = await readFile(file, 'utf8').catch(() => null);
    assert.ok(expected !== null, `${relative(ROOT, file)} is missing: run npm run golden`);
    assert.deepEqual(actual.split('\n'), expected.split('\n'), `the output differs from ${relative(ROOT, file)}: update the page, or run npm run golden and review the diff`);
  });
}

example('help', '', ['--help']);

// Start a node, add models, check and build it.
example('init', 'start', ['init', 'my-models', '--base-url', 'https://models.example.org', '--iris', 'hash', '--languages', 'ja,en',
  '--publisher', 'Example Inc.', '--publisher-url', 'https://example.org/', '--license', 'CC0-1.0', '--subject', 'road', '--yes']);
example('add', 'models', ['add', 'road/RoadPatrol'], { before: () => { cwd = join(work, 'my-models'); } });
example('add-value', 'models', ['add', 'road/Segment', '--value']);
example('check', 'check', ['check', '--offline']);
example('build', 'node', ['build']);
example('export-own', 'export', ['export', 'road/RoadPatrol', 'my-models', '--to', 'postgis'], { before: () => { cwd = work; } });
example('bump', 'versions', ['bump', 'road', 'minor', '--offline'], { before: () => { cwd = join(work, 'my-models'); } });
example('release', 'versions', ['release', 'road', '--offline']);

// Convert lists. The municipal list has a row with a broken latitude: left out, and the exit code is 1.
example('convert-standard', 'convert', ['convert', 'disaster/EvacuationSite', 'jichitai-opendata-site', '092011_evacuation_space.csv', '--out', 'sites.json'],
  { before: () => { cwd = work; }, exit: 1 });
example('convert-set', 'convert', ['convert', 'disaster/EvacuationSite', 'gsi-emergency-site', '13101_2.csv', '--set', 'localGovernmentCode=131016']);
example('mapping', 'convert#your-own-list', ['mapping', 'disaster/EvacuationSite', 'my-list.csv', '--out', 'my-list.yaml']);
// Step 2 of the page, done by a person: the TODOs filled in.
example('convert-own-check', 'convert#your-own-list', ['convert', 'disaster/EvacuationSite', 'my-list.yaml', 'my-list.csv', '--check'],
  { before: () => cp(join(INPUTS, 'my-list.filled.yaml'), join(work, 'my-list.yaml')) });
example('convert-own', 'convert#your-own-list', ['convert', 'disaster/EvacuationSite', 'my-list.yaml', 'my-list.csv', '--out', 'entities.json']);
example('convert-template', 'convert', ['convert', 'disaster/EvacuationSite', 'csv-template', 'sites.csv', '--out', 'template-entities.json']);

// npm run golden: remove the golden files of examples that were renamed or removed.
if (UPDATE) {
  after(async () => {
    for (const f of await readdir(GOLDEN).catch(() => [])) {
      if (f.endsWith('.txt') && !written.has(join(GOLDEN, f))) await rm(join(GOLDEN, f));
    }
  });
}
