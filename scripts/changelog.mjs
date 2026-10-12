// Folds the change files in changes/ into CHANGELOG.md for a release.
//
//   npm run changelog -- 0.3.11 [--date 2026-10-13]
//
// Each pull request adds one file, changes/<branch>.md, instead of editing
// CHANGELOG.md, so parallel pull requests never change the same lines:
//
//   ---
//   section: Fixed
//   ---
//   - `datamodels convert`: … (#123)
//
// The release pull request runs this script. It writes a `## [x.y.z] - date`
// section under `## [Unreleased]`, with the entries grouped by section in the
// order of Keep a Changelog (files in name order within a section), updates
// the compare links at the bottom, and deletes the change files. The summary
// line of the release is written by hand under the new heading.
import { readdir, readFile, writeFile, unlink } from 'node:fs/promises';
import { realpathSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import YAML from 'yaml';

export const SECTIONS = ['Added', 'Changed', 'Deprecated', 'Removed', 'Fixed', 'Security'];
const ROOT = join(import.meta.dirname, '..');

/**
 * Checks the text of one change file. Returns { section, body } (body without
 * the front matter, trimmed); throws an Error that says what is wrong.
 */
export function parseFragment(text) {
  const m = /^---\n(?:([\s\S]*?)\n)?---\n([\s\S]*)$/.exec(text.replace(/\r\n/g, '\n'));
  if (!m) throw new Error('it does not start with front matter (--- section: … ---)');
  let meta;
  try { meta = YAML.parse(m[1] ?? ''); } catch (e) { throw new Error(`its front matter is not YAML: ${e.message}`); }
  if (!meta || typeof meta !== 'object' || Array.isArray(meta)) throw new Error('its front matter has no section');
  const extra = Object.keys(meta).filter((k) => k !== 'section');
  if (extra.length) throw new Error(`its front matter has unknown keys: ${extra.join(', ')} (only section)`);
  if (!SECTIONS.includes(meta.section)) throw new Error(`section is ${JSON.stringify(meta.section)}, not one of ${SECTIONS.join(', ')}`);
  const body = m[2].trim();
  if (!/^- \S/m.test(body)) throw new Error('it has no list item (a line that starts with "- ")');
  const bad = body.split('\n').find((line) => line && !line.startsWith('- ') && !/^\s/.test(line));
  if (bad !== undefined) throw new Error(`each line must be a list item ("- …") or an indented continuation, not: ${bad}`);
  return { section: meta.section, body };
}

/** A change file's name: lower-case letters, digits, dots, dashes and underscores, ending in .md. */
const NAME = /^[a-z0-9][a-z0-9._-]*\.md$/;

/**
 * The change files in dir: [{ file, section, body }], in name order. README.md is
 * not one. Anything else that is not a change file (another extension, upper case,
 * a folder from a branch name with a slash) is an error, so no entry is left out
 * of a release without notice.
 */
export async function readFragments(dir) {
  const entries = (await readdir(dir, { withFileTypes: true })).filter((e) => e.name !== 'README.md');
  const odd = entries.filter((e) => !e.isFile() || !NAME.test(e.name)).map((e) => e.name + (e.isFile() ? '' : '/'));
  if (odd.length) throw new Error(`${dir}: not a change file: ${odd.join(', ')} (name it like fix-init-prompts.md, lower case, no folders)`);
  const names = entries.map((e) => e.name).sort();
  const out = [];
  for (const file of names) {
    try {
      out.push({ file, ...parseFragment(await readFile(join(dir, file), 'utf8')) });
    } catch (e) {
      throw new Error(`${join(dir, file)}: ${e.message}`);
    }
  }
  return out;
}

/** The lines of the [Unreleased] section between its heading and the next version, or throws. */
export function unreleased(changelog) {
  const lines = changelog.split('\n');
  const start = lines.indexOf('## [Unreleased]');
  if (start < 0) throw new Error('CHANGELOG.md has no "## [Unreleased]" heading');
  let end = lines.findIndex((l, i) => i > start && l.startsWith('## '));
  if (end < 0) end = lines.findIndex((l, i) => i > start && /^\[[^\]]+\]: /.test(l));
  if (end < 0) end = lines.length;
  return { lines, start, end, body: lines.slice(start + 1, end).join('\n').trim() };
}

/** CHANGELOG.md text with the fragments as a new version. Pure: reads and writes nothing. */
export function release(changelog, fragments, { version, date }) {
  // A release is x.y.z, without leading zeros; a pre-release is not published (publish.yml), so it has no entry.
  if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version)) throw new Error(`"${version}" is not a version (x.y.z)`);
  // A day that exists: 2026-02-30 does not survive the round trip through Date.
  const day = /^\d{4}-\d{2}-\d{2}$/.test(date) ? new Date(`${date}T00:00:00Z`) : null;
  if (!day || Number.isNaN(day.getTime()) || day.toISOString().slice(0, 10) !== date) throw new Error(`"${date}" is not a date (YYYY-MM-DD)`);
  if (!fragments.length) throw new Error('changes/ has no change files: nothing to release');
  if (changelog.includes(`## [${version}]`)) throw new Error(`CHANGELOG.md already has ${version}`);
  const { lines, start, end, body } = unreleased(changelog);
  if (body) throw new Error('the [Unreleased] section of CHANGELOG.md is not empty: move its entries into changes/ first');

  const link = lines.findIndex((l) => l.startsWith('[Unreleased]: '));
  const cmp = link < 0 ? null : /^\[Unreleased\]: (\S+\/compare\/)(\S+?)\.\.\.(\S+)$/.exec(lines[link]);
  if (!cmp) throw new Error('CHANGELOG.md has no "[Unreleased]: …/compare/vX.Y.Z...main" link');
  const [, base, previous, head] = cmp;

  const section = [`## [${version}] - ${date}`, ''];
  for (const name of SECTIONS) {
    const bodies = fragments.filter((f) => f.section === name).map((f) => f.body);
    if (bodies.length) section.push(`### ${name}`, '', ...bodies, '');
  }
  const out = [
    ...lines.slice(0, start + 1), '', ...section,
    ...lines.slice(end, link),
    `[Unreleased]: ${base}v${version}...${head}`,
    `[${version}]: ${base}${previous}...v${version}`,
    ...lines.slice(link + 1),
  ];
  return out.join('\n');
}

/** Today in the local time zone, YYYY-MM-DD. */
const today = () => {
  const d = new Date();
  return [d.getFullYear(), d.getMonth() + 1, d.getDate()].map((n) => String(n).padStart(2, '0')).join('-');
};

async function main(argv) {
  const { values, positionals } = parseArgs({ args: argv, options: { date: { type: 'string' } }, allowPositionals: true });
  if (positionals.length !== 1) throw new Error('usage: npm run changelog -- <version> [--date YYYY-MM-DD]');
  const [version] = positionals;
  const dir = join(ROOT, 'changes');
  const file = join(ROOT, 'CHANGELOG.md');
  const fragments = await readFragments(dir);
  await writeFile(file, release(await readFile(file, 'utf8'), fragments, { version, date: values.date ?? today() }));
  for (const f of fragments) await unlink(join(dir, f.file));
  console.log(`CHANGELOG.md: ${version} with ${fragments.length} change file(s); they are deleted from changes/.`);
  console.log(`Write the summary line of the release under "## [${version}]".`);
}

// Run as a script, not imported by the tests (import.meta.main needs Node 24.2).
if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  main(process.argv.slice(2)).catch((e) => {
    console.error(`changelog: ${e.message}`);
    process.exitCode = 1;
  });
}
