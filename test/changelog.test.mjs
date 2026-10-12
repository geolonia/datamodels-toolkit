// The change files in changes/ and the script that folds them into
// CHANGELOG.md for a release (scripts/changelog.mjs). The first two tests check
// the repository itself: every change file is valid, and no pull request adds
// entries under [Unreleased] in CHANGELOG.md.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { parseFragment, readFragments, release, unreleased } from '../scripts/changelog.mjs';

const ROOT = join(import.meta.dirname, '..');
const run = promisify(execFile);

test('every file in changes/ is a valid change file', async () => {
  const fragments = await readFragments(join(ROOT, 'changes'));
});

test('the [Unreleased] section of CHANGELOG.md is empty: entries go into changes/', async () => {
  const { body } = unreleased(await readFile(join(ROOT, 'CHANGELOG.md'), 'utf8'));
  assert.equal(body, '', 'add a file in changes/ instead of editing [Unreleased] (see changes/README.md)');
});

test('parseFragment: section and list items', () => {
  assert.deepEqual(parseFragment('---\nsection: Fixed\n---\n- One.\n- Two,\n  continued.\n'), { section: 'Fixed', body: '- One.\n- Two,\n  continued.' });
  assert.deepEqual(parseFragment('---\r\nsection: Added\r\n---\r\n\r\n- One.\r\n'), { section: 'Added', body: '- One.' });
});

test('parseFragment: says what is wrong', () => {
  const bad = (text, re) => assert.throws(() => parseFragment(text), re);
  bad('- No front matter.\n', /front matter/);
  bad('---\nsection: [\n---\n- x\n', /not YAML/);
  bad('---\n---\n- x\n', /no section/);
  bad('---\nsection: Improved\n---\n- x\n', /"Improved", not one of Added/);
  bad('---\nsection: Added\npr: 12\n---\n- x\n', /unknown keys: pr/);
  bad('---\nsection: Added\n---\n', /no list item/);
  bad('---\nsection: Added\n---\nJust text.\n', /no list item/);
  bad('---\nsection: Added\n---\n### Added\n\n- x\n', /not: ### Added/);
});

const CHANGELOG = `# Changelog

Intro.

## [Unreleased]

## [0.3.10] - 2026-10-12

Summary.

### Changed

- Old.

[Unreleased]: https://github.com/o/r/compare/v0.3.10...main
[0.3.10]: https://github.com/o/r/compare/v0.3.9...v0.3.10
[0.1.0]: https://github.com/o/r/releases/tag/v0.1.0
`;

const fragments = [
  { file: 'a.md', section: 'Fixed', body: '- Fix A.' },
  { file: 'b.md', section: 'Added', body: '- Add B,\n  on two lines.' },
  { file: 'c.md', section: 'Fixed', body: '- Fix C.' },
];

test('release: a new version with the sections in a fixed order, and the compare links', () => {
  assert.equal(release(CHANGELOG, fragments, { version: '0.3.11', date: '2026-10-13' }), `# Changelog

Intro.

## [Unreleased]

## [0.3.11] - 2026-10-13

### Added

- Add B,
  on two lines.

### Fixed

- Fix A.
- Fix C.

## [0.3.10] - 2026-10-12

Summary.

### Changed

- Old.

[Unreleased]: https://github.com/o/r/compare/v0.3.11...main
[0.3.11]: https://github.com/o/r/compare/v0.3.10...v0.3.11
[0.3.10]: https://github.com/o/r/compare/v0.3.9...v0.3.10
[0.1.0]: https://github.com/o/r/releases/tag/v0.1.0
`);
});

test('release: refuses what it cannot do right', () => {
  const opts = { version: '0.3.11', date: '2026-10-13' };
  assert.throws(() => release(CHANGELOG, [], opts), /no change files/);
  assert.throws(() => release(CHANGELOG, fragments, { ...opts, version: 'v0.3.11' }), /not a version/);
  for (const version of ['0.3.11-beta.1', '1.2.3-..', '01.2.3', '1.2']) assert.throws(() => release(CHANGELOG, fragments, { ...opts, version }), /not a version/, version);
  for (const date of ['13.10.2026', '2026-02-30', '2026-99-99']) assert.throws(() => release(CHANGELOG, fragments, { ...opts, date }), /not a date/, date);
  assert.throws(() => release(CHANGELOG, fragments, { ...opts, version: '0.3.10' }), /already has 0.3.10/);
  assert.throws(() => release(CHANGELOG.replace('## [Unreleased]\n', '## [Unreleased]\n\n- Direct.\n'), fragments, opts), /not empty/);
  assert.throws(() => release(CHANGELOG.replace('## [Unreleased]\n', ''), fragments, opts), /no "## \[Unreleased\]"/);
  assert.throws(() => release(CHANGELOG.replace(/^\[Unreleased\]:.*\n/m, ''), fragments, opts), /compare/);
});

test('npm run changelog: writes CHANGELOG.md and deletes the change files, but not on an error', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'changelog-'));
  await cp(join(ROOT, 'scripts', 'changelog.mjs'), join(dir, 'scripts', 'changelog.mjs'));
  await cp(join(ROOT, 'node_modules', 'yaml'), join(dir, 'node_modules', 'yaml'), { recursive: true });
  await writeFile(join(dir, 'CHANGELOG.md'), CHANGELOG);
  await cp(join(ROOT, 'changes', 'README.md'), join(dir, 'changes', 'README.md'));
  await writeFile(join(dir, 'changes', 'fix-a.md'), '---\nsection: Fixed\n---\n- Fix A.\n');
  await writeFile(join(dir, 'changes', 'bad.md'), '---\nsection: Improved\n---\n- B.\n');
  const script = join(dir, 'scripts', 'changelog.mjs');

  const failed = await run(process.execPath, [script, '0.3.11'], { cwd: dir }).then(() => null, (e) => e);
  assert.equal(failed?.code, 1);
  assert.match(failed.stderr, /bad\.md: section is "Improved"/);
  assert.equal(await readFile(join(dir, 'CHANGELOG.md'), 'utf8'), CHANGELOG);
  assert.deepEqual((await readdir(join(dir, 'changes'))).sort(), ['README.md', 'bad.md', 'fix-a.md']);

  await writeFile(join(dir, 'changes', 'bad.md'), '---\nsection: Added\n---\n- B.\n');
  const { stdout } = await run(process.execPath, [script, '0.3.11', '--date', '2026-10-13'], { cwd: dir });
  assert.match(stdout, /0\.3\.11 with 2 change file/);
  const written = await readFile(join(dir, 'CHANGELOG.md'), 'utf8');
  assert.match(written, /## \[0\.3\.11\] - 2026-10-13\n\n### Added\n\n- B\.\n\n### Fixed\n\n- Fix A\.\n\n## \[0\.3\.10\]/);
  assert.deepEqual(await readdir(join(dir, 'changes')), ['README.md']);
});

test('readFragments: a file that is not a change file is an error, not left out', async () => {
  for (const [name, isDir] of [['Fix-A.md', false], ['fix-a.txt', false], ['feature', true]]) {
    const dir = await mkdtemp(join(tmpdir(), 'changes-'));
    await writeFile(join(dir, 'README.md'), '# Change files\n');
    await writeFile(join(dir, 'ok.md'), '---\nsection: Fixed\n---\n- A.\n');
    if (isDir) { await mkdir(join(dir, name)); await writeFile(join(dir, name, 'x.md'), '---\nsection: Fixed\n---\n- B.\n'); }
    else await writeFile(join(dir, name), '---\nsection: Fixed\n---\n- B.\n');
    await assert.rejects(readFragments(dir), new RegExp(`not a change file: ${name}`), name);
  }
});
