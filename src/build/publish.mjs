// Write the machine-readable files of a catalog: every published version
// (release snapshots), the current @contexts, vocabularies, JSON Schemas,
// examples and mapping files, and catalog.json. Moved from geolonia/datamodels
// (scripts/lib/publish.mjs, publishModels, #10). What only one site needs
// (redirect rules, cache headers, its pages) stays with that site: this
// returns the paths it needs for them.
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { listReleases, verifyRelease } from './releases.mjs';
import { buildVocabulary } from './vocab.mjs';
import { catalogEntry, termRedirects } from './entries.mjs';

const json = (o) => JSON.stringify(o, null, 2) + '\n';

/**
 * Write the files under `outDir`, at the path of their URL below the base URL.
 *
 * Options:
 * - `urls`: from catalogUrls(); `languages`: as for loadSubjects().
 * - `head`: the fields of catalog.json before `models` (licence, publisher, ...).
 * - `adapters`: [{ name, urlFor(subject, model), content(subject, model) }], files made from each model for one tool.
 * - `now`: the time written as generatedAt (a Date; tests pass a fixed one).
 *
 * Returns { catalog, exactPaths, redirects }: catalog.json as written, the
 * paths of exact versions (for immutable caching), and [from, to] paths that
 * make each minted IRI lead to its page.
 */
export async function publishCatalog(subjects, { urls, outDir, languages = ['ja', 'en'], head = {}, adapters = [], now = new Date() }) {
  const rel = (url) => url.slice(urls.baseUrl.length).replace(/^\//, '');
  const write = async (url, content) => {
    const file = join(outDir, rel(url).endsWith('/') ? rel(url) + 'index.html' : rel(url));
    await mkdir(join(file, '..'), { recursive: true });
    await writeFile(file, content);
  };
  const options = { urls, languages };
  const catalog = { formatVersion: 1, generatedAt: now.toISOString(), ...head, models: [] };
  const exactPaths = [];
  const exact = (url) => exactPaths.push(`/${rel(url)}`);
  const redirects = [];

  for (const subject of subjects) {
    const u = urls.subjectUrls(subject);
    // A version that has a snapshot was published: its exact files must not change.
    const changed = await verifyRelease(subject, options);
    if (changed.length) throw new Error(`${subject.name} v${subject.version} was published and its files would change; give the subject a new version:\n${changed.map((p) => `  ${p}`).join('\n')}`);
    // Every published version first, then the current one on top (identical
    // bytes when it has been snapshotted; an immutability check confirms).
    for (const release of await listReleases(subject, options)) {
      for (const f of release.files) { await write(f.url, await readFile(f.path)); exact(f.url); }
    }
    await write(u.contextExact, json(subject.context)); exact(u.contextExact);
    await write(u.contextAlias, json(subject.context));
    const vocab = json(buildVocabulary(subject, options));
    await write(u.vocabExact, vocab); exact(u.vocabExact);
    await write(u.vocabAlias, vocab);
    redirects.push(...termRedirects(subject, options));

    for (const model of subject.models) {
      const mu = urls.modelUrls(subject, model);
      await write(mu.schemaExact, json(model.schema)); exact(mu.schemaExact);
      await write(mu.schemaAlias, json(model.schema));
      for (const [f, content] of Object.entries(model.examples)) await write(`${mu.examples}${f}`, json(content));
      // The source bytes, comments included, so a converter reads exactly what the validator checked.
      for (const m of model.mappings ?? []) await write(`${mu.mapping}${m.name}.yaml`, await readFile(join(model.dir, 'mapping', `${m.name}.yaml`)));
      const adapterUrls = {};
      for (const a of adapters) { const url = a.urlFor(subject, model); if (url) { await write(url, a.content(subject, model)); adapterUrls[a.name] = url; } }
      catalog.models.push(catalogEntry(subject, model, { ...options, adapterUrls }));
    }
  }
  await write(`${urls.baseUrl}/catalog.json`, json(catalog));
  return { catalog, exactPaths, redirects };
}
