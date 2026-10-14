// datamodels check (#12), with a stand-in for the network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { checkNode, buildNode, loadSubjects, catalogUrls, snapshotRelease, contextTerms } from '../src/build/index.mjs';

const run = promisify(execFile);
const BIN = join(import.meta.dirname, '..', 'bin', 'datamodels.mjs');
const datamodels = (...args) => run(process.execPath, [BIN, ...args]).then((r) => ({ code: 0, ...r }), (e) => ({ code: e.code, stdout: e.stdout, stderr: e.stderr }));
const BASE = 'https://models.example.org';
const TASK = 'https://datamodels.jp/ns/task/Task';
const INDEX = 'https://datamodels.jp/catalog.json';
const TASK_CONTEXT = 'https://datamodels.jp/context/task/v1.0.0.jsonld';

async function node() {
  const dir = await mkdtemp(join(tmpdir(), 'datamodels-check-'));
  await writeFile(join(dir, 'node.yaml'), `baseUrl: ${BASE}\npublisher: { name: { en: Example }, url: https://example.org/ }\nlicense: CC0-1.0\n`);
  const m = join(dir, 'models', 'road', 'RoadPatrol');
  await mkdir(join(m, 'examples'), { recursive: true });
  await writeFile(join(dir, 'models', 'road', 'subject.yaml'), 'name: road\nversion: 0.1.0\nsource: minted\ntitle: { en: Roads }\ndescription: { en: Roads. }\n');
  await writeFile(join(dir, 'models', 'road', 'context.jsonld'), JSON.stringify({ '@context': { road: `${BASE}/ns/road#`, RoadPatrol: 'road:RoadPatrol', route: 'road:route' } }));
  await writeFile(join(m, 'schema.json'), JSON.stringify({ $id: `${BASE}/schema/road/RoadPatrol/v0.1.0.json`, type: 'object', required: ['id', 'type'], properties: { id: { type: 'string' }, type: { const: 'RoadPatrol' }, route: { type: 'string', 'x-iri': `${BASE}/ns/road#route` } } }));
  await writeFile(join(m, 'catalog.yaml'), `title: { en: Road patrol }\ndescription: { en: A run. }\nattributes:\n  route: { en: The route }\nextends:\n  - { typeIri: ${TASK}, version: 1.0.0, index: ${INDEX} }\n`);
  await writeFile(join(m, 'examples', 'example.json'), JSON.stringify({ id: 'urn:ngsi-ld:RoadPatrol:1', type: 'RoadPatrol', route: 'R1' }));
  return dir;
}

/** List `nodes` in node.yaml, so their contexts may be imported. */
async function listNodes(dir, nodes) {
  const file = join(dir, 'node.yaml');
  await writeFile(file, `${await readFile(file, 'utf8')}nodes:\n${nodes.map((n) => `  - { url: ${n.url}, index: ${n.index} }\n`).join('')}`);
}

/** A stand-in for fetch: `files` maps URLs to bodies (objects as JSON); anything else is a 404, or `fail` throws. */
const fakeFetch = (files, { fail = [] } = {}) => async (url) => {
  if (fail.some((f) => url.startsWith(f))) throw new TypeError('fetch failed', { cause: { code: 'ENOTFOUND' } });
  if (!(url in files)) return new Response('not found', { status: 404 });
  const body = files[url];
  return new Response(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body), { status: 200 });
};
const datamodelsJp = (terms = { task: 'https://datamodels.jp/ns/task/', Task: 'task:Task', due: 'task:due' }) => ({
  [INDEX]: { models: [{ typeIri: TASK, version: '1.0.0', contextUrl: TASK_CONTEXT }] },
  [TASK_CONTEXT]: { '@context': terms },
});

test('a valid node passes, offline and online', async () => {
  const dir = await node();
  let r = await checkNode(dir, { offline: true });
  assert.deepEqual(r.problems, []);
  assert.match(r.notes[0], /^offline/);
  // Online: nothing published yet (every exact file is a 404), the extended model is listed.
  r = await checkNode(dir, { fetch: fakeFetch(datamodelsJp()) });
  assert.deepEqual(r, { problems: [], notes: [] });
});

test('an invalid example or schema is a problem', async () => {
  const dir = await node();
  const m = join(dir, 'models', 'road', 'RoadPatrol');
  await writeFile(join(m, 'examples', 'example.json'), JSON.stringify({ id: 'urn:ngsi-ld:RoadPatrol:1', type: 'RoadPatrol', route: 7 }));
  let r = await checkNode(dir, { offline: true });
  assert.deepEqual(r.problems, ['road/RoadPatrol/examples/example.json: data/route must be string']);
  const schema = JSON.parse(await readFile(join(m, 'schema.json'), 'utf8'));
  await writeFile(join(m, 'schema.json'), JSON.stringify({ ...schema, properties: { ...schema.properties, route: { type: 'text', 'x-iri': `${BASE}/ns/road#route` } } }));
  r = await checkNode(dir, { offline: true });
  assert.equal(r.problems.length, 1);
  assert.match(r.problems[0], /^road\/RoadPatrol\/schema\.json: .*type/);
});

test('a file in examples/ other than the example is noted, not read', async () => {
  const dir = await node();
  const m = join(dir, 'models', 'road', 'RoadPatrol');
  await writeFile(join(m, 'examples', 'night-patrol.json'), JSON.stringify({ id: 'urn:ngsi-ld:RoadPatrol:2', type: 'RoadPatrol', route: 7 }));
  await writeFile(join(m, 'examples', '.DS_Store'), '');
  const r = await checkNode(dir, { offline: true });
  assert.deepEqual(r.problems, [], 'it is not validated, so its wrong route is no problem');
  assert.deepEqual(r.notes.filter((n) => n.includes('examples/')), ['road/RoadPatrol/examples/night-patrol.json: not read; a model has one example, example.json (and example-normalized.jsonld)']);
});

test('a release snapshot that differs from the sources is a problem', async () => {
  const dir = await node();
  const urls = catalogUrls(BASE, { iris: 'hash' });
  const [subject] = await loadSubjects(join(dir, 'models'), { urls, languages: ['en'], subjectFields: ['title', 'description'] });
  await snapshotRelease(subject, { urls, languages: ['en'] });
  assert.deepEqual((await checkNode(dir, { offline: true })).problems, []);
  const m = join(dir, 'models', 'road', 'RoadPatrol', 'catalog.yaml');
  await writeFile(m, (await readFile(m, 'utf8')).replace('The route', 'The route taken'));
  assert.match((await checkNode(dir, { offline: true })).problems.join('\n'), /road v0\.1\.0 was published and its files would change; give the subject a new version \(datamodels bump\):\n {2}road v0\.1\.0 vocabulary: snapshot differs from the sources/);
  // Not the end of the check: another problem is listed with it.
  const s = join(dir, 'models', 'road', 'RoadPatrol', 'schema.json');
  await writeFile(s, (await readFile(s, 'utf8')).replace('"type":"object"', '"type":"object","x-subclass-of":"Patrol"'));
  const both = (await checkNode(dir, { offline: true })).problems.join('\n');
  assert.match(both, /snapshot differs from the sources/);
  assert.match(both, /x-subclass-of must be the full http\(s\) IRI of a class/);
  // During the pre-release the snapshot is corrected too.
  const yaml = join(dir, 'node.yaml');
  await writeFile(yaml, `${await readFile(yaml, 'utf8')}prerelease: true\n`);
  assert.match((await checkNode(dir, { offline: true })).problems.join('\n'), /during the pre-release \(prerelease: true in node\.yaml\) correct the snapshot too: remove models\/road\/releases\/v0\.1\.0\/ and run datamodels release road/);
});

test('an exact version already online must not change', async () => {
  const dir = await node();
  const site = await mkdtemp(join(tmpdir(), 'datamodels-online-'));
  const { exactPaths } = await buildNode(dir, { out: site, pages: false });
  const online = Object.fromEntries(await Promise.all(exactPaths.map(async (p) => [`${BASE}${p}`, await readFile(join(site, p.slice(1)))])));
  assert.deepEqual((await checkNode(dir, { fetch: fakeFetch({ ...online, ...datamodelsJp() }) })).problems, [], 'the same bytes online');
  online[`${BASE}/context/road/v0.1.0.jsonld`] = '{}';
  assert.deepEqual((await checkNode(dir, { fetch: fakeFetch({ ...online, ...datamodelsJp() }) })).problems, [
    `${BASE}/context/road/v0.1.0.jsonld: a published version changed. A published file never changes; give the subject a new version instead.`,
  ]);
});

test('extends: a redefined term or a missing model is a problem, an unreachable node only a note', async () => {
  const dir = await node();
  let r = await checkNode(dir, { fetch: fakeFetch(datamodelsJp({ task: 'https://datamodels.jp/ns/task/', route: 'task:route' })) });
  assert.deepEqual(r.problems, [`road/RoadPatrol: extends ${TASK} v1.0.0: redefines route (https://datamodels.jp/ns/task/route there, ${BASE}/ns/road#route here)`]);
  // Reusing a term of the extended model: its context is imported, so its prefix is defined.
  const ctx = join(dir, 'models', 'road', 'context.jsonld');
  const schemaFile = join(dir, 'models', 'road', 'RoadPatrol', 'schema.json');
  const schema = JSON.parse(await readFile(schemaFile, 'utf8'));
  schema.properties.route['x-iri'] = 'https://datamodels.jp/ns/task/route';
  await writeFile(schemaFile, JSON.stringify(schema));
  await listNodes(dir, [{ url: 'https://datamodels.jp/', index: INDEX }]);
  await writeFile(ctx, JSON.stringify({ '@context': [TASK_CONTEXT, { road: `${BASE}/ns/road#`, RoadPatrol: 'road:RoadPatrol', route: 'task:route' }] }));
  r = await checkNode(dir, { fetch: fakeFetch(datamodelsJp({ task: 'https://datamodels.jp/ns/task/', route: 'task:route' })) });
  assert.deepEqual(r.problems, []);
  // Without the import, task: is no prefix, and route would expand to the IRI "task:route".
  await writeFile(ctx, JSON.stringify({ '@context': { road: `${BASE}/ns/road#`, RoadPatrol: 'road:RoadPatrol', route: 'task:route' } }));
  r = await checkNode(dir, { fetch: fakeFetch(datamodelsJp({ task: 'https://datamodels.jp/ns/task/', route: 'task:route' })) });
  assert.deepEqual(r.problems, ['road/RoadPatrol: the @context maps route to task:route, which is not a full IRI (is its prefix defined?)']);
  await writeFile(ctx, JSON.stringify({ '@context': { road: `${BASE}/ns/road#`, RoadPatrol: 'road:RoadPatrol', route: 'road:route' } }));
  schema.properties.route['x-iri'] = `${BASE}/ns/road#route`;
  await writeFile(schemaFile, JSON.stringify(schema));
  r = await checkNode(dir, { fetch: fakeFetch({ [INDEX]: { models: [] } }) });
  assert.deepEqual(r.problems, [`road/RoadPatrol: extends ${TASK} v1.0.0: not listed in ${INDEX}`]);
  r = await checkNode(dir, { fetch: fakeFetch({}, { fail: ['https://datamodels.jp/'] }) });
  assert.deepEqual(r, { problems: [], notes: [`road/RoadPatrol: extends ${TASK} v1.0.0: not checked, ENOTFOUND`] });
  // One that hangs, the same once the time is up.
  const hanging = (url, { signal }) => (url.startsWith(BASE) ? fakeFetch({})(url) : new Promise((_, reject) => signal.addEventListener('abort', () => reject(signal.reason))));
  r = await checkNode(dir, { fetch: hanging, timeout: 50 });
  assert.deepEqual(r.problems, []);
  assert.match(r.notes[0], /extends .*: not checked, .*(timed out|aborted)/i);
});

test('every type and attribute is a term of the @context, with the IRI of the schema (#26)', async () => {
  const dir = await node();
  const ctx = join(dir, 'models', 'road', 'context.jsonld');
  const schemaFile = join(dir, 'models', 'road', 'RoadPatrol', 'schema.json');
  const schema = JSON.parse(await readFile(schemaFile, 'utf8'));
  const write = (context) => writeFile(ctx, JSON.stringify({ '@context': context }));
  const problems = async () => (await checkNode(dir, { offline: true })).problems;
  // Missing from the @context: JSON-LD would drop route.
  await write({ road: `${BASE}/ns/road#`, RoadPatrol: 'road:RoadPatrol' });
  assert.deepEqual(await problems(), ['road/RoadPatrol: the attribute route is not in the @context']);
  // Another IRI than the schema's x-iri.
  await write({ road: `${BASE}/ns/road#`, RoadPatrol: 'road:RoadPatrol', route: 'https://other.example/route' });
  assert.deepEqual(await problems(), [`road/RoadPatrol: route is ${BASE}/ns/road#route in the schema, but the @context expands it to https://other.example/route`]);
  // The type, missing or under another IRI.
  await write({ road: `${BASE}/ns/road#`, route: 'road:route' });
  assert.deepEqual(await problems(), ['road/RoadPatrol: the type RoadPatrol is not in the @context']);
  await write({ road: `${BASE}/ns/road#`, RoadPatrol: 'road:Patrol', route: 'road:route' });
  assert.deepEqual(await problems(), [`road/RoadPatrol: RoadPatrol is ${BASE}/ns/road#RoadPatrol in the schema, but the @context expands it to ${BASE}/ns/road#Patrol`]);
  // A core term needs no definition; redefining one is a problem.
  schema.properties.location = { type: 'object', 'x-iri': 'https://uri.etsi.org/ngsi-ld/location' };
  await writeFile(schemaFile, JSON.stringify(schema));
  const yaml = join(dir, 'models', 'road', 'RoadPatrol', 'catalog.yaml');
  await writeFile(yaml, (await readFile(yaml, 'utf8')).replace('  route: { en: The route }', '  route: { en: The route }\n  location: { en: Where }'));
  await write({ road: `${BASE}/ns/road#`, RoadPatrol: 'road:RoadPatrol', route: 'road:route' });
  assert.deepEqual(await problems(), []);
  await write({ road: `${BASE}/ns/road#`, RoadPatrol: 'road:RoadPatrol', route: 'road:route', location: 'road:location' });
  assert.deepEqual(await problems(), [
    'road/context.jsonld: redefines the NGSI-LD core term location (https://uri.etsi.org/ngsi-ld/location)',
    `road/RoadPatrol: location is https://uri.etsi.org/ngsi-ld/location in the schema, but the @context expands it to ${BASE}/ns/road#location`,
  ]);
});

test('a term from a context imported by URL: checked online, noted offline or when it cannot be read', async () => {
  const dir = await node();
  const shared = 'https://shared.example.org/context/common/v1.0.0.jsonld';
  await listNodes(dir, [{ url: 'https://shared.example.org/', index: 'https://shared.example.org/catalog.json' }]);
  await writeFile(join(dir, 'models', 'road', 'context.jsonld'), JSON.stringify({ '@context': [shared, { road: `${BASE}/ns/road#`, RoadPatrol: 'road:RoadPatrol' }] }));
  const sharedRoute = { [shared]: { '@context': { route: `${BASE}/ns/road#route` } } };
  // Online: route is found in the imported context.
  assert.deepEqual(await checkNode(dir, { fetch: fakeFetch({ ...datamodelsJp(), ...sharedRoute }) }), { problems: [], notes: [] });
  // There under another IRI: a problem.
  const r = await checkNode(dir, { fetch: fakeFetch({ ...datamodelsJp(), [shared]: { '@context': { route: 'https://other.example/route' } } }) });
  assert.deepEqual(r.problems, [`road/RoadPatrol: route is ${BASE}/ns/road#route in the schema, but the @context expands it to https://other.example/route`]);
  // Offline, or the import cannot be read: a term not found here is only noted.
  let o = await checkNode(dir, { offline: true });
  assert.deepEqual(o.problems, []);
  assert.match(o.notes.join('\n'), /road\/RoadPatrol: the attribute route is not in the @context, or a context it imports that could not be read may change that/);
  o = await checkNode(dir, { fetch: fakeFetch(datamodelsJp(), { fail: ['https://shared.example.org/'] }) });
  assert.deepEqual(o.problems, []);
  assert.match(o.notes.join('\n'), /road\/context\.jsonld: https:\/\/shared\.example\.org\/context\/common\/v1\.0\.0\.jsonld could not be read \(ENOTFOUND\)/);
});

test('the parts of an @context count in their order: a later import overrides an earlier inline term', async () => {
  const dir = await node();
  const shared = 'https://shared.example.org/context/common/v1.0.0.jsonld';
  await listNodes(dir, [{ url: 'https://shared.example.org/', index: 'https://shared.example.org/catalog.json' }]);
  const served = { ...datamodelsJp(), [shared]: { '@context': { route: 'https://other.example/route' } } };
  const ctx = join(dir, 'models', 'road', 'context.jsonld');
  const own = { road: `${BASE}/ns/road#`, RoadPatrol: 'road:RoadPatrol', route: 'road:route' };
  // The import first, the node's own route after it: the node's IRI wins.
  await writeFile(ctx, JSON.stringify({ '@context': [shared, own] }));
  assert.deepEqual((await checkNode(dir, { fetch: fakeFetch(served) })).problems, []);
  // The import after: its route wins, and differs from the schema's.
  await writeFile(ctx, JSON.stringify({ '@context': [own, shared] }));
  assert.deepEqual((await checkNode(dir, { fetch: fakeFetch(served) })).problems, [`road/RoadPatrol: route is ${BASE}/ns/road#route in the schema, but the @context expands it to https://other.example/route`]);
  // null clears what came before it.
  await writeFile(ctx, JSON.stringify({ '@context': [{ route: 'https://other.example/route' }, null, own] }));
  assert.deepEqual((await checkNode(dir, { offline: true })).problems, []);
});

test('resolving the @context as JSON-LD does: repeats, resets, unread imports, core terms', async () => {
  const dir = await node();
  const shared = 'https://shared.example.org/context/common/v1.0.0.jsonld';
  const reset = 'https://shared.example.org/context/reset/v1.0.0.jsonld';
  await listNodes(dir, [{ url: 'https://shared.example.org/', index: 'https://shared.example.org/catalog.json' }]);
  const served = { ...datamodelsJp(), [shared]: { '@context': { route: `${BASE}/ns/road#route` } }, [reset]: { '@context': [null, { road: `${BASE}/ns/road#`, RoadPatrol: 'road:RoadPatrol' }] } };
  const ctx = join(dir, 'models', 'road', 'context.jsonld');
  const write = (c) => writeFile(ctx, JSON.stringify({ '@context': c }));
  const head = { road: `${BASE}/ns/road#`, RoadPatrol: 'road:RoadPatrol' };
  const online = async () => checkNode(dir, { fetch: fakeFetch(served) });
  // The same import again, after an inline route: it applies again.
  await write([shared, { ...head, route: 'https://other.example/route' }, shared]);
  assert.deepEqual((await online()).problems, []);
  // An imported context that starts with null clears what came before it, route included.
  await write([{ ...head, route: 'road:route' }, reset]);
  assert.deepEqual((await online()).problems, ['road/RoadPatrol: the attribute route is not in the @context']);
  // An inline route that does not match, then an import that cannot be read: only noted, it may fix it.
  await write([{ ...head, route: 'https://other.example/route' }, shared]);
  let r = await checkNode(dir, { offline: true });
  assert.deepEqual(r.problems, []);
  assert.match(r.notes.join('\n'), /route is .* in the schema, but the @context expands it to https:\/\/other\.example\/route, or a context it imports that could not be read may change that/);
  // The same mismatch after the import is certain.
  await write([shared, { ...head, route: 'https://other.example/route' }]);
  assert.deepEqual((await checkNode(dir, { offline: true })).problems, [`road/RoadPatrol: route is ${BASE}/ns/road#route in the schema, but the @context expands it to https://other.example/route`]);
  // A core term redefined by an import, or removed with null.
  served[shared] = { '@context': { route: `${BASE}/ns/road#route`, location: 'https://other.example/location' } };
  await write([{ ...head }, shared]);
  assert.deepEqual((await online()).problems, ['road/context.jsonld: redefines the NGSI-LD core term location (https://uri.etsi.org/ngsi-ld/location)']);
  served[shared] = { '@context': { route: `${BASE}/ns/road#route` } };
  const schemaFile = join(dir, 'models', 'road', 'RoadPatrol', 'schema.json');
  const schema = JSON.parse(await readFile(schemaFile, 'utf8'));
  schema.properties.location = { type: 'object', 'x-iri': 'https://uri.etsi.org/ngsi-ld/location' };
  await writeFile(schemaFile, JSON.stringify(schema));
  const yaml = join(dir, 'models', 'road', 'RoadPatrol', 'catalog.yaml');
  await writeFile(yaml, (await readFile(yaml, 'utf8')).replace('  route: { en: The route }', '  route: { en: The route }\n  location: { en: Where }'));
  await write([shared, { ...head, location: null }]);
  assert.deepEqual((await online()).problems, ['road/context.jsonld: removes the NGSI-LD core term location (https://uri.etsi.org/ngsi-ld/location)', 'road/RoadPatrol: the attribute location is not in the @context']);
  // A context that imports itself is refused.
  served[shared] = { '@context': [shared] };
  await write([shared, head]);
  assert.match((await online()).problems.join('\n'), /imports itself/);
});

test('a term keeps the IRI it got where it was defined; a later prefix does not change it', async () => {
  const dir = await node();
  const shared = 'https://shared.example.org/context/common/v1.0.0.jsonld';
  await listNodes(dir, [{ url: 'https://shared.example.org/', index: 'https://shared.example.org/catalog.json' }]);
  const served = { ...datamodelsJp(), [shared]: { '@context': { r: `${BASE}/ns/road#`, route: 'r:route' } } };
  const ctx = join(dir, 'models', 'road', 'context.jsonld');
  const head = { road: `${BASE}/ns/road#`, RoadPatrol: 'road:RoadPatrol' };
  // route was defined in the import with r: as it was there; redefining r afterwards changes nothing.
  await writeFile(ctx, JSON.stringify({ '@context': [shared, { ...head, r: 'https://other.example/' }] }));
  assert.deepEqual((await checkNode(dir, { fetch: fakeFetch(served) })).problems, []);
  // A term after an unread import, with a prefix from before it: that import may redefine the prefix, so only a note.
  await writeFile(ctx, JSON.stringify({ '@context': [{ ...head, p: 'https://other.example/' }, shared, { route: 'p:route' }] }));
  const r = await checkNode(dir, { offline: true });
  assert.deepEqual(r.problems, []);
  assert.match(r.notes.join('\n'), /route is .* in the schema, but the @context expands it to https:\/\/other\.example\/route, or a context it imports/);
});

test('a prefix defined through another prefix is expanded in full', async () => {
  const dir = await node();
  await writeFile(join(dir, 'models', 'road', 'context.jsonld'), JSON.stringify({ '@context': { base: `${BASE}/ns/`, road: 'base:road#', RoadPatrol: 'road:RoadPatrol', route: 'road:route' } }));
  assert.deepEqual((await checkNode(dir, { offline: true })).problems, []);
  assert.deepEqual([...contextTerms({ a: 'b:x/', b: 'a:y/', t: 'a:t' })].find(([k]) => k === 't'), ['t', 'a:y/x/t']);
});

test('the extends check sees terms this subject imports from elsewhere', async () => {
  const dir = await node();
  const shared = 'https://shared.example.org/context/common/v1.0.0.jsonld';
  await listNodes(dir, [{ url: 'https://shared.example.org/', index: 'https://shared.example.org/catalog.json' }]);
  // The shared context redefines due, a term of the extended Task.
  const served = { ...datamodelsJp(), [shared]: { '@context': { due: 'https://shared.example.org/ns/due' } } };
  await writeFile(join(dir, 'models', 'road', 'context.jsonld'), JSON.stringify({ '@context': [shared, { road: `${BASE}/ns/road#`, RoadPatrol: 'road:RoadPatrol', route: 'road:route' }] }));
  assert.deepEqual((await checkNode(dir, { fetch: fakeFetch(served) })).problems, [`road/RoadPatrol: extends ${TASK} v1.0.0: redefines due (https://datamodels.jp/ns/task/due there, https://shared.example.org/ns/due here)`]);
});

test('imports of an imported context are followed: datamodels.jp subjects import its common context', async () => {
  const dir = await node();
  await listNodes(dir, [{ url: 'https://datamodels.jp/', index: INDEX }]);
  const common = 'https://datamodels.jp/context/common/v1.0.0.jsonld';
  const files = {
    ...datamodelsJp([common, { task: 'https://datamodels.jp/ns/task/', Task: 'task:Task' }]),
    [common]: { '@context': { common: 'https://datamodels.jp/ns/common/', address: 'common:address' } },
  };
  const schemaFile = join(dir, 'models', 'road', 'RoadPatrol', 'schema.json');
  const schema = JSON.parse(await readFile(schemaFile, 'utf8'));
  schema.properties.address = { type: 'object', 'x-iri': 'https://datamodels.jp/ns/common/address' };
  await writeFile(schemaFile, JSON.stringify(schema));
  const yaml = join(dir, 'models', 'road', 'RoadPatrol', 'catalog.yaml');
  await writeFile(yaml, (await readFile(yaml, 'utf8')).replace('  route: { en: The route }', '  route: { en: The route }\n  address: { en: Where }'));
  const ctx = join(dir, 'models', 'road', 'context.jsonld');
  // address comes from the common context, which the task context imports.
  await writeFile(ctx, JSON.stringify({ '@context': [TASK_CONTEXT, { road: `${BASE}/ns/road#`, RoadPatrol: 'road:RoadPatrol', route: 'road:route' }] }));
  assert.deepEqual(await checkNode(dir, { fetch: fakeFetch(files) }), { problems: [], notes: [] });
  // Redefining it here is caught by the extends check too, through the same import.
  await writeFile(ctx, JSON.stringify({ '@context': [TASK_CONTEXT, { road: `${BASE}/ns/road#`, RoadPatrol: 'road:RoadPatrol', route: 'road:route', address: 'road:address' }] }));
  schema.properties.address['x-iri'] = `${BASE}/ns/road#address`;
  await writeFile(schemaFile, JSON.stringify(schema));
  assert.deepEqual((await checkNode(dir, { fetch: fakeFetch(files) })).problems, [`road/RoadPatrol: extends ${TASK} v1.0.0: redefines address (https://datamodels.jp/ns/common/address there, ${BASE}/ns/road#address here)`]);
  // The common context cannot be read: noted.
  const { [common]: _, ...withoutCommon } = files;
  const r = await checkNode(dir, { fetch: fakeFetch(withoutCommon) });
  assert.deepEqual(r.problems, []);
  assert.match(r.notes.join('\n'), /road\/context\.jsonld: https:\/\/datamodels\.jp\/context\/common\/v1\.0\.0\.jsonld could not be read \(.*HTTP 404\)/);
});

test('a schema that references another model of the node', async () => {
  const dir = await node();
  // A value type, and RoadPatrol's route referencing it by its URL.
  const seg = join(dir, 'models', 'road', 'Segment');
  await mkdir(seg, { recursive: true });
  await writeFile(join(seg, 'schema.json'), JSON.stringify({ $id: `${BASE}/schema/road/Segment/v0.1.0.json`, 'x-kind': 'value', type: 'object', properties: { from: { type: 'string', 'x-iri': `${BASE}/ns/road#from` } } }));
  await writeFile(join(seg, 'catalog.yaml'), 'title: { en: Segment }\ndescription: { en: A part of a road. }\nattributes:\n  from: { en: Start }\n');
  await writeFile(join(dir, 'models', 'road', 'context.jsonld'), JSON.stringify({ '@context': { road: `${BASE}/ns/road#`, RoadPatrol: 'road:RoadPatrol', route: 'road:route', from: 'road:from' } }));
  const m = join(dir, 'models', 'road', 'RoadPatrol');
  const schema = JSON.parse(await readFile(join(m, 'schema.json'), 'utf8'));
  schema.properties.route = { $ref: `${BASE}/schema/road/Segment/v0.1.0.json`, 'x-iri': `${BASE}/ns/road#route` };
  await writeFile(join(m, 'schema.json'), JSON.stringify(schema));
  await writeFile(join(m, 'examples', 'example.json'), JSON.stringify({ id: 'urn:ngsi-ld:RoadPatrol:1', type: 'RoadPatrol', route: { from: 'A' } }));
  assert.deepEqual((await checkNode(dir, { offline: true })).problems, []);
  await writeFile(join(m, 'examples', 'example.json'), JSON.stringify({ id: 'urn:ngsi-ld:RoadPatrol:1', type: 'RoadPatrol', route: { from: 1 } }));
  assert.deepEqual((await checkNode(dir, { offline: true })).problems, ['road/RoadPatrol/examples/example.json: data/route/from must be string']);
});

test('extends an older version than the index lists', async () => {
  const dir = await node();
  const older = 'https://datamodels.jp/context/task/v1.0.0.jsonld';
  const files = {
    [INDEX]: { models: [{ typeIri: TASK, version: '1.1.0', contextUrl: 'https://datamodels.jp/context/task/v1.1.0.jsonld' }] },
    [older]: { '@context': { task: 'https://datamodels.jp/ns/task/', route: 'task:route' } },
  };
  // The terms of v1.0.0, which the model extends, are compared.
  assert.deepEqual((await checkNode(dir, { fetch: fakeFetch(files) })).problems, [`road/RoadPatrol: extends ${TASK} v1.0.0: redefines route (https://datamodels.jp/ns/task/route there, ${BASE}/ns/road#route here)`]);
});

test('a schema on another site that cannot be read is a note, not a problem', async () => {
  const dir = await node();
  const m = join(dir, 'models', 'road', 'RoadPatrol');
  const schema = JSON.parse(await readFile(join(m, 'schema.json'), 'utf8'));
  schema.properties.address = { $ref: 'https://datamodels.jp/schema/common/JapaneseAddress/v1.0.0.json', 'x-iri': `${BASE}/ns/road#address` };
  await writeFile(join(m, 'schema.json'), JSON.stringify(schema));
  const yaml = join(m, 'catalog.yaml');
  await writeFile(yaml, (await readFile(yaml, 'utf8')).replace('  route: { en: The route }', '  route: { en: The route }\n  address: { en: Where }'));
  await writeFile(join(dir, 'models', 'road', 'context.jsonld'), JSON.stringify({ '@context': { road: `${BASE}/ns/road#`, RoadPatrol: 'road:RoadPatrol', route: 'road:route', address: 'road:address' } }));
  let r = await checkNode(dir, { offline: true });
  assert.deepEqual(r.problems, []);
  assert.match(r.notes.join('\n'), /road\/RoadPatrol\/schema\.json: not validated, https:\/\/datamodels\.jp\/schema\/common\/JapaneseAddress\/v1\.0\.0\.json is on another site/);
  r = await checkNode(dir, { fetch: fakeFetch(datamodelsJp(), { fail: ['https://datamodels.jp/schema/'] }) });
  assert.deepEqual(r.problems, []);
  assert.match(r.notes.join('\n'), /schema\.json: not validated, .*JapaneseAddress.* could not be read \(ENOTFOUND\)/);
});

test('a published file whose body breaks off is a note', async () => {
  const dir = await node();
  const broken = (url) => (url.startsWith(`${BASE}/context/`)
    ? Promise.resolve({ ok: true, status: 200, arrayBuffer: () => Promise.reject(new TypeError('terminated', { cause: { code: 'UND_ERR_SOCKET' } })) })
    : fakeFetch(datamodelsJp())(url));
  const r = await checkNode(dir, { fetch: broken });
  assert.deepEqual(r.problems, []);
  assert.match(r.notes.join('\n'), /context\/road\/v0\.1\.0\.jsonld: not reachable \(UND_ERR_SOCKET\), not compared/);
});

test('an extended context without @context is a problem', async () => {
  const dir = await node();
  const r = await checkNode(dir, { fetch: fakeFetch({ ...datamodelsJp(), [TASK_CONTEXT]: {} }) });
  assert.deepEqual(r.problems, [`road/RoadPatrol: extends ${TASK} v1.0.0: ${TASK_CONTEXT} has no @context`]);
});

test('datamodels check exits with 1 on a problem', async () => {
  const dir = await node();
  let r = await datamodels('check', dir, '--offline');
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stderr, /note: offline/);
  await writeFile(join(dir, 'models', 'road', 'RoadPatrol', 'examples', 'example.json'), '{"id": "urn:ngsi-ld:RoadPatrol:x"}');
  r = await datamodels('check', dir, '--offline');
  assert.equal(r.code, 1);
  assert.match(r.stderr, /example\.json: data must have required property 'type'\n.*1 problem\(s\)/);
});

/** A DNS stand-in that answers `address` for every host name, for the real publicFetch. */
const dnsSays = (address) => async (url, o) => {
  const { publicFetch } = await import('../src/adapters/net.mjs');
  return publicFetch(url, { ...o, lookup: (host, opts, callback) => callback(null, [{ address, family: 4 }]) });
};

test('extends: an index whose address in catalog.yaml may not be read is a problem; a refusal on the way is a note', async () => {
  const seen = [];
  const record = (files) => { const f = fakeFetch(files); return (url, o) => { seen.push(String(url)); return f(url, o); }; };
  const catalog = join('models', 'road', 'RoadPatrol', 'catalog.yaml');
  const withIndex = async (index) => {
    const dir = await node();
    await writeFile(join(dir, catalog), (await readFile(join(dir, catalog), 'utf8')).replace(`index: ${INDEX}`, `index: ${index}`));
    return dir;
  };
  const where = `road/RoadPatrol: extends ${TASK} v1.0.0`;
  // http:// in catalog.yaml: refused when the node is read, with how to fix it.
  let r = await checkNode(await withIndex('http://evil.example/catalog.json'), { fetch: record({}) });
  assert.match(r.problems.join('\n'), /extends must be a list of .* index an https URL \(other nodes are read only over https: change http:\/\/ to https:\/\/\)/);
  // An IP address or localhost as written: a problem, and not read.
  for (const index of ['https://127.0.0.1/catalog.json', 'https://localhost/catalog.json']) {
    seen.length = 0;
    r = await checkNode(await withIndex(index), { fetch: record({}) });
    assert.deepEqual(r.problems, [`${where}: ${index} is not read: only https on a public host name`], index);
    assert.ok(!seen.includes(index), index);
  }
  // A @context the other node's index lists comes from that node: a note, as for a node that is down.
  const dir = await node();
  for (const contextUrl of ['https://169.254.169.254/context/task/v1.0.0.jsonld', 'http://datamodels.jp/context/task/v1.0.0.jsonld']) {
    seen.length = 0;
    r = await checkNode(dir, { fetch: record({ [INDEX]: { models: [{ typeIri: TASK, version: '1.0.0', contextUrl }] } }) });
    assert.deepEqual(r, { problems: [], notes: [`${where}: not checked, ${contextUrl} is not read: only https on a public host name`] }, contextUrl);
    assert.ok(!seen.includes(contextUrl), contextUrl);
  }
  // A node that starts redirecting to http://: a note.
  const redirecting = async (url) => (url === TASK_CONTEXT ? new Response(null, { status: 302, headers: { location: 'http://datamodels.jp/context/task/v1.0.0.jsonld' } }) : fakeFetch(datamodelsJp())(url));
  r = await checkNode(dir, { fetch: redirecting });
  assert.deepEqual(r.problems, []);
  assert.deepEqual(r.notes, [`${where}: not checked, ${TASK_CONTEXT}: redirects to http://datamodels.jp/context/task/v1.0.0.jsonld, not followed (only to https on a public host name, at most 5 times)`]);
  // A DNS blocker or proxy that answers 0.0.0.0 for datamodels.jp (the real publicFetch): a note, the check passes.
  r = await checkNode(dir, { fetch: dnsSays('0.0.0.0') });
  assert.deepEqual(r.problems, []);
  assert.ok(r.notes.includes(`${where}: not checked, ${INDEX} is not read: datamodels.jp resolves to 0.0.0.0, not a public address`), r.notes.join('\n'));
  // The same for a context this node imports from a node it lists.
  await listNodes(dir, [{ url: 'https://datamodels.jp/', index: INDEX }]);
  await writeFile(join(dir, 'models', 'road', 'context.jsonld'), JSON.stringify({ '@context': [TASK_CONTEXT, { road: `${BASE}/ns/road#`, RoadPatrol: 'road:RoadPatrol', route: 'road:route' }] }));
  r = await checkNode(dir, { fetch: dnsSays('0.0.0.0') });
  assert.deepEqual(r.problems, []);
  assert.ok(r.notes.some((n) => n.includes(`${TASK_CONTEXT} is not read: datamodels.jp resolves to 0.0.0.0`)), r.notes.join('\n'));
});

test('a schema $ref this node wrote that may not be read is a problem; a refusal by DNS is a note', async () => {
  const dir = await node();
  const file = join(dir, 'models', 'road', 'RoadPatrol', 'schema.json');
  const schema = JSON.parse(await readFile(file, 'utf8'));
  const withRef = async (ref) => writeFile(file, JSON.stringify({ ...schema, properties: { ...schema.properties, route: { $ref: ref, 'x-iri': `${BASE}/ns/road#route` } } }));
  await withRef('https://127.0.0.1/schema/common/Route/v1.0.0.json');
  let r = await checkNode(dir, { fetch: fakeFetch(datamodelsJp()) });
  assert.ok(r.problems.includes('road/RoadPatrol/schema.json: https://127.0.0.1/schema/common/Route/v1.0.0.json is not read: only https on a public host name'), r.problems.join('\n'));
  await withRef('https://datamodels.jp/schema/common/Route/v1.0.0.json');
  r = await checkNode(dir, { fetch: dnsSays('10.0.0.1') });
  assert.ok(!r.problems.some((p) => p.includes('schema.json')), r.problems.join('\n'));
  assert.ok(r.notes.includes('road/RoadPatrol/schema.json: not validated, https://datamodels.jp/schema/common/Route/v1.0.0.json is not read: datamodels.jp resolves to 10.0.0.1, not a public address'), r.notes.join('\n'));
});

test('an import this node wrote that may not be read is a problem; one in another node\'s context is a note', async () => {
  const ctx = (imports) => JSON.stringify({ '@context': [imports, { road: `${BASE}/ns/road#`, RoadPatrol: 'road:RoadPatrol', route: 'road:route' }] });
  // In this node's own context.jsonld: a problem, and not read.
  const own = await node();
  await listNodes(own, [{ url: 'https://localhost/', index: 'https://localhost/catalog.json' }]);
  await writeFile(join(own, 'models', 'road', 'context.jsonld'), ctx('https://localhost/context/x/v1.0.0.jsonld'));
  const seen = [];
  const f = fakeFetch(datamodelsJp());
  let r = await checkNode(own, { fetch: (url, o) => { seen.push(String(url)); return f(url, o); } });
  assert.ok(r.problems.includes('road/context.jsonld: https://localhost/context/x/v1.0.0.jsonld is not read: only https on a public host name'), r.problems.join('\n'));
  assert.ok(!seen.some((u) => u.startsWith('https://localhost/')), seen.join('\n'));
  // In a context read from another node: that node wrote it, so a note, as for a node that is down.
  const theirs = await node();
  await listNodes(theirs, [{ url: 'https://datamodels.jp/', index: INDEX }]);
  await writeFile(join(theirs, 'models', 'road', 'context.jsonld'), ctx(TASK_CONTEXT));
  const files = datamodelsJp();
  files[TASK_CONTEXT] = { '@context': ['https://127.0.0.1/evil.jsonld', files[TASK_CONTEXT]['@context']] };
  r = await checkNode(theirs, { fetch: fakeFetch(files) });
  assert.deepEqual(r.problems, []);
  assert.ok(r.notes.some((n) => n.startsWith('road/context.jsonld') && n.includes('https://127.0.0.1/evil.jsonld is not read')), r.notes.join('\n'));
});

test('a schema $ref this node wrote is compared as requested; one in another node\'s schema is a note', async () => {
  const dir = await node();
  const file = join(dir, 'models', 'road', 'RoadPatrol', 'schema.json');
  const schema = JSON.parse(await readFile(file, 'utf8'));
  const withRef = async (ref) => writeFile(file, JSON.stringify({ ...schema, properties: { ...schema.properties, route: { $ref: ref, 'x-iri': `${BASE}/ns/road#route` } } }));
  // An upper-case host is the same address: still this node's $ref, so a problem.
  await withRef('https://LOCALHOST/schema/common/Route/v1.0.0.json');
  let r = await checkNode(dir, { fetch: fakeFetch(datamodelsJp()) });
  assert.ok(r.problems.some((p) => p.startsWith('road/RoadPatrol/schema.json: https://localhost/schema/common/Route/v1.0.0.json is not read')), r.problems.join('\n'));
  // A $ref inside a schema from another node: a note.
  const ROUTE = 'https://datamodels.jp/schema/common/Route/v1.0.0.json';
  await withRef(ROUTE);
  r = await checkNode(dir, { fetch: fakeFetch({ ...datamodelsJp(), [ROUTE]: { $id: ROUTE, $ref: 'https://127.0.0.1/schema/x.json' } }) });
  assert.ok(!r.problems.some((p) => p.includes('schema.json')), r.problems.join('\n'));
  assert.ok(r.notes.some((n) => n.startsWith('road/RoadPatrol/schema.json') && n.includes('https://127.0.0.1/schema/x.json is not read')), r.notes.join('\n'));
});

test('node.yaml: other nodes only at https addresses; compared as URLs are requested', async () => {
  const dir = await node();
  await listNodes(dir, [{ url: 'http://datamodels.jp/', index: INDEX }]);
  await writeFile(join(dir, 'models', 'road', 'context.jsonld'), JSON.stringify({ '@context': [TASK_CONTEXT, { road: `${BASE}/ns/road#`, RoadPatrol: 'road:RoadPatrol', route: 'road:route' }] }));
  assert.match((await checkNode(dir, { offline: true })).problems.join('\n'), /nodes must be a list of \{ url, index \}, both https URLs \(other nodes are read only over https: change http:\/\/ to https:\/\/\)/);
  // An upper-case host and the default port are the same address.
  const same = await node();
  await listNodes(same, [{ url: 'https://DataModels.JP:443/', index: INDEX }]);
  await writeFile(join(same, 'models', 'road', 'context.jsonld'), JSON.stringify({ '@context': [TASK_CONTEXT, { road: `${BASE}/ns/road#`, RoadPatrol: 'road:RoadPatrol', route: 'road:route' }] }));
  assert.ok(!(await checkNode(same, { offline: true })).problems.some((p) => p.includes('only catalog contexts')));
  // The same for this node's own base URL.
  const { loadNode } = await import('../src/build/index.mjs');
  const own = await node();
  const yaml = join(own, 'node.yaml');
  await writeFile(yaml, (await readFile(yaml, 'utf8')).replace(`baseUrl: ${BASE}`, 'baseUrl: https://Models.Example.org:443'));
  await writeFile(join(own, 'models', 'road', 'context.jsonld'), JSON.stringify({ '@context': [`${BASE}/context/other/v1.0.0.jsonld`, { road: `${BASE}/ns/road#`, RoadPatrol: 'road:RoadPatrol', route: 'road:route' }] }));
  await loadNode(own);
});

test('a context imported by a URL with %2e%2e is checked where it leads', async () => {
  const dir = await node();
  await listNodes(dir, [{ url: 'https://datamodels.jp/', index: INDEX }]);
  // Under datamodels.jp/context/ as written, but outside it once %2e%2e is resolved.
  // A known node's context/ (node.yaml, nodes) and this node's own context/.
  for (const sneaky of ['https://datamodels.jp/context/%2e%2e/%2e%2e/evil.jsonld', `${BASE}/context/%2E%2E/schema/evil.jsonld`]) {
    await writeFile(join(dir, 'models', 'road', 'context.jsonld'), JSON.stringify({ '@context': [sneaky, { road: `${BASE}/ns/road#`, RoadPatrol: 'road:RoadPatrol', route: 'road:route' }] }));
    const r = await checkNode(dir, { offline: true });
    assert.ok(r.problems.some((p) => p.endsWith(`only catalog contexts may be imported by URL, got ${sneaky}`)), r.problems.join('\n'));
  }
});
