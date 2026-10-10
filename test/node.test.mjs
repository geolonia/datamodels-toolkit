// A node (#12): node.yaml and models/ built into the files it publishes,
// with hash IRIs by default (geolonia/datamodels docs/node.md).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { randomBytes } from 'node:crypto';
import { readNode, buildNode, buildVocabulary, catalogUrls } from '../src/build/index.mjs';

const run = promisify(execFile);
const BIN = join(import.meta.dirname, '..', 'bin', 'datamodels.mjs');
const datamodels = (...args) => run(process.execPath, [BIN, ...args]).then((r) => ({ code: 0, ...r }), (e) => ({ code: e.code, stdout: e.stdout, stderr: e.stderr }));
const BASE = 'https://models.example.org';
const NODE_YAML = `baseUrl: ${BASE}/
languages: [en]
publisher: { name: { en: Example Inc. }, url: https://example.org/ }
license: CC0-1.0
nodes:
  - { url: https://datamodels.jp/, index: https://datamodels.jp/catalog.json }
`;

async function node({ yaml = NODE_YAML, context } = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'datamodels-node-'));
  await writeFile(join(dir, 'node.yaml'), yaml);
  const road = join(dir, 'models', 'road');
  await mkdir(join(road, 'RoadPatrol'), { recursive: true });
  await writeFile(join(road, 'subject.yaml'), 'name: road\nversion: 0.1.0\nsource: minted\ntitle: { en: Roads }\ndescription: { en: Road maintenance. }\n');
  await writeFile(join(road, 'context.jsonld'), JSON.stringify({ '@context': context ?? { road: `${BASE}/ns/road#`, RoadPatrol: 'road:RoadPatrol', route: 'road:route' } }));
  await writeFile(join(road, 'RoadPatrol', 'schema.json'), JSON.stringify({ $id: `${BASE}/schema/road/RoadPatrol/v0.1.0.json`, type: 'object', properties: { id: {}, type: {}, route: { type: 'string', 'x-iri': `${BASE}/ns/road#route` } } }));
  await writeFile(join(road, 'RoadPatrol', 'catalog.yaml'), [
    'title: { en: Road patrol }', 'description: { en: One patrol run. }', 'status: experimental',
    'attributes:', '  route: { en: The route patrolled }',
    'extends:', '  - { typeIri: https://datamodels.jp/ns/task/Task, version: 1.0.0, index: https://datamodels.jp/catalog.json }', '',
  ].join('\n'));
  return dir;
}

test('a node builds with hash IRIs, its publisher, licence and known nodes', async () => {
  const dir = await node();
  const { catalog, redirects, exactPaths } = await buildNode(dir, { now: new Date('2026-10-10T00:00:00Z') });
  const out = join(dir, '_site');
  assert.deepEqual(JSON.parse(await readFile(join(out, 'catalog.json'), 'utf8')), catalog);
  assert.deepEqual(Object.keys(catalog), ['formatVersion', 'generatedAt', 'publisher', 'license', 'nodes', 'models'], 'the order of docs/node.md');
  assert.deepEqual(catalog.publisher, { name: { en: 'Example Inc.' }, url: 'https://example.org/' });
  const [entry] = catalog.models;
  assert.equal(entry.typeIri, `${BASE}/ns/road#RoadPatrol`);
  assert.equal(entry.pageUrl, `${BASE}/models/road/RoadPatrol/`);
  assert.equal(entry.status, 'experimental');
  assert.equal(entry.attributes[0].iri, `${BASE}/ns/road#route`);
  assert.deepEqual(entry.extends, [{ typeIri: 'https://datamodels.jp/ns/task/Task', version: '1.0.0', index: 'https://datamodels.jp/catalog.json' }]);
  // Hash IRIs need no redirects: the namespace document is the subject's page.
  assert.deepEqual(redirects, []);
  assert.deepEqual(exactPaths.sort(), ['/context/road/v0.1.0.jsonld', '/schema/road/RoadPatrol/v0.1.0.json', '/vocab/road/v0.1.0.jsonld']);

  const vocab = JSON.parse(await readFile(join(out, 'vocab', 'road', 'v0.jsonld'), 'utf8'));
  const urls = catalogUrls(BASE, { iris: 'hash' });
  assert.deepEqual(vocab['@graph'].map((n) => n['@id']), [`${BASE}/ns/road#`, `${BASE}/ns/road#RoadPatrol`, `${BASE}/ns/road#route`]);
  assert.equal(urls.subjectUrls({ name: 'road', version: '0.1.0' }).page, `${BASE}/ns/road`);

  const llms = await readFile(join(out, 'llms.txt'), 'utf8');
  assert.match(llms, /^# Data models by Example Inc\.\n/);
  assert.match(llms, /- \[RoadPatrol\]\(https:\/\/models\.example\.org\/models\/road\/RoadPatrol\/\) \(entity type, experimental\): One patrol run\. JSON Schema: https:\/\/models\.example\.org\/schema\/road\/RoadPatrol\/v0\.1\.0\.json/);
  assert.match(llms, /\[catalog\.json\]\(https:\/\/models\.example\.org\/catalog\.json\)/);
});

test('the pages: plain HTML, an anchor for every term IRI, a link to catalog.json', async () => {
  const dir = await node();
  const desc = join(dir, 'models', 'road', 'subject.yaml');
  await writeFile(desc, (await readFile(desc, 'utf8')).replace('Road maintenance.', '"Road <b>maintenance</b>."'));
  const { pages, catalog } = await buildNode(dir);
  assert.deepEqual(pages, ['index.html', 'models/road/RoadPatrol/index.html', 'ns/road.html']);
  const read = (p) => readFile(join(dir, '_site', p), 'utf8');
  for (const p of pages) {
    const html = await read(p);
    assert.match(html, /<link rel="alternate" type="application\/json" href="https:\/\/models\.example\.org\/catalog\.json">/, p);
    assert.doesNotMatch(html, /<script/i, p);
  }
  // Every IRI the subject mints opens on the namespace document, ns/road.html, at its own anchor.
  const subject = await read('ns/road.html');
  const iris = [catalog.models[0].typeIri, ...catalog.models[0].attributes.map((a) => a.iri)];
  for (const iri of iris) {
    assert.ok(iri.startsWith(`${BASE}/ns/road#`), iri);
    assert.ok(subject.includes(`id="${iri.split('#')[1]}"`), iri);
  }
  assert.match(subject, /<link rel="alternate" type="application\/ld\+json" href="https:\/\/models\.example\.org\/vocab\/road\/v0\.1\.0\.jsonld">/);
  assert.match(subject, /Road &lt;b&gt;maintenance&lt;\/b&gt;\./, 'text is escaped');
  const model = await read('models/road/RoadPatrol/index.html');
  assert.match(model, /<h3 id="route">route<\/h3>/);
  assert.match(model, /<dt>Extends<\/dt><dd><a href="https:\/\/datamodels\.jp\/ns\/task\/Task">/);
  assert.match(model, /<title>RoadPatrol: data models by Example Inc\.<\/title>/);
  // The anchor follows the IRI, not the attribute's name.
  const sf = join(dir, 'models', 'road', 'RoadPatrol', 'schema.json');
  const sj = JSON.parse(await readFile(sf, 'utf8'));
  sj.properties.route['x-iri'] = `${BASE}/ns/road#lane`;
  await writeFile(sf, JSON.stringify(sj));
  await buildNode(dir);
  const renamed = await read('ns/road.html');
  assert.ok(renamed.includes('id="lane"') && !renamed.includes('id="route"'), 'the anchor of route is lane');
  // Only http(s) URLs from the sources become links.
  const schemaFile = join(dir, 'models', 'road', 'RoadPatrol', 'schema.json');
  await writeFile(schemaFile, JSON.stringify({ ...JSON.parse(await readFile(schemaFile, 'utf8')), 'x-subclass-of': 'javascript:alert(1)' }));
  await buildNode(dir);
  assert.doesNotMatch(await read('models/road/RoadPatrol/index.html'), /javascript:/);
});

test('an eleventy.config.js where the command runs does not change the pages', async () => {
  const dir = await node();
  await writeFile(join(dir, 'eleventy.config.js'), "export default function () { throw new Error('the node\\'s own Eleventy configuration was loaded'); }\n");
  const r = await run(process.execPath, [BIN, 'build'], { cwd: dir }).then((x) => ({ code: 0, ...x }), (e) => ({ code: e.code, stderr: e.stderr }));
  assert.equal(r.code, 0, r.stderr);
  assert.ok((await readFile(join(dir, '_site', 'ns', 'road.html'), 'utf8')).includes('id="RoadPatrol"'));
});

test('slash IRIs when node.yaml asks for them, with their redirects', async () => {
  const dir = await node({ yaml: `${NODE_YAML}iris: slash\n`, context: { road: `${BASE}/ns/road/`, RoadPatrol: 'road:RoadPatrol', route: 'road:route' } });
  const schema = join(dir, 'models', 'road', 'RoadPatrol', 'schema.json');
  await writeFile(schema, (await readFile(schema, 'utf8')).replace('/ns/road#route', '/ns/road/route'));
  const { catalog, redirects, subjects } = await buildNode(dir);
  assert.equal(catalog.models[0].typeIri, `${BASE}/ns/road/RoadPatrol`);
  assert.deepEqual(redirects.map(([from]) => from), ['/ns/road/', '/ns/road/RoadPatrol', '/ns/road/route']);
  const { pages } = await buildNode(dir);
  assert.ok(pages.includes('models/road/index.html'), 'the subject page is under /models/ with slash IRIs');
  assert.equal(buildVocabulary(subjects[0], { urls: catalogUrls(BASE), languages: ['en'] })['@graph'].length, 3);
});

test('a context may import the contexts of the nodes listed in node.yaml, and no others', async () => {
  const ok = await node({ context: ['https://datamodels.jp/context/task/v1.jsonld', { road: `${BASE}/ns/road#`, RoadPatrol: 'road:RoadPatrol', route: 'road:route' }] });
  const { subjects } = await buildNode(ok);
  assert.deepEqual(subjects[0].imports, ['https://datamodels.jp/context/task/v1.jsonld']);
  const other = await node({ context: ['https://elsewhere.example/context/x/v1.jsonld', { road: `${BASE}/ns/road#` }] });
  await assert.rejects(buildNode(other), /only catalog contexts may be imported by URL, got https:\/\/elsewhere\.example/);
});

test('extends must name a type IRI, a version and an index', async () => {
  const dir = await node();
  const file = join(dir, 'models', 'road', 'RoadPatrol', 'catalog.yaml');
  await writeFile(file, (await readFile(file, 'utf8')).replace('version: 1.0.0', 'version: v1'));
  await assert.rejects(buildNode(dir), /road\/RoadPatrol\/catalog\.yaml: extends must be a list of \{ typeIri, version: X\.Y\.Z, index \}/);
  // A list that would read as a version is not one.
  await writeFile(file, (await readFile(file, 'utf8')).replace('version: v1', 'version: [1.0.0]'));
  await assert.rejects(buildNode(dir), /extends must be a list of \{ typeIri, version: X\.Y\.Z, index \}/);
});

test('node.yaml: a missing file, and every problem at once', async () => {
  const empty = await mkdtemp(join(tmpdir(), 'datamodels-node-'));
  await assert.rejects(readNode(empty), /node\.yaml: not found/);
  await writeFile(join(empty, 'node.yaml'), 'baseUrl: models.example.org\niris: path\nlanguages: English\npublisher: { name: Example }\nlicenseUrl: LICENSE\nnodes: [https://datamodels.jp/]\n');
  await assert.rejects(readNode(empty), (e) => {
    for (const p of ['baseUrl must be', 'iris must be hash or slash', 'languages must be', 'publisher needs', 'license is required', 'licenseUrl must be', 'nodes must be']) assert.ok(e.message.includes(p), p);
    return true;
  });
  // URLs are published, so credentials in them are refused.
  // (Made here, so no URL with credentials is written in the source.)
  const withCredentials = (url) => { const u = new URL(url); u.username = 'someone'; u.password = randomBytes(6).toString('hex'); return u.href; };
  await writeFile(join(empty, 'node.yaml'), `baseUrl: ${withCredentials(BASE)}\npublisher: { name: { en: X }, url: ${withCredentials('https://example.org/')} }\nlicense: CC0-1.0\n`);
  await assert.rejects(readNode(empty), /baseUrl must be an http\(s\) URL without credentials[^]*publisher needs/);
  // A YAML list is not a URL, even one that new URL() would read as one.
  await writeFile(join(empty, 'node.yaml'), `baseUrl: [${BASE}]\npublisher: { name: { en: X }, url: https://example.org/ }\nlicense: CC0-1.0\n`);
  await assert.rejects(readNode(empty), /node\.yaml:\n {2}baseUrl must be/);
  // The defaults: hash IRIs, English.
  await writeFile(join(empty, 'node.yaml'), `baseUrl: ${BASE}\npublisher: { name: { ja: 例 }, url: https://example.org/ }\nlicense: CC0-1.0\n`);
  assert.deepEqual(await readNode(empty), { baseUrl: BASE, iris: 'hash', languages: ['en'], publisher: { name: { ja: '例' }, url: 'https://example.org/' }, license: 'CC0-1.0' });
});

test('datamodels build writes the node, and exits with 1 on an invalid one', async () => {
  const dir = await node();
  const out = join(dir, 'public');
  let r = await datamodels('build', dir, '--out', out);
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stderr, /1 subject\(s\), 1 model\(s\), written to .*public/);
  assert.equal(JSON.parse(await readFile(join(out, 'catalog.json'), 'utf8')).models.length, 1);
  await writeFile(join(dir, 'node.yaml'), 'baseUrl: x\n');
  r = await datamodels('build', dir);
  assert.equal(r.code, 1);
  assert.match(r.stderr, /node\.yaml:\n {2}baseUrl must be/);
});
