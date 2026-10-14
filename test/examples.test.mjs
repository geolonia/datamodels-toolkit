// The checks of schema rules, examples and JSON-LD that came from datamodels.jp's
// validator (geolonia/datamodels#226), run through datamodels check offline.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkNode } from '../src/build/index.mjs';
import { schemaRuleProblems, keyPaths } from '../src/build/examples.mjs';
import { catalogUrls } from '../src/build/urls.mjs';
import { toKeyValues, unwrapKeyValues, unclosedRings } from '../src/ngsi.mjs';

const BASE = 'https://models.example.org';
const CORE = 'https://uri.etsi.org/ngsi-ld/v1/ngsi-ld-core-context-v1.8.jsonld';
const ALIAS = `${BASE}/context/road/v0.jsonld`;
const ID = 'urn:ngsi-ld:RoadPatrol:1';
const ATTRIBUTES = 'attributes:\n  route: { en: Route }\n  due: { en: Due }\n  area: { en: Area }\n  answers: { en: Answers }\n  kind: { en: Kind }\n';

/** A node with one model that has both examples; `change` edits the files before they are written. */
async function node(change = (f) => f) {
  const dir = await mkdtemp(join(tmpdir(), 'datamodels-examples-'));
  const files = change({
    context: { '@context': { road: `${BASE}/ns/road#`, RoadPatrol: 'road:RoadPatrol', route: 'road:route', due: 'road:due', area: 'road:area', answers: 'road:answers', kind: 'road:kind', night: 'road:night' } },
    schema: {
      $id: `${BASE}/schema/road/RoadPatrol/v0.1.0.json`, type: 'object', required: ['id', 'type'],
      properties: {
        id: { type: 'string' }, type: { const: 'RoadPatrol' },
        '@context': { oneOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' } }] },
        route: { type: 'string', 'x-iri': `${BASE}/ns/road#route`, 'x-ngsi': { type: 'Property' } },
        due: { type: 'string', format: 'date-time', 'x-iri': `${BASE}/ns/road#due`, 'x-ngsi': { type: 'Property' } },
        area: { type: 'object', 'x-iri': `${BASE}/ns/road#area`, 'x-ngsi': { type: 'GeoProperty' } },
        answers: { type: 'array', 'x-iri': `${BASE}/ns/road#answers`, 'x-ngsi': { type: 'JsonProperty' } },
        kind: { enum: ['road:night', 'road:day'], 'x-iri': `${BASE}/ns/road#kind`, 'x-ngsi': { type: 'VocabProperty' } },
      },
      additionalProperties: false,
    },
    kv: { id: ID, type: 'RoadPatrol', route: 'R1', due: '2026-10-12T09:00:00+09:00', area: { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] }, answers: { json: [1, 2] }, kind: { vocab: 'road:night' } },
    norm: {
      '@context': [ALIAS, CORE], id: ID, type: 'RoadPatrol',
      route: { type: 'Property', value: 'R1' },
      due: { type: 'Property', value: { '@type': 'DateTime', '@value': '2026-10-12T09:00:00+09:00' } },
      area: { type: 'GeoProperty', value: { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] } },
      answers: { type: 'JsonProperty', json: [1, 2] },
      kind: { type: 'VocabProperty', vocab: 'road:night' },
    },
    catalog: `title: { en: Road patrol }\ndescription: { en: A run. }\n${ATTRIBUTES}`,
  });
  await writeFile(join(dir, 'node.yaml'), `baseUrl: ${BASE}\npublisher: { name: { en: Example }, url: https://example.org/ }\nlicense: CC0-1.0\n`);
  const m = join(dir, 'models', 'road', 'RoadPatrol');
  await mkdir(join(m, 'examples'), { recursive: true });
  await writeFile(join(dir, 'models', 'road', 'subject.yaml'), 'name: road\nversion: 0.1.0\nsource: minted\ntitle: { en: Roads }\ndescription: { en: Roads. }\n');
  await writeFile(join(dir, 'models', 'road', 'context.jsonld'), JSON.stringify(files.context));
  await writeFile(join(m, 'schema.json'), JSON.stringify(files.schema));
  await writeFile(join(m, 'catalog.yaml'), files.catalog);
  // kvText: example.json as written, for a file that is not an object.
  if (files.kv || files.kvText) await writeFile(join(m, 'examples', 'example.json'), files.kvText ?? JSON.stringify(files.kv));
  if (files.norm) await writeFile(join(m, 'examples', 'example-normalized.jsonld'), JSON.stringify(files.norm));
  return dir;
}
const problemsOf = async (change) => (await checkNode(await node(change), { offline: true })).problems;
const N = 'road/RoadPatrol/examples/example-normalized.jsonld';
const K = 'road/RoadPatrol/examples/example.json';

test('a model with both examples passes, its JSON-LD read from the build', async () => {
  const r = await checkNode(await node(), { offline: true });
  assert.deepEqual(r, { problems: [], notes: ['offline: the published files and the models this node extends were not checked'] });
});

test('the json and vocab wrappers of key-values form are removed before the schema sees the example', async () => {
  assert.deepEqual(await problemsOf((f) => ({ ...f, kv: { ...f.kv, answers: [1, 2] } })), [`${K}: attribute answers: a JsonProperty is {"json": ...} in key-values form`]);
  assert.deepEqual(unwrapKeyValues({ kind: [{ vocab: 'a' }] }, { properties: { kind: { 'x-ngsi': { type: 'VocabProperty', multi: true } } } }), { kind: ['a'] });
  // A type name of Object.prototype is no wrapper.
  assert.deepEqual(unwrapKeyValues({ x: 1 }, { properties: { x: { 'x-ngsi': { type: 'constructor' } } } }), { x: 1 });
});

test('the schema must accept the @context that data may carry', async () => {
  const problems = await problemsOf((f) => {
    const { '@context': _, ...properties } = f.schema.properties;
    return { ...f, schema: { ...f.schema, properties } };
  });
  assert.equal(problems.length, 2);
  assert.match(problems[0], /^road\/RoadPatrol\/schema\.json: rejects example\.json with "@context": "https:\/\/models\.example\.org\/context\/road\/v0\.jsonld" \(data must NOT have additional properties\); an entity schema accepts @context/);
});

test('polygon rings close, in both examples and at any depth', async () => {
  assert.deepEqual(unclosedRings({ a: [{ type: 'Polygon', coordinates: [[[0, 0], [1, 1], [0, 0]], [[0, 0], [1, 1]]] }], b: { type: 'MultiPolygon', coordinates: [[[[0, 0], [1, 1], [2, 2]]]] } }), ['$.a[0].coordinates[1]', '$.b.coordinates[0][0]']);
  assert.deepEqual(unclosedRings({ type: 'Polygon', coordinates: [[]] }), [], 'the schema decides about an empty ring');
  const open = { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1]]] };
  assert.deepEqual(await problemsOf((f) => ({ ...f, kv: { ...f.kv, area: open }, norm: { ...f.norm, area: { type: 'GeoProperty', value: open } } })), [
    `${K}: $.area.coordinates[0]: the polygon ring does not close (its first and last positions must be the same, RFC 7946)`,
    `${N}: $.area.coordinates[0]: the polygon ring does not close (its first and last positions must be the same, RFC 7946)`,
  ]);
});

test('the normalized example follows the NGSI-LD rules of the schema', async () => {
  const p = await problemsOf((f) => ({ ...f, norm: {
    ...f.norm,
    '@context': [`${BASE}/context/road/v0.1.0.jsonld`, CORE],
    id: 'urn:ngsi-ld:RoadPatrol:2',
    route: [{ type: 'Relationship', object: 'urn:x' }],
    due: { type: 'Property', value: '2026-10-12T09:00:00+09:00' },
    kind: { type: 'VocabProperty', vocab: 'road:day' },
  } }));
  assert.deepEqual(p, [
    `${N}: id must be example.json's id ${ID}`,
    `${N}: attribute "route" has several instances, but schema.json does not declare x-ngsi.multi`,
    `${N}: attribute "route" is a Relationship, but schema.json makes it a Property`,
    `${N}: attribute "due": the value must be { "@type": "DateTime", "@value": "2026-10-12T09:00:00+09:00" }`,
    `${K}: attribute "kind": vocab ["road:night"] differs from example-normalized.jsonld's ["road:day"]`,
    `${N}: its key-values form: data/route must be string`,
    `${N}: @context must be a list that includes ${ALIAS}`,
  ]);
  // Without x-ngsi an attribute is a Property, as convert --normalized writes it.
  const q = await problemsOf((f) => ({ ...f, schema: { ...f.schema, properties: { ...f.schema.properties, route: { type: 'string', 'x-iri': `${BASE}/ns/road#route` } } }, norm: { ...f.norm, route: { type: 'GeoProperty', value: { type: 'Point', coordinates: [0, 0] } } } }));
  assert.ok(q.includes(`${N}: attribute "route" is a GeoProperty, but schema.json makes it a Property (no x-ngsi.type)`), q.join('\n'));
  assert.deepEqual(await problemsOf((f) => ({ ...f, norm: { ...f.norm, route: 'R1' } })), [`${N}: attribute route: not a normalized attribute object`]);
  assert.deepEqual(await problemsOf((f) => ({ ...f, norm: [f.norm] })), [`${N}: must be one entity, a JSON object`]);
  assert.throws(() => toKeyValues({ a: [{ type: 'Property', value: 1 }, { type: 'Property', value: 2 }] }), /only one instance of a multi-valued attribute may omit datasetId/);
});

test('JSON-LD: attributes and the type expand to their IRIs, vocab values are defined, nothing is lost', async () => {
  const p = await problemsOf((f) => ({
    ...f,
    // night is removed by a later part of the @context, so JSON-LD drops it; no term defines the word dusk.
    context: { '@context': [f.context['@context'], { RoadPatrol: 'road:Patrol', night: null }] },
    kv: { ...f.kv, kind: { vocab: 'dusk' } },
    norm: { ...f.norm, kind: { type: 'VocabProperty', vocab: 'dusk' }, route: { type: 'Property', value: 'R1', night: true } },
    schema: { ...f.schema, properties: { ...f.schema.properties, kind: { type: 'string', 'x-iri': `${BASE}/ns/road#kind`, 'x-ngsi': { type: 'VocabProperty' } } } },
  }));
  assert.deepEqual(p, [
    `road/RoadPatrol: RoadPatrol is ${BASE}/ns/road#RoadPatrol in the schema, but the @context expands it to ${BASE}/ns/road#Patrol`,
    `${N}: attribute "kind": the vocab value expands to https://uri.etsi.org/ngsi-ld/default-context/dusk; define it in the @context or write a full IRI`,
    `${N}: the type expands to ${BASE}/ns/road#Patrol, not ${BASE}/ns/road#RoadPatrol`,
    `${N}: "route.night" is lost when JSON-LD expands and compacts it (is it in the @context?)`,
  ]);
});

test('JSON-LD: a context of this node that it does not publish is a problem; one elsewhere, offline, a note', async () => {
  let r = await checkNode(await node((f) => ({ ...f, norm: { ...f.norm, '@context': [ALIAS, `${BASE}/context/road/v9.jsonld`, CORE] } })), { offline: true });
  assert.deepEqual(r.problems, [`${N}: JSON-LD processing failed: ${BASE}/context/road/v9.jsonld is not a file that this node publishes`]);
  r = await checkNode(await node((f) => ({ ...f, norm: { ...f.norm, '@context': [ALIAS, 'https://elsewhere.example/context.jsonld', CORE] } })), { offline: true });
  assert.deepEqual(r.problems, []);
  assert.ok(r.notes.includes(`${N}: not checked, https://elsewhere.example/context.jsonld (not read with --offline)`), r.notes.join('\n'));
  // Online, a context elsewhere that answers is used.
  const fetch = async (url) => (url === 'https://elsewhere.example/context.jsonld' ? new Response(JSON.stringify({ '@context': { extra: 'https://elsewhere.example/extra' } })) : new Response('', { status: 404 }));
  r = await checkNode(await node((f) => ({ ...f, norm: { ...f.norm, '@context': [ALIAS, 'https://elsewhere.example/context.jsonld', CORE] } })), { fetch });
  assert.deepEqual(r, { problems: [], notes: [] });
});

test('JSON-LD: a value type is tried inside an entity', async () => {
  const dir = await node((f) => ({ ...f, kv: null, norm: null }));
  const m = join(dir, 'models', 'road', 'Sign');
  await mkdir(join(m, 'examples'), { recursive: true });
  await writeFile(join(m, 'schema.json'), JSON.stringify({ $id: `${BASE}/schema/road/Sign/v0.1.0.json`, 'x-kind': 'value', type: 'object', properties: { route: { type: 'string', 'x-iri': `${BASE}/ns/road#route` }, night: { type: 'boolean', 'x-iri': `${BASE}/ns/road#night` } } }));
  await writeFile(join(m, 'catalog.yaml'), 'title: { en: Sign }\ndescription: { en: A sign. }\nattributes:\n  route: { en: Route }\n  night: { en: At night }\n');
  await writeFile(join(m, 'examples', 'example.json'), JSON.stringify({ route: 'R1', night: true }));
  assert.deepEqual((await checkNode(dir, { offline: true })).problems, []);
  const context = join(dir, 'models', 'road', 'context.jsonld');
  const ctx = JSON.parse(await readFile(context, 'utf8'));
  await writeFile(context, JSON.stringify({ '@context': [ctx['@context'], { night: null }] }));
  assert.deepEqual((await checkNode(dir, { offline: true })).problems, [
    'road/Sign: the attribute night is not in the @context',
    'road/Sign/examples/example.json: field "night" is not defined by the @context, and JSON-LD drops it',
  ]);
});

test('a subject that imports another subject of the node reads it from the build, offline too', async () => {
  const dir = await node((f) => ({ ...f, context: { '@context': [`${BASE}/context/common/v1.jsonld`, f.context['@context']] } }));
  await mkdir(join(dir, 'models', 'common'), { recursive: true });
  await writeFile(join(dir, 'models', 'common', 'subject.yaml'), 'name: common\nversion: 1.0.0\nsource: minted\ntitle: { en: Common }\ndescription: { en: Common. }\n');
  await writeFile(join(dir, 'models', 'common', 'context.jsonld'), JSON.stringify({ '@context': { common: `${BASE}/ns/common#`, shared: 'common:shared' } }));
  assert.deepEqual(await checkNode(dir, { offline: true }), { problems: [], notes: ['offline: the published files and the models this node extends were not checked'] });
  // A version of it that the node does not publish.
  const context = join(dir, 'models', 'road', 'context.jsonld');
  await writeFile(context, (await readFile(context, 'utf8')).replace('/context/common/v1.jsonld', '/context/common/v2.jsonld'));
  assert.deepEqual((await checkNode(dir, { offline: true })).problems, [`road/context.jsonld: ${BASE}/context/common/v2.jsonld is not a file that this node publishes`]);
});

test('the vocabulary must be valid JSON-LD', async () => {
  // A title that is not a text: catalog.yaml says why, the vocabulary what it breaks.
  assert.deepEqual(await problemsOf((f) => ({ ...f, catalog: `title: { en: { text: Road patrol } }\ndescription: { en: A run. }\n${ATTRIBUTES}` })), [
    'road/RoadPatrol/catalog.yaml: title needs a non-empty en text',
    'road: vocabulary: JSON-LD processing failed: Invalid JSON-LD syntax; language map values must be strings.',
  ]);
});

test('the rules of schema.json that the schema cannot state', () => {
  const urls = catalogUrls(BASE, { iris: 'hash' });
  const subject = { name: 'road', version: '0.1.0' };
  const model = (schema, kind = 'entity') => ({ type: 'RoadPatrol', kind, schema });
  const $id = `${BASE}/schema/road/RoadPatrol/v0.1.0.json`;
  assert.deepEqual(schemaRuleProblems(subject, model({ $id, properties: { type: { const: 'RoadPatrol' }, route: { 'x-ngsi': { type: 'Property' } } } }), urls), []);
  assert.deepEqual(schemaRuleProblems(subject, model({ $id: `${BASE}/schema/road/RoadPatrol/v0.0.1.json`, 'x-version': '0.0.1', properties: { type: { const: 'Patrol' }, route: { 'x-ngsi': { type: 'Text' } } } }), urls), [
    'road/RoadPatrol/schema.json: properties.type.const must be "RoadPatrol", the name of its folder',
    `road/RoadPatrol/schema.json: $id must be ${$id}, where the build publishes it`,
    'road/RoadPatrol/schema.json: x-version must be 0.1.0, the version of the subject',
    'road/RoadPatrol/schema.json: route: x-ngsi.type must be one of Property, Relationship, GeoProperty, JsonProperty, VocabProperty, got "Text"',
  ]);
  // A value type has no type attribute.
  assert.deepEqual(schemaRuleProblems(subject, model({ $id, properties: {} }, 'value'), urls), []);
});

test('review fixes: the instances of a multi-valued attribute are compared after JSON-LD too', async () => {
  const p = await problemsOf((f) => ({
    ...f,
    context: { '@context': [f.context['@context'], { night: null }] },
    schema: { ...f.schema, properties: { ...f.schema.properties, route: { type: 'array', items: { type: 'string' }, 'x-iri': `${BASE}/ns/road#route`, 'x-ngsi': { type: 'Property', multi: true } } } },
    kv: { ...f.kv, route: ['R1'] },
    norm: { ...f.norm, route: [{ type: 'Property', value: 'R1', datasetId: 'urn:ngsi-ld:dataset:route:1', night: true }] },
  }));
  assert.deepEqual(p, [`${N}: "route.night" is lost when JSON-LD expands and compacts it (is it in the @context?)`]);
});

test('review fixes: the @context of the test wins over one that example.json already has', async () => {
  const p = await problemsOf((f) => ({
    ...f,
    schema: { ...f.schema, properties: { ...f.schema.properties, '@context': { type: 'string' } } },
    kv: { '@context': ALIAS, ...f.kv },
  }));
  assert.equal(p.length, 1, p.join('\n'));
  assert.match(p[0], /^road\/RoadPatrol\/schema\.json: rejects example\.json with "@context": \["https:\/\/models\.example\.org\/context\/road\/v0\.1\.0\.jsonld",/);
});

test('review fixes: an example that is not a JSON object is a problem, not coerced', async () => {
  for (const [kvText, got] of [['null', 'null'], ['7', 'a number'], ['["urn:x"]', 'an array']]) {
    assert.deepEqual(await problemsOf((f) => ({ ...f, kv: null, kvText, norm: null })), [`${K}: must be a JSON object, got ${got}`], kvText);
  }
  assert.throws(() => unwrapKeyValues(null, { properties: {} }), /must be a JSON object, got null/);
  assert.throws(() => unwrapKeyValues([1, 2], { properties: {} }), /must be a JSON object, got an array/);
  assert.throws(() => toKeyValues(7), /must be a JSON object, got a number/);
  // A value type with no required fields would accept {} or {"0": ...} after a coercion.
  const dir = await node((f) => ({ ...f, kv: null, norm: null }));
  const m = join(dir, 'models', 'road', 'Sign');
  await mkdir(join(m, 'examples'), { recursive: true });
  await writeFile(join(m, 'schema.json'), JSON.stringify({ $id: `${BASE}/schema/road/Sign/v0.1.0.json`, 'x-kind': 'value', type: 'object', properties: {} }));
  await writeFile(join(m, 'catalog.yaml'), 'title: { en: Sign }\ndescription: { en: A sign. }\n');
  await writeFile(join(m, 'examples', 'example.json'), '[1, 2]');
  assert.deepEqual((await checkNode(dir, { offline: true })).problems, ['road/Sign/examples/example.json: must be a JSON object, got an array']);
});

test('review fixes: names that Object.prototype has are attributes like any other', async () => {
  // Optional attributes named constructor and toString, in neither example.
  const p = await problemsOf((f) => ({
    ...f,
    context: { '@context': { ...f.context['@context'], constructor: 'road:constructor', toString: 'road:toString' } },
    schema: { ...f.schema, properties: { ...f.schema.properties, constructor: { type: 'string', 'x-iri': `${BASE}/ns/road#constructor`, 'x-ngsi': { type: 'VocabProperty' } }, toString: { type: 'string', 'x-iri': `${BASE}/ns/road#toString`, 'x-ngsi': { type: 'Property' } } } },
    catalog: `title: { en: Road patrol }\ndescription: { en: A run. }\n${ATTRIBUTES}  constructor: { en: Who built it }\n  toString: { en: As text }\n`,
  }));
  assert.deepEqual(p, []);
  assert.deepEqual(unwrapKeyValues({ id: 'x' }, { properties: { constructor: { 'x-ngsi': { type: 'VocabProperty' } } } }), { id: 'x' });
});

test('keyPaths follows arrays under their path', () => {
  assert.deepEqual(keyPaths({ a: [{ b: 1 }, { c: { d: 2 } }], '@context': 'x', e: [1, 2] }), ['a', 'a.b', 'a.c', 'a.c.d', 'e']);
});

test('review fixes: an attribute named __proto__ in the normalized example is an attribute like any other', async () => {
  // A computed key makes an own property; JSON.parse does the same when check reads the file.
  const extra = { ['__proto__']: { type: 'Property', value: 'x' } };
  const p = await problemsOf((f) => ({ ...f, norm: { ...f.norm, ...extra } }));
  assert.deepEqual(p, [
    `${N}: its key-values form: data must NOT have additional properties`,
    `${N}: "__proto__" is lost when JSON-LD expands and compacts it (is it in the @context?)`,
  ]);
});
