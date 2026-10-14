// datamodels extend (#13): a model of this node from a model of another node.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import YAML from 'yaml';
import { extendModel } from '../src/extend.mjs';
import { checkNode } from '../src/build/index.mjs';

const run = promisify(execFile);
const BIN = join(import.meta.dirname, '..', 'bin', 'datamodels.mjs');
const datamodels = (...args) => run(process.execPath, [BIN, ...args]).then((r) => ({ code: 0, ...r }), (e) => ({ code: e.code, stdout: e.stdout, stderr: e.stderr }));
const BASE = 'https://models.example.org';
const DJ = 'https://datamodels.jp';
const INDEX = `${DJ}/catalog.json`;
const TASK = `${DJ}/ns/task/Task`;
const CONTEXT = `${DJ}/context/task/v1.0.0.jsonld`;
const SCHEMA = `${DJ}/schema/task/Task/v1.0.0.json`;
const EXAMPLE = `${DJ}/examples/task/Task/example.json`;

/** datamodels.jp with one model, Task, as a stand-in for fetch. */
const files = {
  [INDEX]: { models: [
    { type: 'Task', kind: 'entity', typeIri: TASK, subject: 'task', version: '1.0.0', contextUrl: CONTEXT, schemaUrl: SCHEMA, exampleUrls: [`${DJ}/examples/task/Task/example-normalized.jsonld`, EXAMPLE],
      title: { ja: 'タスク', en: 'Task' }, description: { ja: '作業単位。', en: 'A unit of work.' },
      attributes: [{ name: 'name', description: { ja: '名称', en: 'Name' } }, { name: 'due', description: { ja: '期限', en: 'Due' } }] },
    { type: 'Geometry', kind: 'value', typeIri: `${DJ}/ns/common/Geometry`, subject: 'common', version: '1.0.0', contextUrl: `${DJ}/context/common/v1.0.0.jsonld`, schemaUrl: `${DJ}/schema/common/Geometry/v1.0.0.json` },
  ] },
  [CONTEXT]: { '@context': { task: `${DJ}/ns/task/`, Task: 'task:Task', due: 'task:due', name: 'https://uri.etsi.org/ngsi-ld/name' } },
  [SCHEMA]: {
    $schema: 'https://json-schema.org/draft/2020-12/schema', $id: SCHEMA, title: 'Task', 'x-version': '1.0.0', 'x-derived-from': 'RFC 8984', type: 'object',
    properties: {
      id: { type: 'string', format: 'uri' }, type: { type: 'string', const: 'Task' },
      // As on datamodels.jp: data may carry its @context (check tries the example with one).
      '@context': { oneOf: [{ type: 'string', format: 'uri' }, { type: 'array', items: { type: 'string', format: 'uri' }, minItems: 1 }] },
      name: { type: 'string', 'x-iri': 'https://uri.etsi.org/ngsi-ld/name' },
      due: { type: 'string', format: 'date-time', 'x-iri': `${DJ}/ns/task/due` },
    },
    required: ['id', 'type', 'name'], additionalProperties: false,
  },
  [EXAMPLE]: { id: 'urn:ngsi-ld:Task:1234', type: 'Task', name: 'Check the underpass', due: '2026-07-08T09:00:00+09:00' },
};
const fakeFetch = (served) => async (url) => (url in served ? new Response(JSON.stringify(served[url]), { status: 200 }) : new Response('not found', { status: 404 }));

async function node(nodes = '') {
  const dir = await mkdtemp(join(tmpdir(), 'datamodels-extend-'));
  await writeFile(join(dir, 'node.yaml'), `# The settings of this node.\nbaseUrl: ${BASE}\nlanguages: [ja, en]\npublisher: { name: { en: Example }, url: https://example.org/ }\nlicense: CC0-1.0\n${nodes}`);
  await mkdir(join(dir, 'models', 'road'), { recursive: true });
  await writeFile(join(dir, 'models', 'road', 'subject.yaml'), 'name: road\nversion: 0.1.0\nsource: minted\ntitle: { ja: 道路, en: Roads }\ndescription: { ja: 道路。, en: Roads. }\n');
  await writeFile(join(dir, 'models', 'road', 'context.jsonld'), JSON.stringify({ '@context': { road: `${BASE}/ns/road#` } }));
  return dir;
}
const read = async (dir, path) => readFile(join(dir, path), 'utf8');

test('an extension: the same type, its schema copied, its @context imported, recorded in extends', async () => {
  const dir = await node();
  const r = await extendModel(dir, 'task/Task', 'road/RoadTask', { fetch: fakeFetch(files) });
  assert.deepEqual(r, {
    added: ['models/road/RoadTask/schema.json', 'models/road/RoadTask/catalog.yaml', 'models/road/RoadTask/examples/example.json', 'models/road/RoadTask/notes.yaml'],
    changed: ['node.yaml', 'models/road/context.jsonld'],
    typeIri: TASK,
    extends: { typeIri: TASK, version: '1.0.0', index: INDEX },
  });
  // node.yaml lists datamodels.jp, so its context may be imported; init's comment stays.
  const nodeYaml = await read(dir, 'node.yaml');
  assert.match(nodeYaml, /^# The settings of this node\./);
  assert.deepEqual(YAML.parse(nodeYaml).nodes, [{ url: `${DJ}/`, index: INDEX }]);
  assert.deepEqual(JSON.parse(await read(dir, 'models/road/context.jsonld')), { '@context': [CONTEXT, { road: `${BASE}/ns/road#`, RoadTask: TASK }] });
  const schema = JSON.parse(await read(dir, 'models/road/RoadTask/schema.json'));
  assert.equal(schema.$id, `${BASE}/schema/road/RoadTask/v0.1.0.json`);
  assert.equal(schema['x-alias-of'], TASK);
  assert.equal(schema.properties.type.const, 'RoadTask');
  assert.deepEqual(schema.properties.due, files[SCHEMA].properties.due);
  assert.deepEqual([schema.required, schema.additionalProperties, schema['x-version'], schema['x-derived-from']], [['id', 'type', 'name'], false, undefined, undefined]);
  const catalog = YAML.parse(await read(dir, 'models/road/RoadTask/catalog.yaml'));
  assert.deepEqual(catalog.title, { ja: 'タスク', en: 'Task' });
  assert.deepEqual(catalog.attributes, { name: { ja: '名称', en: 'Name' }, due: { ja: '期限', en: 'Due' } });
  assert.deepEqual(catalog.extends, [{ typeIri: TASK, version: '1.0.0', index: INDEX }]);
  assert.deepEqual(JSON.parse(await read(dir, 'models/road/RoadTask/examples/example.json')), { id: 'urn:ngsi-ld:RoadTask:1234', type: 'RoadTask', name: 'Check the underpass', due: '2026-07-08T09:00:00+09:00' });
  // It passes check online, against the stand-in datamodels.jp.
  assert.deepEqual((await checkNode(dir, { fetch: fakeFetch(files) })).problems, []);
});

test('a subtype: its own type IRI, the other model as its parent', async () => {
  const dir = await node();
  const r = await extendModel(dir, TASK, 'road/PatrolTask', { subclass: true, fetch: fakeFetch(files) });
  assert.equal(r.typeIri, `${BASE}/ns/road#PatrolTask`);
  assert.deepEqual(JSON.parse(await read(dir, 'models/road/context.jsonld'))['@context'][1], { road: `${BASE}/ns/road#`, PatrolTask: 'road:PatrolTask' });
  const schema = JSON.parse(await read(dir, 'models/road/PatrolTask/schema.json'));
  assert.deepEqual([schema['x-subclass-of'], schema['x-alias-of']], [TASK, undefined]);
  const catalog = YAML.parse(await read(dir, 'models/road/PatrolTask/catalog.yaml'));
  assert.deepEqual(catalog.title, { ja: 'PatrolTask', en: 'PatrolTask' });
  assert.match(catalog.description.en, /^A subtype of Task/);
  assert.deepEqual((await checkNode(dir, { fetch: fakeFetch(files) })).problems, []);
});

test('a node already listed is kept; its index is the default', async () => {
  const dir = await node(`nodes:\n  - { url: ${DJ}/, index: ${INDEX} }\n`);
  const before = await read(dir, 'node.yaml');
  const r = await extendModel(dir, 'task/Task', 'road/RoadTask', { fetch: fakeFetch(files) });
  assert.deepEqual(r.changed, ['models/road/context.jsonld']);
  assert.equal(await read(dir, 'node.yaml'), before);
  // A second model from the same context imports it once.
  await extendModel(dir, 'task/Task', 'road/OtherTask', { subclass: true, fetch: fakeFetch(files) });
  assert.equal(JSON.parse(await read(dir, 'models/road/context.jsonld'))['@context'].filter((p) => p === CONTEXT).length, 1);
});

test('a node under a path (a GitHub Pages project site) is listed with that path, once', async () => {
  const GH = 'https://owner.github.io/repo';
  const served = Object.fromEntries(Object.entries(files).map(([url, body]) => [url.replace(DJ, GH), JSON.parse(JSON.stringify(body).replaceAll(DJ, GH))]));
  const dir = await node();
  await extendModel(dir, 'task/Task', 'road/RoadTask', { index: `${GH}/catalog.json`, fetch: fakeFetch(served) });
  const r = await extendModel(dir, 'task/Task', 'road/OtherTask', { index: `${GH}/catalog.json`, subclass: true, fetch: fakeFetch(served) });
  assert.deepEqual(YAML.parse(await read(dir, 'node.yaml')).nodes, [{ url: `${GH}/`, index: `${GH}/catalog.json` }]);
  assert.deepEqual(r.changed, ['models/road/context.jsonld']);
  // A context outside <node>/context/ cannot be imported by a node: refused.
  const elsewhere = JSON.parse(JSON.stringify(served));
  elsewhere[`${GH}/catalog.json`].models[0].contextUrl = `${GH}/ns/task.jsonld`;
  await assert.rejects(extendModel(await node(), 'task/Task', 'road/RoadTask', { index: `${GH}/catalog.json`, fetch: fakeFetch(elsewhere) }), /task\.jsonld is not under https:\/\/owner\.github\.io\/repo\/context\/, where .* publishes its @contexts/);
});

test('what extend refuses, and nothing is written then', async () => {
  const dir = await node();
  const before = await read(dir, 'node.yaml');
  const fetch = fakeFetch(files);
  await assert.rejects(extendModel(dir, 'task/Nope', 'road/RoadTask', { fetch }), /task\/Nope is not an entity type in https:\/\/datamodels\.jp\/catalog\.json/);
  await assert.rejects(extendModel(dir, 'common/Geometry', 'road/Shape', { fetch }), /common\/Geometry is not an entity type/);
  await assert.rejects(extendModel(dir, 'task/Task', 'road/roadTask', { fetch }), /must be UpperCamelCase/);
  await assert.rejects(extendModel(dir, 'task/Task', 'nope/RoadTask', { fetch }), /no subject nope/);
  await assert.rejects(extendModel(dir, 'task/Task', 'road/RoadTask', { fetch: fakeFetch({}) }), /catalog\.json: HTTP 404/);
  // A model folder that exists already: refused, node.yaml and the context untouched.
  await mkdir(join(dir, 'models', 'road', 'RoadTask'));
  await assert.rejects(extendModel(dir, 'task/Task', 'road/RoadTask', { fetch }), /RoadTask already exists/);
  assert.equal(await read(dir, 'node.yaml'), before);
  assert.deepEqual(JSON.parse(await read(dir, 'models/road/context.jsonld')), { '@context': { road: `${BASE}/ns/road#` } });
});

test('datamodels extend without its arguments outside a terminal is a usage error', async () => {
  const r = await datamodels('extend');
  assert.equal(r.code, 2);
  assert.match(r.stderr, /missing arguments\nusage: datamodels extend <model> <subject>\/<Type> \[dir\] \[--index URL\] \[--subclass\]/);
});

// A model of another node by its type IRI, without --index (geolonia/datamodels#222):
// the index of the node that minted the IRI first, then the usual one.
const GH = 'https://owner.github.io/repo';
const GH_INDEX = `${GH}/catalog.json`;
const GH_TASK = `${GH}/ns/task#Task`;
/** datamodels.jp's files as another node under GH, whose Task has a hash IRI. */
const ghFiles = JSON.parse(JSON.stringify(files).replaceAll(DJ, GH));
ghFiles[GH_INDEX].models[0].typeIri = GH_TASK;
/** datamodels.jp with one more model, Errand: another name (an alias) for GH's Task. */
const withAlias = structuredClone(files);
withAlias[INDEX].models.push({ ...files[INDEX].models[0], type: 'Errand', typeIri: GH_TASK, aliasOf: GH_TASK, title: { ja: '用事', en: 'Errand' } });
/** fakeFetch that writes down every URL it is asked for. */
const seenFetch = (served, seen) => { const f = fakeFetch(served); return (url, o) => { seen.push(String(url)); return f(url, o); }; };

test('extend by type IRI: the usual index when the IRI\'s own index cannot be read or does not list it; nothing written on an error', async () => {
  const dir = await node();
  const before = await read(dir, 'node.yaml');
  let seen = [];
  await assert.rejects(extendModel(dir, GH_TASK, 'road/RoadTask', { fetch: seenFetch(files, seen) }),
    { message: `${GH_TASK} is not an entity type in ${INDEX} (tried first: ${GH_INDEX}: HTTP 404)` });
  assert.deepEqual(seen, [GH_INDEX, INDEX]);
  assert.equal(await read(dir, 'node.yaml'), before);
  // Not https: never read, and no "tried first".
  seen = [];
  const plainHttp = GH_TASK.replace('https:', 'http:');
  await assert.rejects(extendModel(dir, plainHttp, 'road/RoadTask', { fetch: seenFetch({ ...files, ...ghFiles }, seen) }), { message: `${plainHttp} is not an entity type in ${INDEX}` });
  assert.deepEqual(seen, [INDEX]);
  // On a local or private host: never read either.
  seen = [];
  await assert.rejects(extendModel(dir, 'https://127.0.0.1/ns/task#Task', 'road/RoadTask', { fetch: seenFetch(files, seen) }),
    /\(tried first: https:\/\/127\.0\.0\.1\/catalog\.json is not read: only https on a public host name\)$/);
  assert.deepEqual(seen, [INDEX]);
  // Readable but without the IRI: the usual index, here with an alias of it.
  seen = [];
  const without = structuredClone(ghFiles);
  without[GH_INDEX].models = without[GH_INDEX].models.filter((m) => m.typeIri !== GH_TASK);
  const r = await extendModel(dir, GH_TASK, 'road/RoadTask', { fetch: seenFetch({ ...withAlias, ...without }, seen) });
  assert.deepEqual(seen.slice(0, 2), [GH_INDEX, INDEX]);
  assert.deepEqual(r.extends, { typeIri: GH_TASK, version: '1.0.0', index: INDEX });
});

test('extend by type IRI: the index of the node that minted it, read once, before the usual one', async () => {
  const dir = await node();
  const seen = [];
  // datamodels.jp has an alias of the type (Errand): the node that minted it is used.
  const r = await extendModel(dir, GH_TASK, 'road/RoadTask', { fetch: seenFetch({ ...withAlias, ...ghFiles }, seen) });
  assert.deepEqual(r.extends, { typeIri: GH_TASK, version: '1.0.0', index: GH_INDEX });
  assert.equal(r.typeIri, GH_TASK);
  assert.deepEqual(YAML.parse(await read(dir, 'node.yaml')).nodes, [{ url: `${GH}/`, index: GH_INDEX }]);
  assert.equal(seen.filter((u) => u === GH_INDEX).length, 1);
  assert.ok(!seen.includes(INDEX));
  assert.ok(JSON.parse(await read(dir, 'models/road/context.jsonld'))['@context'].includes(`${GH}/context/task/v1.0.0.jsonld`));
});

test('extend by type IRI with --index: that index only, nothing derived', async () => {
  const dir = await node();
  const seen = [];
  const r = await extendModel(dir, GH_TASK, 'road/RoadTask', { index: INDEX, fetch: seenFetch({ ...withAlias, ...ghFiles }, seen) });
  assert.deepEqual(r.extends, { typeIri: GH_TASK, version: '1.0.0', index: INDEX });
  assert.ok(!seen.includes(GH_INDEX));
});
