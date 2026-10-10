// Refresh test/fixtures/catalog/: the sources of two subjects from a checkout
// of geolonia/datamodels, and the files https://datamodels.jp serves for them.
// The library test (test/build.test.mjs) builds the sources and compares the
// result with what the site serves, byte for byte.
//
//   node scripts/update-build-fixtures.mjs ../datamodels
import { cp, mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { catalogUrls, loadSubjects } from '../src/build/index.mjs';

export const SUBJECTS = ['common', 'task'];
const SITE = 'https://datamodels.jp';
// The parts of a model folder the build reads; notes, READMEs and ADOPTERS are not needed.
const KEEP = new Set(['schema.json', 'catalog.yaml', 'examples', 'mapping', 'extensions']);

const repo = process.argv[2];
if (!repo) { console.error('usage: node scripts/update-build-fixtures.mjs <path to a geolonia/datamodels checkout>'); process.exit(2); }
const out = join(import.meta.dirname, '..', 'test', 'fixtures', 'catalog');
await rm(out, { recursive: true, force: true });

for (const subject of SUBJECTS) {
  const from = join(repo, 'models', subject);
  const to = join(out, 'models', subject);
  await mkdir(to, { recursive: true });
  for (const entry of await readdir(from, { withFileTypes: true })) {
    if (!entry.isDirectory()) { if (['subject.yaml', 'context.jsonld'].includes(entry.name)) await cp(join(from, entry.name), join(to, entry.name)); continue; }
    if (entry.name === 'releases') { await cp(join(from, 'releases'), join(to, 'releases'), { recursive: true }); continue; }
    for (const part of await readdir(join(from, entry.name))) {
      if (KEEP.has(part)) await cp(join(from, entry.name, part), join(to, entry.name, part), { recursive: true });
    }
  }
}

// What the site serves for these subjects: every file the build writes, and their entries in catalog.json.
const urls = catalogUrls(SITE, { pageEn: (url) => url.replace(SITE, `${SITE}/en`) });
const subjects = await loadSubjects(join(out, 'models'), { urls });
const files = new Set();
for (const s of subjects) {
  const u = urls.subjectUrls(s);
  for (const url of [u.contextExact, u.contextAlias, u.vocabExact, u.vocabAlias]) files.add(url);
  for (const m of s.models) {
    const mu = urls.modelUrls(s, m);
    for (const url of [mu.schemaExact, mu.schemaAlias, ...Object.keys(m.examples).map((f) => mu.examples + f), ...m.mappings.map((x) => `${mu.mapping}${x.name}.yaml`)]) files.add(url);
  }
}
for (const url of files) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  const file = join(out, 'expected', url.slice(SITE.length + 1));
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, Buffer.from(await res.arrayBuffer()));
}
const catalog = await (await fetch(`${SITE}/catalog.json`)).json();
const models = catalog.models.filter((m) => SUBJECTS.includes(m.subject));
await writeFile(join(out, 'expected', 'catalog-models.json'), JSON.stringify(models, null, 2) + '\n');
console.log(`${SUBJECTS.length} subjects, ${files.size} files and ${models.length} catalog entries in ${out}`);
