// The command examples of the toolkit pages on datamodels.jp (site/toolkit/ in
// geolonia/datamodels), run in the order a reader follows them, against golden
// files: what each command prints, its exit code and the files it writes.
// A change in any of them fails here, so the pages get updated with the code.
//
// Offline: convert and mapping read test/fixtures/site/ (--site is added), and
// the inputs are test/fixtures/docs/. search, nodes and export of a catalog
// model need https and are not covered.
//
// After an intended change, rewrite the golden files and review their diff:
//   npm run golden
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, readdir, readFile, writeFile, cp, realpath } from 'node:fs/promises';
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
const PAGES = 'https://datamodels.jp/en/toolkit';
// Commands that read the catalog get the fixtures copy of the site.
const READS_SITE = new Set(['convert', 'mapping']);
// Files longer than this are listed with their size only; the built site's files by path only.
// (The draft of mapping is shown; init's LICENSE, the CC0 text, is not.)
const SHOW_MAX = 6500;

// Where the examples run: the inputs, then the node that init makes.
const work = await realpath(await mkdtemp(join(tmpdir(), 'datamodels-docs-')));
await cp(INPUTS, work, { recursive: true });
let cwd = work;

/** Every file under dir, relative path → contents. */
async function files(dir) {
  const out = new Map();
  for (const e of await readdir(dir, { recursive: true, withFileTypes: true })) {
    if (!e.isFile()) continue;
    const path = join(e.parentPath, e.name);
    out.set(relative(work, path), await readFile(path));
  }
  return out;
}

/** Output that does not depend on the machine or the release: temp paths, the version, pinned SHAs. */
const stable = (text) => text
  .replaceAll(work, '<work>')
  .replaceAll(SITE_DIR, '<site>')
  .replaceAll(version, '<version>')
  .replace(/\b[0-9a-f]{40}\b/g, '<sha>');

/** The golden text of a command: the page, the command, its exit code, output and the files it added or changed. */
async function record(page, args) {
  const before = await files(work);
  const extra = READS_SITE.has(args[0]) ? ['--site', SITE_DIR] : [];
  const r = await run(process.execPath, [BIN, ...args, ...extra], { cwd, env: { ...process.env, NO_COLOR: '1' } })
    .then((x) => ({ code: 0, ...x }), (e) => ({ code: e.code, stdout: e.stdout, stderr: e.stderr }));
  const lines = [
    `# ${PAGES}/${page}`,
    `$ ${relative(work, cwd) ? `cd ${relative(work, cwd)} && ` : ''}datamodels ${args.join(' ')}`,
    `exit: ${r.code}`,
    '--- stdout', r.stdout.trimEnd(),
    '--- stderr', r.stderr.trimEnd(),
  ];
  for (const [path, body] of [...(await files(work))].sort(([a], [b]) => a.localeCompare(b))) {
    const old = before.get(path);
    if (old?.equals(body)) continue;
    const head = `--- ${old ? 'changed' : 'added'} ${path}`;
    if (path.split('/').includes('_site')) lines.push(head);
    else if (body.length > SHOW_MAX) lines.push(`${head} (${body.length} bytes)`);
    else lines.push(head, body.toString('utf8').trimEnd());
  }
  return `${stable(lines.join('\n'))}\n`;
}

let n = 0;
/** One documented example: run it and compare with test/golden/docs/<nn>-<name>.txt. */
function example(name, page, args, { before } = {}) {
  const file = join(GOLDEN, `${String(++n).padStart(2, '0')}-${name}.txt`);
  test(`${page}: datamodels ${args.join(' ')}`, async () => {
    await before?.();
    const actual = await record(page, args);
    if (UPDATE) {
      await mkdir(GOLDEN, { recursive: true });
      await writeFile(file, actual);
      return;
    }
    const expected = await readFile(file, 'utf8').catch(() => null);
    assert.ok(expected !== null, `${relative(ROOT, file)} is missing: run npm run golden`);
    assert.equal(actual, expected, `the output differs from ${relative(ROOT, file)}: update the page, or run npm run golden and review the diff`);
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

// Convert lists.
example('convert-standard', 'convert', ['convert', 'disaster/EvacuationSite', 'jichitai-opendata-site', '092011_evacuation_space.csv', '--out', 'sites.json'],
  { before: () => { cwd = work; } });
example('convert-set', 'convert', ['convert', 'disaster/EvacuationSite', 'gsi-emergency-site', '13101_2.csv', '--set', 'localGovernmentCode=131016']);
example('mapping', 'convert#your-own-list', ['mapping', 'disaster/EvacuationSite', 'my-list.csv', '--out', 'my-list.yaml']);
// Step 2 of the page, done by a person: the TODOs filled in.
example('convert-own-check', 'convert#your-own-list', ['convert', 'disaster/EvacuationSite', 'my-list.yaml', 'my-list.csv', '--check'],
  { before: () => cp(join(INPUTS, 'my-list.filled.yaml'), join(work, 'my-list.yaml')) });
example('convert-own', 'convert#your-own-list', ['convert', 'disaster/EvacuationSite', 'my-list.yaml', 'my-list.csv', '--out', 'entities.json']);
example('convert-template', 'convert', ['convert', 'disaster/EvacuationSite', 'csv-template', 'sites.csv', '--out', 'template-entities.json']);
