// A published version never changes (geolonia/datamodels#226). The release
// snapshots (models/<subject>/releases/vX.Y.Z/) hold the bytes of every
// published version, so they are the record of what was published: the build
// stops when the sources of a released version change, check compares the
// exact versions with the site, and this compares the snapshots with a git
// ref, usually the branch a pull request goes into. That works offline and
// also sees a version that was removed.
//
// While node.yaml says `prerelease: true`, at the ref and in the change, a
// published version may still be corrected in place: the changes are noted,
// not problems. Once the ref has the flag, a change may not remove it, nor
// set it back to true once it is false (the launch).
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import YAML from 'yaml';

const run = promisify(execFile);

async function git(dir, args) {
  try {
    return (await run('git', ['-C', dir, ...args], { maxBuffer: 64 * 1024 * 1024 })).stdout;
  } catch (e) {
    const err = new Error(String(e.stderr || e.message).trim().split('\n')[0]);
    err.exitCode = e.code;
    throw err;
  }
}

/**
 * Compare the node in `dir` with the git ref `base`. `prerelease`: the flag in
 * the node's node.yaml now (undefined when it has none). Returns { problems,
 * notes, prerelease }, the last whether corrections in place are allowed (the
 * flag is true at the ref and now).
 */
export async function compareWithBase(dir, base, { prerelease } = {}) {
  const problems = [];
  const notes = [];
  try {
    await git(dir, ['rev-parse', '--is-inside-work-tree']);
  } catch {
    return { problems: [`--base ${base}: ${dir} is not in a git checkout`], notes, prerelease: false };
  }
  try {
    await git(dir, ['rev-parse', '--verify', '--quiet', `${base}^{commit}`]);
  } catch {
    return { problems: [`--base ${base}: not a commit in ${dir}. Fetch it first, for example: git fetch origin main`], notes, prerelease: false };
  }

  // node.yaml as the ref has it; none when the node is new there.
  let theirs = null;
  try {
    theirs = YAML.parse(await git(dir, ['show', `${base}:./node.yaml`]));
  } catch (e) {
    if (!/does not exist|exists on disk, but not in/.test(e.message)) return { problems: [`--base ${base}: node.yaml could not be read (${e.message})`], notes, prerelease: false };
  }
  const had = !!theirs && typeof theirs === 'object' && Object.hasOwn(theirs, 'prerelease');
  if (had && prerelease === undefined) problems.push(`node.yaml: removes "prerelease"; ${base} has it, so it stays (false after the launch)`);
  else if (had && theirs.prerelease !== true && prerelease === true) problems.push(`node.yaml: sets "prerelease" back to true; ${base} is launched, and published versions cannot become correctable again`);
  const corrections = had && theirs.prerelease === true && prerelease === true;

  // Every file of a release snapshot at the ref is still there, with the same content (as git sees it, line endings and all).
  const out = await git(dir, ['diff', '--no-renames', '--relative', '--name-status', '-z', base, '--', ':(glob)models/*/releases/**']);
  const parts = out.split('\0').filter(Boolean);
  for (let i = 0; i + 1 < parts.length; i += 2) {
    const [status, path] = [parts[i], parts[i + 1]];
    if (status === 'A') continue;
    const what = status === 'D' ? 'removed' : 'changed';
    const text = `${path}: ${what} since ${base}`;
    if (corrections) notes.push(`${text}, corrected in place during the pre-release (prerelease: true in node.yaml)`);
    else problems.push(`${text}. A published version never changes and stays online; give the subject a new version instead`);
  }
  return { problems, notes, prerelease: corrections };
}
