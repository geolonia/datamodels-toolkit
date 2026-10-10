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
    for (const e of entries) {
      let res;
      try { res = await fetchUrl(e.url, { signal: AbortSignal.timeout(timeout) }); } catch (err) { result.notes.push(`${e.url}: not reachable (${err.cause?.code ?? err.message}), not compared`); continue; }
      if (res.status === 404) continue;
      if (!res.ok) { result.notes.push(`${e.url}: HTTP ${res.status}, not compared`); continue; }
      let body;
      try { body = Buffer.from(await res.arrayBuffer()); } catch (err) { result.notes.push(`${e.url}: not reachable (${err.cause?.code ?? err.message}), not compared`); continue; }
      result.online++;
      if (!body.equals(Buffer.from(e.content))) changed.push(e.url);
    }
    if (changed.length) throw new Error(`${subject.name} v${subject.version} is published, and its sources changed since:\n${changed.map((u) => `  ${u}`).join('\n')}\nThe snapshot must keep what was published. Restore the sources of v${subject.version} (for example with git), release, then make the change with a new version.`);
  }
  await snapshotRelease(subject, options);
  result.written = true;
  return result;
}
