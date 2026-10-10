// The build library (src/build/, #10). It must produce exactly what
// datamodels.jp serves for the same sources (test/fixtures/catalog/, made by
// scripts/update-build-fixtures.mjs), and work for a node with another base
// URL and other languages.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { catalogUrls, loadSubjects, publishCatalog, verifyRelease, buildVocabulary, snapshotRelease, extensionEntry } from '../src/build/index.mjs';

const FIXTURES = join(import.meta.dirname, 'fixtures', 'catalog');
const SITE = 'https://datamodels.jp';
const site = catalogUrls(SITE, { pageEn: (url) => url.replace(SITE, `${SITE}/en`) });

async function filesUnder(dir) {
  const out = [];
  for (const e of await readdir(dir, { withFileTypes: true, recursive: true })) if (e.isFile()) out.push(join(e.parentPath, e.name));
  return out;
}

test('the files are byte for byte what datamodels.jp serves for the same sources', async () => {
  const subjects = await loadSubjects(join(FIXTURES, 'models'), { urls: site });
  const outDir = await mkdtemp(join(tmpdir(), 'datamodels-build-'));
  // datamodels.jp adds one adapter (GeonicDB) for entity models; a stand-in with the same URLs.
  const geonicdb = { name: 'geonicdb', urlFor: (s, m) => (m.kind === 'entity' ? `${SITE}/adapters/geonicdb/${s.name}/${m.type}.json` : null), content: () => '{}\n' };
  const { catalog } = await publishCatalog(subjects, { urls: site, outDir, adapters: [geonicdb], head: { license: 'CC0-1.0', licenseUrl: `${SITE}/LICENSE-CONTENT` } });
  const expectedDir = join(FIXTURES, 'expected');
  const expected = (await filesUnder(expectedDir)).filter((f) => !f.endsWith('catalog-models.json'));
  assert.ok(expected.length > 30, 'the fixtures hold the served files');
  for (const file of expected) {
    const path = relative(expectedDir, file);
    assert.deepEqual(await readFile(join(outDir, path)), await readFile(file), path);
  }
  // catalog.json: the same entries as the site's, for these subjects.
  assert.deepEqual(catalog.models, JSON.parse(await readFile(join(expectedDir, 'catalog-models.json'), 'utf8')));
  assert.deepEqual(JSON.parse(await readFile(join(outDir, 'catalog.json'), 'utf8')), catalog);
});

test('the release snapshots hold what the sources produce', async () => {
  const subjects = await loadSubjects(join(FIXTURES, 'models'), { urls: site });
  for (const s of subjects) assert.deepEqual(await verifyRelease(s, { urls: site }, { recorded: true }), [], s.name);
});

test('a node: its own base URL, English only, its licence and publisher in catalog.json', async () => {
  const models = await mkdtemp(join(tmpdir(), 'datamodels-node-'));
  const base = 'https://models.example.org';
  await mkdir(join(models, 'road', 'RoadPatrol'), { recursive: true });
  await writeFile(join(models, 'road', 'subject.yaml'), 'name: road\nversion: 0.1.0\nsource: minted\ntitle: { en: Roads }\ndescription: { en: Road maintenance. }\n');
  await writeFile(join(models, 'road', 'context.jsonld'), JSON.stringify({ '@context': { road: `${base}/ns/road/`, RoadPatrol: 'road:RoadPatrol', route: 'road:route' } }));
  await writeFile(join(models, 'road', 'RoadPatrol', 'schema.json'), JSON.stringify({ $id: `${base}/schema/road/RoadPatrol/v0.1.0.json`, type: 'object', properties: { id: {}, type: {}, route: { type: 'string', 'x-iri': `${base}/ns/road/route` } } }));
  await writeFile(join(models, 'road', 'RoadPatrol', 'catalog.yaml'), 'title: { en: Road patrol }\ndescription: { en: One patrol run. }\nstatus: experimental\nattributes:\n  route: { en: The route patrolled }\n');

  const urls = catalogUrls(`${base}/`);
  assert.equal(urls.baseUrl, base, 'a trailing slash is dropped');
  // A node that requires both languages would refuse this subject.
  await assert.rejects(loadSubjects(models, { urls }), /title\.ja is required/);
  const subjects = await loadSubjects(models, { urls, languages: ['en'], subjectFields: ['title', 'description'] });
  const outDir = await mkdtemp(join(tmpdir(), 'datamodels-node-out-'));
  const head = { publisher: { name: { en: 'Example Inc.' }, url: 'https://example.org/' }, license: 'CC0-1.0' };
  const { catalog, exactPaths, redirects } = await publishCatalog(subjects, { urls, outDir, languages: ['en'], head, now: new Date('2026-10-10T00:00:00Z') });

  assert.equal(catalog.generatedAt, '2026-10-10T00:00:00.000Z');
  assert.deepEqual(catalog.publisher, head.publisher);
  const [entry] = catalog.models;
  assert.equal(entry.typeIri, `${base}/ns/road/RoadPatrol`);
  assert.equal(entry.status, 'experimental');
  assert.equal(entry.pageUrlEn, undefined, 'no English page of its own when the pages are in one language');
  assert.deepEqual(entry.attributes[0].description, { en: 'The route patrolled' });
  assert.deepEqual(exactPaths.sort(), ['/context/road/v0.1.0.jsonld', '/schema/road/RoadPatrol/v0.1.0.json', '/vocab/road/v0.1.0.jsonld']);
  assert.deepEqual(redirects, [['/ns/road/', '/models/road/'], ['/ns/road/RoadPatrol', '/models/road/RoadPatrol/'], ['/ns/road/route', '/models/road/RoadPatrol/#route']]);
  const vocab = JSON.parse(await readFile(join(outDir, 'vocab', 'road', 'v0.jsonld'), 'utf8'));
  assert.deepEqual(vocab, buildVocabulary(subjects[0], { urls, languages: ['en'] }));
  assert.deepEqual(vocab['@graph'][0].label, { en: 'Roads' });

  // Once a version has a snapshot it was published: a change without a new version stops the build.
  await snapshotRelease(subjects[0], { urls, languages: ['en'] });
  const catalogYaml = join(models, 'road', 'RoadPatrol', 'catalog.yaml');
  await writeFile(catalogYaml, (await readFile(catalogYaml, 'utf8')).replace('The route patrolled', 'The route'));
  const changed = await loadSubjects(models, { urls, languages: ['en'], subjectFields: ['title', 'description'] });
  await assert.rejects(publishCatalog(changed, { urls, outDir, languages: ['en'], head }), /road v0\.1\.0 was published and its files would change; give the subject a new version:\n {2}road v0\.1\.0 vocabulary: snapshot differs/);
});

test('an extension in catalog.json has its texts in the catalog\'s languages', () => {
  const ext = { name: 'acme', organization: { ja: 'アクメ', en: 'Acme' }, version: '1.0.0', context: 'https://acme.example/context.jsonld', terms: { x: { iri: 'https://acme.example/x', description: { ja: 'エックス', en: 'X' } } } };
  assert.deepEqual(extensionEntry(ext, { languages: ['en'] }).organization, { en: 'Acme' });
  assert.deepEqual(extensionEntry(ext).terms[0].description, { ja: 'エックス', en: 'X' });
  assert.throws(() => extensionEntry({ ...ext, terms: { x: { iri: 'https://acme.example/x' } } }), /extension acme: the description of x needs a ja or en text/);
});

test('a context may import only the catalog\'s own contexts, unless the node allows more', async () => {
  const models = await mkdtemp(join(tmpdir(), 'datamodels-import-'));
  const base = 'https://models.example.org';
  await mkdir(join(models, 'x'), { recursive: true });
  await writeFile(join(models, 'x', 'subject.yaml'), 'name: x\nversion: 1.0.0\nsource: profile\ntitle: { en: X }\ndescription: { en: X. }\n');
  await writeFile(join(models, 'x', 'context.jsonld'), JSON.stringify({ '@context': ['https://datamodels.jp/context/task/v1.jsonld', { a: `${base}/ns/x/a` }] }));
  const urls = catalogUrls(base);
  const opts = { urls, languages: ['en'], subjectFields: ['title', 'description'] };
  await assert.rejects(loadSubjects(models, opts), /only catalog contexts may be imported by URL/);
  const [s] = await loadSubjects(models, { ...opts, importable: (url) => url.startsWith('https://datamodels.jp/context/') });
  assert.deepEqual(s.imports, ['https://datamodels.jp/context/task/v1.jsonld']);
});
