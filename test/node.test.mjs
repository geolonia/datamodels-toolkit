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

test('the namespace page groups the terms by the model that first defines them', async () => {
  const dir = await node({ context: { road: `${BASE}/ns/road#`, RoadPatrol: 'road:RoadPatrol', RoadSign: 'road:RoadSign', route: 'road:route', sign: 'road:sign' } });
  const sign = join(dir, 'models', 'road', 'RoadSign');
  await mkdir(sign, { recursive: true });
  await writeFile(join(sign, 'schema.json'), JSON.stringify({ $id: `${BASE}/schema/road/RoadSign/v0.1.0.json`, type: 'object', properties: { id: {}, type: {}, sign: { type: 'string', 'x-iri': `${BASE}/ns/road#sign` }, route: { type: 'string', 'x-iri': `${BASE}/ns/road#route` } } }));
  await writeFile(join(sign, 'catalog.yaml'), 'title: { en: Road sign }\ndescription: { en: One sign. }\nstatus: experimental\nattributes:\n  sign: { en: The text on the sign }\n  route: { en: The route the sign is on }\n');
  await buildNode(dir);
  const page = await readFile(join(dir, '_site', 'ns', 'road.html'), 'utf8');
  const groups = Object.fromEntries(page.split('<h3>').slice(1).map((g) => [g.match(/">(\w+)<\/a><\/h3>/)[1], g.slice(0, g.indexOf('</table>'))]));
  assert.deepEqual(Object.keys(groups), ['RoadPatrol', 'RoadSign']);
  const ids = (g) => [...g.matchAll(/<tr id="(\w+)">/g)].map((m) => m[1]);
  assert.deepEqual(ids(groups.RoadPatrol), ['RoadPatrol', 'route']);
  assert.deepEqual(ids(groups.RoadSign), ['RoadSign', 'sign'], 'route is listed once, under the model that defines it first');
});

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
  assert.deepEqual(pages, ['404.html', 'index.html', 'models/road/RoadPatrol/index.html', 'ns/road.html']);
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
  assert.doesNotMatch(subject, /hreflang|<nav>/, 'one language: no links to other languages');
  // Compact: grouped by model, one table row per term, the IRI rule stated once.
  assert.match(subject, /<h3><a href="https:\/\/models\.example\.org\/models\/road\/RoadPatrol\/">RoadPatrol<\/a><\/h3>\n<table>/);
  assert.match(subject, /<tr id="route"><th scope="row"><a href="https:\/\/models\.example\.org\/models\/road\/RoadPatrol\/#route">route<\/a><\/th>/);
  assert.match(subject, /<tr id="RoadPatrol"><th scope="row">.*?<\/th><td><span lang="en">One patrol run\.<\/span><\/td><\/tr>/, 'a type row shows the description');
  assert.match(subject, /for example https:\/\/models\.example\.org\/ns\/road#RoadPatrol\./);
  assert.doesNotMatch(subject, /IRI: https/, 'no full IRI repeated per term');
  assert.match(subject, /Road &lt;b&gt;maintenance&lt;\/b&gt;\./, 'text is escaped');
  // The footer's first line is one short line: publisher, licence, the machine-readable files.
  assert.match(subject, /<p>Published by <a href="https:\/\/example\.org\/">Example Inc\.<\/a> · <a href="https:\/\/spdx\.org\/licenses\/CC0-1\.0\.html">CC0-1\.0<\/a> · <a href="https:\/\/models\.example\.org\/catalog\.json">catalog\.json<\/a> · <a href="https:\/\/models\.example\.org\/llms\.txt">llms\.txt<\/a><\/p>/);
  const model = await read('models/road/RoadPatrol/index.html');
  assert.match(model, /<h3 id="route">route<\/h3>/);
  assert.match(model, /<dt>Extends<\/dt><dd><a href="https:\/\/datamodels\.jp\/ns\/task\/Task">/);
  assert.match(model, /<title>RoadPatrol: Data models by Example Inc\.<\/title>/);
  // The anchor follows the IRI, not the attribute's name.
  const sf = join(dir, 'models', 'road', 'RoadPatrol', 'schema.json');
  const sj = JSON.parse(await readFile(sf, 'utf8'));
  sj.properties.route['x-iri'] = `${BASE}/ns/road#lane`;
  await writeFile(sf, JSON.stringify(sj));
  await buildNode(dir);
  const renamed = await read('ns/road.html');
  assert.ok(renamed.includes('id="lane"') && !renamed.includes('id="route"'), 'the anchor of route is lane');
  // An alias mints no terms: no Terms section and no empty example.
  await writeFile(sf, JSON.stringify({ ...sj, 'x-alias-of': 'https://datamodels.jp/ns/task/Task', properties: Object.fromEntries(Object.entries(sj.properties).map(([k, v]) => [k, v['x-iri'] ? { ...v, 'x-iri': `https://datamodels.jp/ns/task#${k}` } : v])) }));
  await buildNode(dir);
  const aliasOnly = await read('ns/road.html');
  assert.doesNotMatch(aliasOnly, /<h2>Terms<\/h2>|for example \./);
  await writeFile(sf, JSON.stringify(sj));
  // Only http(s) URLs from the sources become links.
  const schemaFile = join(dir, 'models', 'road', 'RoadPatrol', 'schema.json');
  await writeFile(schemaFile, JSON.stringify({ ...JSON.parse(await readFile(schemaFile, 'utf8')), 'x-subclass-of': 'javascript:alert(1)' }));
  await buildNode(dir);
  assert.doesNotMatch(await read('models/road/RoadPatrol/index.html'), /javascript:/);
});

test('pages in every language: the first at the root, the others under /<lang>/, with links between them', async () => {
  const dir = await node({ yaml: NODE_YAML.replace('languages: [en]', 'languages: [ja, en]').replace('name: { en: Example Inc. }', 'name: { ja: 例社, en: Example Inc. }') });
  const road = join(dir, 'models', 'road');
  await writeFile(join(road, 'subject.yaml'), 'name: road\nversion: 0.1.0\nsource: minted\ntitle: { ja: 道路, en: Roads }\ndescription: { ja: 道路の維持管理。, en: Road maintenance. }\n');
  const cat = join(road, 'RoadPatrol', 'catalog.yaml');
  await writeFile(cat, (await readFile(cat, 'utf8')).replace('title: { en: Road patrol }', 'title: { ja: 道路パトロール, en: Road patrol }').replace('description: { en: One patrol run. }', 'description: { ja: 1 回の巡回。, en: One patrol run. }').replace('route: { en: The route patrolled }', 'route: { ja: 巡回したルート, en: The route patrolled }'));
  await writeFile(join(road, 'RoadPatrol', 'notes.yaml'), 'notes:\n  - { ja: 巡回の記録だけを扱う。, en: Only the record of a patrol. }\n');
  await mkdir(join(road, 'RoadPatrol', 'mapping'));
  await writeFile(join(road, 'RoadPatrol', 'mapping', 'city-ledger.yaml'), 'standard:\n  name: { ja: 市の道路台帳, en: The city road ledger }\n  url: https://example.org/ledger\nfields:\n  route: { to: 路線名 }\n');
  const { pages } = await buildNode(dir);
  // One 404.html, at the root: static hosts answer every missing address with it.
  assert.deepEqual(pages, ['404.html', 'en/index.html', 'en/models/road/RoadPatrol/index.html', 'en/ns/road.html', 'index.html', 'models/road/RoadPatrol/index.html', 'ns/road.html']);
  const read = (p) => readFile(join(dir, '_site', p), 'utf8');
  const missing = await read('404.html');
  assert.match(missing, /<html lang="ja">/);
  assert.match(missing, /<h1 lang="ja">ページが見つかりません<\/h1>/);
  assert.match(missing, /<p>公開：<a href="https:\/\/example\.org\/">例社<\/a> · <a href="https:\/\/spdx\.org\/licenses\/CC0-1\.0\.html">CC0-1\.0<\/a> · /);
  assert.match(missing, /<p lang="ja">このアドレスにページはありません。/);
  assert.match(missing, /<p lang="en">There is no page at this address\./);
  assert.match(missing, /<meta name="robots" content="noindex">/);
  assert.doesNotMatch(missing, /rel="canonical"|<link rel="alternate" hreflang=|og:url/, 'it answers at any address');
  assert.match(missing, /<li><a href="https:\/\/models\.example\.org\/models\/road\/RoadPatrol\/">road\/RoadPatrol<\/a><\/li>/);
  const ja = await read('models/road/RoadPatrol/index.html');
  const en = await read('en/models/road/RoadPatrol/index.html');
  assert.match(ja, /<html lang="ja">/);
  assert.match(ja, /<title>RoadPatrol：例社 のデータモデル<\/title>/);
  assert.match(ja, /<meta name="description" content="1 回の巡回。">/);
  assert.match(ja, /<link rel="canonical" href="https:\/\/models\.example\.org\/models\/road\/RoadPatrol\/">/);
  assert.match(ja, /<link rel="alternate" hreflang="en" href="https:\/\/models\.example\.org\/en\/models\/road\/RoadPatrol\/">/);
  assert.match(ja, /<link rel="alternate" hreflang="x-default" href="https:\/\/models\.example\.org\/models\/road\/RoadPatrol\/">/);
  assert.match(ja, /<span lang="ja">日本語<\/span> \| <a href="https:\/\/models\.example\.org\/en\/models\/road\/RoadPatrol\/" hreflang="en" lang="en">English<\/a>/);
  assert.match(ja, /<dt>段階<\/dt><dd>試行<\/dd>/);
  // Why the model is as it is: the standards it maps and its notes, in the page's language.
  assert.match(ja, /<h2>参照している標準<\/h2>\n<ul>\n<li><a href="https:\/\/example\.org\/ledger" lang="ja">市の道路台帳<\/a>（<a href="https:\/\/models\.example\.org\/mapping\/road\/RoadPatrol\/city-ledger\.yaml">対応表<\/a>）<\/li>/);
  assert.match(ja, /<h2>注記<\/h2>\n<ul>\n<li lang="ja">巡回の記録だけを扱う。<\/li>/);
  assert.match(en, /<h2>Standards referenced<\/h2>[\s\S]*The city road ledger[\s\S]*<h2>Notes<\/h2>\n<ul>\n<li lang="en">Only the record of a patrol\.<\/li>/);
  // Each text once, in the page's language.
  assert.ok(ja.includes('道路パトロール') && !ja.includes('Road patrol'));
  assert.match(en, /<html lang="en">/);
  assert.match(en, /<title>RoadPatrol: Data models by Example Inc\.<\/title>/);
  assert.match(en, /<meta property="og:locale" content="en_US">/);
  assert.match(en, /<meta property="og:locale:alternate" content="ja_JP">/);
  assert.match(en, /<a href="https:\/\/models\.example\.org\/en\/ns\/road">road<\/a>/, 'links stay in the language');
  assert.ok(en.includes('Road patrol') && !en.includes('道路パトロール'));
  // The generator, in a meta tag and the footer.
  const { version } = JSON.parse(await readFile(join(import.meta.dirname, '..', 'package.json'), 'utf8'));
  assert.ok(ja.includes(`<meta name="generator" content="datamodels-toolkit ${version}">`));
  assert.match(en, /Made with <a href="https:\/\/github\.com\/geolonia\/datamodels-toolkit">datamodels-toolkit<\/a>/);
  assert.match(ja, /<a href="https:\/\/datamodels\.jp\/toolkit\/">ガイド<\/a>/);
  assert.match(en, /<a href="https:\/\/datamodels\.jp\/en\/toolkit\/">the guide<\/a>/);
  // The English page URL goes into catalog.json, as datamodels.jp's pageUrlEn.
  const catalog = JSON.parse(await read('catalog.json'));
  assert.equal(catalog.models[0].pageUrlEn, `${BASE}/en/models/road/RoadPatrol/`);
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

test('a language without a known territory gets no Open Graph locale', async () => {
  const dir = await node({ yaml: NODE_YAML.replace('languages: [en]', 'languages: [en, fr]').replace('name: { en: Example Inc. }', 'name: { en: Example Inc., fr: Exemple }') });
  const road = join(dir, 'models', 'road');
  await writeFile(join(road, 'subject.yaml'), 'name: road\nversion: 0.1.0\nsource: minted\ntitle: { en: Roads, fr: Routes }\ndescription: { en: Road maintenance., fr: Entretien des routes. }\n');
  const cat = join(road, 'RoadPatrol', 'catalog.yaml');
  await writeFile(cat, (await readFile(cat, 'utf8')).replace('title: { en: Road patrol }', 'title: { en: Road patrol, fr: Patrouille }').replace('description: { en: One patrol run. }', 'description: { en: One patrol run., fr: Une patrouille. }').replace('route: { en: The route patrolled }', 'route: { en: The route patrolled, fr: Le parcours }'));
  await buildNode(dir);
  const fr = await readFile(join(dir, '_site', 'fr', 'index.html'), 'utf8');
  assert.match(fr, /<html lang="fr">/);
  assert.doesNotMatch(fr, /og:locale/);
  // The 404 page marks the English fallback text as English, not as French.
  const missing = await readFile(join(dir, '_site', '404.html'), 'utf8');
  assert.match(missing, /<p lang="en">There is no page at this address\./);
  assert.doesNotMatch(missing, /<p lang="fr">/);
  const en = await readFile(join(dir, '_site', 'index.html'), 'utf8');
  assert.match(en, /<meta property="og:locale" content="en_US">/);
  assert.doesNotMatch(en, /og:locale:alternate/);
});
