// datamodels check (#12), with a stand-in for the network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { checkNode, buildNode, loadSubjects, catalogUrls, snapshotRelease } from '../src/build/index.mjs';

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

test('a release snapshot that differs from the sources is a problem', async () => {
  const dir = await node();
  const urls = catalogUrls(BASE, { iris: 'hash' });
  const [subject] = await loadSubjects(join(dir, 'models'), { urls, languages: ['en'], subjectFields: ['title', 'description'] });
  await snapshotRelease(subject, { urls, languages: ['en'] });
  assert.deepEqual((await checkNode(dir, { offline: true })).problems, []);
  const m = join(dir, 'models', 'road', 'RoadPatrol', 'catalog.yaml');
  await writeFile(m, (await readFile(m, 'utf8')).replace('The route', 'The route taken'));
  assert.match((await checkNode(dir, { offline: true })).problems.join('\n'), /road v0\.1\.0 vocabulary: snapshot differs from the sources/);
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
  assert.match(o.notes.join('\n'), /road\/RoadPatrol: the attribute route is not in the @context, or in a context it imports that could not be read/);
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
  await writeFile(join(dir, 'models', 'road', 'RoadPatrol', 'examples', 'example.json'), '{"id": "x"}');
  r = await datamodels('check', dir, '--offline');
  assert.equal(r.code, 1);
  assert.match(r.stderr, /example\.json: data must have required property 'type'\n.*1 problem\(s\)/);
});
