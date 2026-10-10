// datamodels release (#27): keep a published version of a subject online.
// A node's site holds the current version of each subject; the build also
// publishes every snapshot in <subject>/releases/vX.Y.Z/. Snapshot a version
// once it is published, before its sources change, and the next version
// leaves it in place.
import { join, relative } from 'node:path';
import { stat } from 'node:fs/promises';
import { loadNode } from './build/node.mjs';
import { releaseContents, snapshotRelease, verifyRelease } from './build/releases.mjs';

const exists = (p) => stat(p).then(() => true, () => false);

/**
 * Snapshot the current version of `subjectName` in the node in `dir`. Online,
 * the files of that version that are already published must be what the
 * snapshot keeps: otherwise the sources changed after publishing, and the
 * snapshot would serve other files under the same URLs. Returns { subject,
 * version, dir, written, online, notes }; throws on a problem.
 */
export async function releaseSubject(dir, subjectName, { offline = false, fetch: fetchUrl = globalThis.fetch, timeout = 20000 } = {}) {
  const { node, urls, subjects } = await loadNode(dir);
  const subject = subjects.find((s) => s.name === subjectName);
  if (!subject) throw new Error(`no subject ${subjectName} in ${join(dir, 'models')} (subjects: ${subjects.map((s) => s.name).join(', ') || 'none'})`);
  const options = { urls, languages: node.languages };
  const { dir: releaseDir, entries } = releaseContents(subject, options);
  const result = { subject: subject.name, version: subject.version, dir: relative(dir, releaseDir) || '.', written: false, online: 0, notes: [] };

  // A snapshot that exists stays as it is: the same files, or a problem.
  if (await exists(releaseDir)) {
    const problems = await verifyRelease(subject, options);
    if (problems.length) throw new Error(`${subject.name} v${subject.version} is released and its sources changed since:\n${problems.map((p) => `  ${p}`).join('\n')}\nA released version never changes: restore the sources, or give the subject a new version (subject.yaml).`);
    return result;
  }

  if (offline) result.notes.push('offline: the snapshot was not compared with the published files');
  else {
    const changed = [];
    const unread = [];
    for (const e of entries) {
      // Only "not published" (404) lets a file through uncompared; any other failure stops the release.
      try {
        const res = await fetchUrl(e.url, { signal: AbortSignal.timeout(timeout) });
        if (res.status === 404) continue;
        if (!res.ok) { unread.push(`${e.url}: HTTP ${res.status}`); continue; }
        const body = Buffer.from(await res.arrayBuffer());
        result.online++;
        if (!body.equals(Buffer.from(e.content))) changed.push(e.url);
      } catch (err) { unread.push(`${e.url}: ${err.cause?.code ?? err.message}`); }
    }
    if (unread.length) throw new Error(`${subject.name} v${subject.version}: nothing released, the published files could not be compared:\n${unread.map((u) => `  ${u}`).join('\n')}\nTry again when the site answers, or release with --offline to skip the comparison.`);
    if (changed.length) throw new Error(`${subject.name} v${subject.version} is published, and its sources changed since:\n${changed.map((u) => `  ${u}`).join('\n')}\nThe snapshot must keep what was published. Restore the sources of v${subject.version} (for example with git), release, then make the change with a new version.`);
  }
  await snapshotRelease(subject, options);
  result.written = true;
  return result;
}
