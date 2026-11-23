// The GeonicDB product adapter (src/adapters/geonicdb/, #134): a Custom Data
// Model body per entity model, off unless node.yaml turns it on. Its output for
// datamodels.jp's sources is checked byte for byte in test/build.test.mjs; these
// tests cover the rules, the options for a tenant's variant and the switch.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdtemp, readFile, writeFile, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { catalogUrls, loadSubjects, nodeAdapters, readNode, buildNode, subjectTerms } from '../src/build/index.mjs';
import { ADAPTERS, PRODUCT_ADAPTERS, localRefs, readRefs } from '../src/adapters/index.mjs';
import { toCustomDataModel, expandVocabTerm, needsTerms } from '../src/adapters/geonicdb/custom-data-model.mjs';
import { exportModel } from '../src/export.mjs';

const DJ = 'https://datamodels.jp';
const urls = catalogUrls(DJ);
const subjects = await loadSubjects(join(import.meta.dirname, 'fixtures', 'catalog', 'models'), { urls });
const noNetwork = () => { throw new Error('no network in tests'); };
const { refs } = await readRefs(subjects.flatMap((s) => s.models), { local: localRefs(subjects, urls), fetch: noNetwork });
const task = subjects.find((s) => s.name === 'task');
const model = (type) => task.models.find((m) => m.type === type);
const { adapters } = await nodeAdapters(subjects, { urls, languages: ['ja', 'en'], offline: true, enabled: ['geonicdb'] });
// The terms of the task context, imports included (the common context, from the sources), as nodeAdapters resolves them.
const { terms, problems } = await subjectTerms(subjects, { urls, offline: true });
assert.deepEqual(problems, {});
assert.equal(terms.task.Task, `${DJ}/ns/task/Task`);
const context = { urls, languages: ['ja', 'en'], refs, terms };
const body = (type, options) => toCustomDataModel(task, model(type), context, options);

// A model like datamodels.jp's Decision: a VocabProperty with allowed terms and a JsonProperty.
const decisionSubject = { name: 'decision', version: '1.0.0' };
const decision = {
  type: 'Decision', kind: 'entity', examples: { 'example.json': { level: 'dpv:HumanNotInvolved' } },
  catalog: { description: { ja: '判定', en: 'A decision' }, attributes: { level: { ja: '人の関与', en: 'Human involvement' } } },
  schema: {
    required: ['level'],
    properties: {
      id: {}, type: {},
      level: { type: 'string', enum: ['dpv:HumanInvolvementForOversight', 'dpv:HumanNotInvolved'], 'x-ngsi': { type: 'VocabProperty' }, 'x-iri': `${DJ}/ns/decision/level` },
      answers: { type: 'array', minItems: 1, 'x-ngsi': { type: 'JsonProperty' } },
      reviewStatus: { type: 'string', enum: ['pending', 'resolved'], 'x-ngsi': { type: 'Property' } },
    },
  },
};
const decisionTerms = { dpv: 'https://w3id.org/dpv#', Decision: `${DJ}/ns/decision/Decision`, schema: 'https://schema.org/' };
const decisionBody = (m = decision, options) => toCustomDataModel(decisionSubject, m, { urls, languages: ['ja', 'en'], terms: { decision: decisionTerms } }, options).propertyDetails;
const withEnum = (...list) => { const m = structuredClone(decision); m.schema.properties.level.enum = list; return m; };

test('default body: the subject\'s context alias, additionalProperties from the schema, IRIs per property', () => {
  const b = body('Task');
  assert.equal(b.type, 'Task');
  assert.equal(b.domain, 'task');
  assert.equal(b.contextUrl, `${DJ}/context/task/v1.jsonld`);
  assert.equal(b.propertyDetails.location['@context'], 'https://uri.etsi.org/ngsi-ld/location', 'core terms carry the core IRI');
  assert.ok(!('@context' in b.propertyDetails));
  assert.equal(typeof b.description, 'string');
  assert.ok(b.description.length);
});

test('every property has an example key, null when the example has no value (GeonicDB requires it)', () => {
  for (const m of task.models.filter((x) => x.kind === 'entity')) {
    for (const [name, d] of Object.entries(JSON.parse(JSON.stringify(body(m.type))).propertyDetails)) assert.ok('example' in d, `${m.type}.${name}`);
  }
});

test('a date or date-time attribute is GeonicDB\'s date type; a date-time only attribute keeps datetime', () => {
  for (const [type, name] of [['Task', 'start'], ['Task', 'due'], ['Milestone', 'due'], ['Project', 'end']]) {
    assert.equal(body(type).propertyDetails[name].valueType, 'date', `${type}.${name}`);
    assert.equal(body(type).propertyDetails[name].validation?.pattern, undefined, `${type}.${name}`);
  }
  assert.equal(body('Task').propertyDetails.completedAt.valueType, 'datetime');
});

test('the options for a tenant: prefix, type name, additional attributes, aliases', () => {
  assert.equal(body('Task', { typePrefix: 'Acme' }).type, 'AcmeTask');
  assert.equal(body('Task', { typeName: 'Kadai', contextUrl: 'https://example.com/c.jsonld' }).contextUrl, 'https://example.com/c.jsonld');
  assert.equal(body('Task', { allowAdditional: true }).additionalProperties, true);
  const a = body('Task', { rename: { name: 'title' } });
  assert.ok(a.propertyDetails.title && !a.propertyDetails.name);
  assert.throws(() => body('Task', { rename: { nope: 'x' } }), /not an attribute/);
  assert.throws(() => body('Task', { rename: { name: '名前' } }), /must match/);
  assert.throws(() => body('Task', { rename: { name: 'due' } }), /collides/);
  assert.throws(() => body('Task', { rename: { name: 'x', due: 'x' } }), /same alias/);
});

test('extend adds attributes, keeps the model\'s, and cannot redefine them', () => {
  const b = body('Task', { extend: { contextUrl: 'https://example.com/acme.jsonld', propertyDetails: { patrolRoute: { ngsiType: 'Property', valueType: 'string' } } } });
  assert.equal(b.contextUrl, 'https://example.com/acme.jsonld');
  assert.equal(b.propertyDetails.patrolRoute.example, null);
  assert.ok(b.propertyDetails.name);
  assert.throws(() => body('Task', { extend: { propertyDetails: { name: { ngsiType: 'Property', valueType: 'integer' } } } }), /redefines attribute "name"/);
  assert.throws(() => body('Task', { extend: { propertyDetails: { x: { example: 1 } } } }), /needs ngsiType and valueType/);
});

test('VocabProperty and JsonProperty keep their own types; allowed terms are sent as full IRIs', (t) => {
  const warn = t.mock.method(console, 'warn', () => {});
  const d = decisionBody();
  assert.equal(d.level.ngsiType, 'VocabProperty');
  assert.deepEqual(d.level.validation, { enum: ['https://w3id.org/dpv#HumanInvolvementForOversight', 'https://w3id.org/dpv#HumanNotInvolved'] });
  assert.equal(d.answers.ngsiType, 'JsonProperty');
  assert.equal(d.answers.valueType, 'array');
  assert.deepEqual(d.reviewStatus.validation, { enum: ['pending', 'resolved'] });
  assert.equal(d.level.description, '人の関与', 'Japanese first, as GeonicDB\'s console is Japanese');
  assert.equal(warn.mock.callCount(), 0);
  assert.deepEqual(decisionBody(withEnum('schema:Thing', 'Decision', 'urn:x', 'https://w3id.org/dpv#X')).level.validation.enum,
    ['https://schema.org/Thing', `${DJ}/ns/decision/Decision`, 'urn:x', 'https://w3id.org/dpv#X']);
});

test('a VocabProperty term that cannot be expanded is an error; its pattern and lengths are not sent', (t) => {
  for (const term of ['nope:X', 'X']) assert.throws(() => decisionBody(withEnum(term)), new RegExp(`the VocabProperty term "${term}" cannot be expanded`));
  assert.throws(() => toCustomDataModel(decisionSubject, decision, { urls }), /the terms of the decision context could not be read/);
  const warn = t.mock.method(console, 'warn', () => {});
  const m = structuredClone(decision);
  Object.assign(m.schema.properties.level, { pattern: '^dpv:', maxLength: 80 });
  assert.deepEqual(Object.keys(decisionBody(m).level.validation), ['enum']);
  assert.match(warn.mock.calls[0].arguments[0], /pattern, maxLength of a VocabProperty not sent/);
});

test('expandVocabTerm: definitions, cycles, absolute IRIs, and no inherited names', () => {
  const t = { dpv: 'https://w3id.org/dpv#', 'dpv:X': 'dpv:X', a: 'b', b: 'a', https: 'https://wrong.example/' };
  assert.equal(expandVocabTerm(t, 'dpv:X'), 'https://w3id.org/dpv#X');
  assert.equal(expandVocabTerm(t, 'a'), undefined);
  assert.equal(expandVocabTerm(t, 'https://w3id.org/dpv#X'), 'https://w3id.org/dpv#X');
  assert.equal(expandVocabTerm({}, 'urn:x'), 'urn:x');
  assert.equal(expandVocabTerm({}, 'constructor'), undefined, 'a name of Object.prototype is not a term');
  assert.equal(expandVocabTerm({}, 'toString:x'), undefined);
});

test('off by default: a node without adapters in node.yaml has no GeonicDB files', async () => {
  const off = await nodeAdapters(subjects, { urls, languages: ['ja', 'en'], offline: true });
  assert.deepEqual(off.adapters.map((a) => a.name), ADAPTERS.map((a) => a.name));
  assert.deepEqual(adapters.map((a) => a.name), [...ADAPTERS, ...PRODUCT_ADAPTERS].map((a) => a.name));
  assert.equal(adapters.find((a) => a.name === 'geonicdb').urlFor(task, model('Task')), `${DJ}/adapters/geonicdb/task/Task.json`);
  assert.equal(needsTerms(model('Task')), false);
  assert.equal(needsTerms(decision), true);
});

test('node.yaml: adapters lists product adapters only', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'datamodels-geonicdb-'));
  const base = 'baseUrl: https://models.example.org\npublisher: { name: { en: Example }, url: https://example.org/ }\nlicense: CC0-1.0\n';
  await writeFile(join(dir, 'node.yaml'), `${base}adapters: [geonicdb, geonicdb]\n`);
  assert.deepEqual((await readNode(dir)).adapters, ['geonicdb']);
  for (const bad of ['adapters: [csv]', 'adapters: geonicdb', 'adapters: [excel]']) {
    await writeFile(join(dir, 'node.yaml'), `${base}${bad}\n`);
    await assert.rejects(readNode(dir), /adapters must be a list of product adapters to turn on \(geonicdb\)/, bad);
  }
});

test('build: with adapters: [geonicdb] the node publishes the bodies and lists them in catalog.json, not on model pages', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'datamodels-geonicdb-node-'));
  await cp(join(import.meta.dirname, 'fixtures', 'node'), dir, { recursive: true });
  const yaml = await readFile(join(dir, 'node.yaml'), 'utf8');
  const out = join(dir, '_site');
  const off = await buildNode(dir, { out: join(dir, '_off'), offline: true });
  assert.ok(off.catalog.models.every((m) => !m.adapters?.geonicdb));
  await writeFile(join(dir, 'node.yaml'), `${yaml}adapters: [geonicdb]\n`);
  const on = await buildNode(dir, { out, offline: true });
  const entry = on.catalog.models.find((m) => m.type === 'RoadPatrol');
  assert.equal(entry.adapters.geonicdb, 'https://models.example.org/adapters/geonicdb/road/RoadPatrol.json');
  const published = JSON.parse(await readFile(join(out, 'adapters', 'geonicdb', 'road', 'RoadPatrol.json'), 'utf8'));
  assert.equal(published.type, 'RoadPatrol');
  assert.equal(published.contextUrl, 'https://models.example.org/context/road/v0.jsonld');
  // The model page links the generic files to download, not the product's: model pages stay product-neutral.
  const page = await readFile(join(out, 'models', 'road', 'RoadPatrol', 'index.html'), 'utf8');
  assert.ok(page.includes('/adapters/csv/road/RoadPatrol.csv'));
  assert.ok(!page.includes('/adapters/geonicdb/'));
  await access(join(out, 'adapters', 'csv', 'road', 'RoadPatrol.csv'));
});

test('build: a model whose allowed terms cannot be expanded gets no GeonicDB file, and a note says why', async () => {
  const other = { ...task, name: 'other', context: { '@context': ['https://elsewhere.example/context.jsonld', { other: 'https://models.example.org/ns/other#' }] } };
  const m = { ...decision, catalog: decision.catalog };
  other.models = [m];
  const r = await nodeAdapters([other], { urls, languages: ['ja', 'en'], offline: true, enabled: ['geonicdb'] });
  assert.equal(r.adapters.find((a) => a.name === 'geonicdb').urlFor(other, m), null);
  assert.match(r.notes.join('\n'), /no GeonicDB files for other\/Decision: the terms of the other context are not known/);
});

test('export --to geonicdb: from this node, and from another node\'s catalog.json', async () => {
  const local = await exportModel('road/RoadPatrol', ['geonicdb'], { dir: join(import.meta.dirname, 'fixtures', 'node'), fetch: noNetwork });
  assert.equal(local.files[0].name, 'RoadPatrol.json');
  assert.equal(JSON.parse(local.files[0].content).domain, 'road');
  const site = join(import.meta.dirname, 'fixtures', 'site');
  const siteFetch = async (url) => {
    const u = new URL(url);
    try { const text = await readFile(join(site, u.pathname), 'utf8'); return { ok: true, status: 200, json: async () => JSON.parse(text) }; } catch { return { ok: false, status: 404 }; }
  };
  const remote = await exportModel('disaster/EvacuationSite', ['geonicdb'], { index: `${DJ}/catalog.json`, fetch: siteFetch });
  const b = JSON.parse(remote.files[0].content);
  assert.equal(b.type, 'EvacuationSite');
  assert.match(b.contextUrl, /^https:\/\/datamodels\.jp\/context\/disaster\/v\d+\.jsonld$/);
});

test('attributes named like members of Object.prototype keep their names and examples', () => {
  const m = {
    type: 'Odd', kind: 'entity', examples: { 'example.json': { constructor: 'c', ['__proto__']: 'p' } },
    schema: { properties: JSON.parse('{"id":{},"type":{},"constructor":{"type":"string"},"__proto__":{"type":"string"},"toString":{"type":"string"}}') },
  };
  m.examples['example.json'] = JSON.parse('{"constructor":"c","__proto__":"p"}');
  const b = JSON.parse(JSON.stringify(toCustomDataModel(task, m, context)));
  assert.deepEqual(Object.keys(b.propertyDetails), ['constructor', '__proto__', 'toString']);
  assert.equal(b.propertyDetails.constructor.example, 'c');
  assert.equal(b.propertyDetails.__proto__.example, 'p');
  assert.equal(b.propertyDetails.toString.example, null);
  // An extension may add a name that only Object.prototype has.
  const e = toCustomDataModel(task, model('Task'), context, { extend: { propertyDetails: { valueOf: { ngsiType: 'Property', valueType: 'string' } } } });
  assert.ok(Object.hasOwn(e.propertyDetails, 'valueOf'));
});

test('build: a model the adapter cannot convert gets no file and a note; the build goes on', async () => {
  const s = { ...task, name: 'decision', context: { '@context': { dpv: 'https://w3id.org/dpv#' } } };
  const bad = withEnum('dpv:HumanNotInvolved', 'Nowhere');
  const odd = structuredClone(decision);
  odd.type = 'Odd';
  Object.assign(odd.schema.properties.level, { pattern: '^dpv:' });
  s.models = [bad, odd];
  const r = await nodeAdapters([s], { urls, languages: ['ja', 'en'], offline: true, enabled: ['geonicdb'] });
  const g = r.adapters.find((a) => a.name === 'geonicdb');
  assert.equal(g.urlFor(s, bad), null);
  assert.match(r.notes.join('\n'), /no GeonicDB file for decision\/Decision: Decision\.level: the VocabProperty term "Nowhere" cannot be expanded/);
  assert.equal(g.urlFor(s, odd), `${DJ}/adapters/geonicdb/decision/Odd.json`);
  assert.deepEqual(JSON.parse(g.content(s, odd)).propertyDetails.level.validation.enum.length, 2);
  // The warning about what is not sent is a build note, not console output.
  assert.match(r.notes.join('\n'), /Odd\.level: GeonicDB adapter: pattern of a VocabProperty not sent/);
});

test('subjectTerms: a context that imports a sibling subject\'s reads it from the sources, without the network', async () => {
  const common = subjects.find((s) => s.name === 'common');
  const decisionLike = { name: 'decision', version: '1.0.0', models: [], context: { '@context': [urls.subjectUrls(common).contextAlias, { dpv: 'https://w3id.org/dpv#' }] } };
  const r = await subjectTerms([common, decisionLike], { urls, fetch: noNetwork, only: ['decision'] });
  assert.deepEqual(r.problems, {});
  assert.deepEqual(Object.keys(r.terms), ['decision']);
  assert.equal(r.terms.decision.ContactPoint, `${DJ}/ns/common/ContactPoint`, 'a term of the imported common context');
  assert.equal(r.terms.decision.dpv, 'https://w3id.org/dpv#');
  // Without the sibling among the subjects, the import would be read online: here, it cannot be.
  const alone = await subjectTerms([decisionLike], { urls, fetch: noNetwork });
  assert.match(alone.problems.decision, /common\/v1\.jsonld/);
});

test('the package exports the conversion with its options, for tenant variants', async () => {
  const pkg = await import('@geolonia/datamodels/adapters');
  assert.equal(pkg.toCustomDataModel, toCustomDataModel);
  assert.equal(pkg.expandVocabTerm, expandVocabTerm);
  const variant = pkg.toCustomDataModel(task, model('Task'), context, { typePrefix: 'Acme' });
  assert.equal(variant.type, 'AcmeTask');
  // The same attributes, without the target types of the renamed subject (geolonia/datamodels#300).
  const plain = structuredClone(body('Task').propertyDetails);
  for (const d of Object.values(plain)) delete d.objectType;
  assert.deepEqual({ ...variant.propertyDetails }, plain);
});

test('a LanguageProperty keeps its type; its value type is the language map, an object', () => {
  const m = structuredClone(decision);
  m.schema.properties.label = { type: 'object', additionalProperties: { type: 'string' }, 'x-ngsi': { type: 'LanguageProperty' } };
  const d = decisionBody(m);
  assert.equal(d.label.ngsiType, 'LanguageProperty');
  assert.equal(d.label.valueType, 'object');
  assert.equal(d.label.validation, undefined);
});

test('a multi-valued LanguageProperty is sent with the value type of its schema, an array', () => {
  const m = structuredClone(decision);
  m.schema.properties.label = { type: 'array', items: { type: 'object', additionalProperties: { type: 'string' } }, 'x-ngsi': { type: 'LanguageProperty', multi: true } };
  const d = decisionBody(m);
  assert.equal(d.label.ngsiType, 'LanguageProperty');
  assert.equal(d.label.valueType, 'array');
});

// geolonia/datamodels#300: GeonicDB v0.25.0 and later check a Relationship's
// declared target type (objectType) and the items and length of a list.
test('a Relationship with one catalog type as its target sends it as objectType; any and agent send none', () => {
  const d = body('Task').propertyDetails;
  assert.equal(d.project.objectType, `${DJ}/ns/task/Project`);
  assert.equal(d.parent.objectType, `${DJ}/ns/task/Task`);
  assert.equal(d.relatedTo.objectType, `${DJ}/ns/task/Task`, 'multi-valued: each instance is checked');
  for (const name of ['refersTo', 'assignee', 'author']) assert.equal(Object.hasOwn(d[name], 'objectType'), false, name);
  for (const [name, p] of Object.entries(d)) if (p.ngsiType !== 'Relationship') assert.equal(Object.hasOwn(p, 'objectType'), false, name);
  assert.equal(body('Milestone').propertyDetails.project.objectType, `${DJ}/ns/task/Project`);
});

test('a tenant variant with a type prefix sends no objectType for targets of its own subject', () => {
  for (const options of [{ typePrefix: 'Acme' }]) {
    const d = body('Task', options).propertyDetails;
    for (const name of ['project', 'milestone', 'parent', 'relatedTo']) assert.equal(Object.hasOwn(d[name], 'objectType'), false, `${JSON.stringify(options)} ${name}`);
  }
  // A target outside the subject keeps it.
  const subject = { name: 'disaster', version: '1.0.0', models: [] };
  const shelter = { type: 'Shelter', kind: 'entity', examples: {}, catalog: {}, schema: { properties: { id: {}, type: {}, task: { type: 'string', format: 'uri', 'x-ngsi': { type: 'Relationship', target: `${DJ}/ns/task/Task` } } } } };
  assert.equal(toCustomDataModel(subject, shelter, { ...context, terms: { disaster: {} } }, { typePrefix: 'Acme' }).propertyDetails.task.objectType, `${DJ}/ns/task/Task`);
});

test('a list sends the rules of its scalar items and its length; GeonicDB refuses them elsewhere', (t) => {
  const warn = t.mock.fn();
  const subject = { name: 'disaster', version: '1.0.0', models: [] };
  const site = {
    type: 'Site', kind: 'entity', examples: {}, catalog: {},
    schema: { properties: { id: {}, type: {},
      hazardTypes: { type: 'array', items: { type: 'string', enum: ['flood', 'tsunami'] }, minItems: 1, uniqueItems: true },
      load: { type: 'array', items: { type: 'number', minimum: 0 }, minItems: 1, maxItems: 3 },
      lines: { type: 'array', items: { type: 'object' }, minItems: 1 },
      hours: { type: 'array', items: { $ref: `${DJ}/schema/common/OpeningHours/v1.0.0.json` }, minItems: 1 },
      odd: { type: 'array', items: { type: 'string' }, maxLength: 3 },
      facts: { type: 'array', minItems: 1, 'x-ngsi': { type: 'JsonProperty' } },
      tags: { type: 'array', items: { type: 'string', enum: ['dpv:A'] }, 'x-ngsi': { type: 'VocabProperty' } },
      relatedTo: { type: 'array', items: { type: 'string', format: 'uri' }, minItems: 1, 'x-ngsi': { type: 'Relationship', multi: true, target: `${DJ}/ns/task/Task` } },
    } },
  };
  const d = toCustomDataModel(subject, site, { ...context, terms: { disaster: {} } }, { warn }).propertyDetails;
  assert.deepEqual(d.hazardTypes.validation, { items: { enum: ['flood', 'tsunami'] }, minItems: 1, uniqueItems: true });
  assert.deepEqual(d.load.validation, { items: { minimum: 0 }, minItems: 1, maxItems: 3 });
  assert.deepEqual(d.lines.validation, { minItems: 1 }, 'objects: length only');
  assert.deepEqual(d.hours.validation, { minItems: 1 }, 'a value type: length only');
  assert.equal(Object.hasOwn(d.odd, 'validation'), false, 'a scalar rule at the top level of a list is not sent');
  assert.deepEqual(d.facts.validation, { minItems: 1 }, 'a JsonProperty list keeps its length');
  assert.equal(Object.hasOwn(d.tags, 'validation'), false, 'a VocabProperty list: its terms are not sent unexpanded');
  assert.equal(d.relatedTo.valueType, 'uri');
  assert.equal(Object.hasOwn(d.relatedTo, 'validation'), false, 'a multi-valued Relationship is several instances, not a list');
  assert.equal(d.relatedTo.objectType, `${DJ}/ns/task/Task`);
  const notes = warn.mock.calls.map((c) => c.arguments[0]);
  assert.ok(notes.some((n) => /Site\.odd: .*maxLength at the top level of a list/.test(n)), notes.join('\n'));
  assert.ok(notes.some((n) => /Site\.tags: .*rules of the items not sent/.test(n)), notes.join('\n'));
});

test('a pattern GeonicDB refuses (the ISO 8601 duration) is not sent, and a note says so', (t) => {
  const warn = t.mock.fn();
  const d = body('Task', { warn }).propertyDetails;
  assert.equal(Object.hasOwn(d.estimatedDuration, 'validation'), false);
  assert.ok(warn.mock.calls.some((c) => /Task\.estimatedDuration: .*geonicdb#4180/.test(c.arguments[0])));
  // Other patterns are still sent.
  const subject = { name: 'x', version: '1.0.0', models: [] };
  const m = { type: 'X', kind: 'entity', examples: {}, catalog: {}, schema: { properties: { id: {}, type: {}, code: { type: 'string', pattern: '^[0-9]{6}$' } } } };
  assert.deepEqual(toCustomDataModel(subject, m, { ...context, terms: { x: {} } }).propertyDetails.code.validation, { pattern: '^[0-9]{6}$' });
});

test('objectType: a list of targets without duplicates; a short name or a list with any sends none', (t) => {
  const warn = t.mock.fn();
  const subject = { name: 'x', version: '1.0.0', models: [] };
  const rel = (target) => ({ type: 'string', format: 'uri', 'x-ngsi': { type: 'Relationship', target } });
  const m = { type: 'X', kind: 'entity', examples: {}, catalog: {}, schema: { properties: { id: {}, type: {},
    two: rel([`${DJ}/ns/task/Task`, `${DJ}/ns/task/Project`]),
    dup: rel([`${DJ}/ns/task/Task`, `${DJ}/ns/task/Task`]),
    short: rel('Task'),
    mixed: rel([`${DJ}/ns/task/Task`, 'any']),
    spaced: rel(`${DJ}/ns/task/Ta sk`),
    many: rel(Array.from({ length: 51 }, (_, i) => `${DJ}/ns/x/T${i}`)),
  } } };
  const d = toCustomDataModel(subject, m, { ...context, terms: { x: {} } }, { warn }).propertyDetails;
  assert.deepEqual(d.two.objectType, [`${DJ}/ns/task/Task`, `${DJ}/ns/task/Project`]);
  assert.equal(d.dup.objectType, `${DJ}/ns/task/Task`, 'GeonicDB refuses duplicates');
  for (const name of ['short', 'mixed', 'spaced', 'many']) assert.equal(Object.hasOwn(d[name], 'objectType'), false, name);
  assert.ok(warn.mock.calls.some((c) => /X\.many: .*more than 50/.test(c.arguments[0])));
});

test('a tenant variant: typeName drops only the model\'s own type; without the context terms, none and a note', (t) => {
  const d = body('Task', { typeName: 'Kadai' }).propertyDetails;
  assert.equal(Object.hasOwn(d.parent, 'objectType'), false, 'Task.parent -> Task, renamed');
  assert.equal(d.project.objectType, `${DJ}/ns/task/Project`, 'Project keeps its name');
  const warn = t.mock.fn();
  const v = toCustomDataModel(task, model('Task'), { ...context, terms: {} }, { typePrefix: 'Acme', warn }).propertyDetails;
  for (const p of Object.values(v)) assert.equal(Object.hasOwn(p, 'objectType'), false);
  assert.ok(warn.mock.calls.some((c) => /objectType not sent .*context terms could not be read/.test(c.arguments[0])));
});

test('a nullable list is still a list: type [array, null] gets the list rules', () => {
  const subject = { name: 'x', version: '1.0.0', models: [] };
  const m = { type: 'X', kind: 'entity', examples: {}, catalog: {}, schema: { properties: { id: {}, type: {},
    tags: { type: ['array', 'null'], items: { type: 'string', minLength: 1 }, minItems: 1 },
    note: { type: ['string', 'null'], maxLength: 10 },
    day: { type: ['string', 'null'], format: 'date' },
    names: { type: 'array', items: { type: ['string', 'null'], minLength: 1 } },
  } } };
  const d = toCustomDataModel(subject, m, { ...context, terms: { x: {} } }).propertyDetails;
  assert.equal(d.tags.valueType, 'array');
  assert.deepEqual(d.tags.validation, { items: { minLength: 1 }, minItems: 1 });
  assert.equal(d.note.valueType, 'string');
  assert.deepEqual(d.note.validation, { maxLength: 10 });
  assert.equal(d.day.valueType, 'date', 'a nullable date is a date');
  assert.deepEqual(d.names.validation, { items: { minLength: 1 } }, 'nullable items keep their rules');
});

test('the duration pattern is left out of list items too; other rules of the attribute stay', (t) => {
  const warn = t.mock.fn();
  const subject = { name: 'x', version: '1.0.0', models: [] };
  const DUR = '^P(?!$)(\\d+D)?(T(?=\\d)(\\d+H)?(\\d+M)?(\\d+S)?)?$';
  const m = { type: 'X', kind: 'entity', examples: {}, catalog: {}, schema: { properties: { id: {}, type: {},
    windows: { type: 'array', items: { type: 'string', pattern: DUR, maxLength: 20 }, minItems: 1 },
    wait: { type: 'string', pattern: DUR, minLength: 3 },
  } } };
  const d = toCustomDataModel(subject, m, { ...context, terms: { x: {} } }, { warn }).propertyDetails;
  assert.deepEqual(d.windows.validation, { items: { maxLength: 20 }, minItems: 1 });
  assert.deepEqual(d.wait.validation, { minLength: 3 });
  assert.equal(warn.mock.calls.filter((c) => /geonicdb#4180/.test(c.arguments[0])).length, 2);
});

test('extension attributes pass through in GeonicDB\'s form, objectType and list rules included', () => {
  const propertyDetails = {
    site: { ngsiType: 'Relationship', valueType: 'uri', objectType: `${DJ}/ns/disaster/EvacuationSite` },
    codes: { ngsiType: 'Property', valueType: 'array', validation: { items: { enum: ['a', 'b'] }, minItems: 1, uniqueItems: true } },
  };
  const d = body('Task', { extend: { propertyDetails } }).propertyDetails;
  assert.deepEqual(d.site, { ...propertyDetails.site, example: null });
  assert.deepEqual(d.codes, { ...propertyDetails.codes, example: null });
});

test('export --to geonicdb reads the contexts a remote context imports only under that catalog\'s context/ (#167)', async () => {
  const site = join(import.meta.dirname, 'fixtures', 'site');
  const read = [];
  const outside = 'https://example.org/context/x.jsonld';
  const climb = `${DJ}/context/../elsewhere/y.jsonld`;
  const siteFetch = async (url) => {
    read.push(url);
    const u = new URL(url);
    if (url === outside || u.pathname.startsWith('/elsewhere/')) return { ok: true, status: 200, json: async () => ({ '@context': { extra: 'https://example.org/ns/extra' } }) };
    // The disaster context imports one context under the catalog's context/, one on another site and one that climbs out of context/.
    if (u.pathname.startsWith('/context/disaster/')) return { ok: true, status: 200, json: async () => ({ '@context': [`${DJ}/context/common/v1.jsonld`, outside, climb, { disaster: `${DJ}/ns/disaster/` }] }) };
    if (u.pathname.startsWith('/context/common/')) return { ok: true, status: 200, json: async () => ({ '@context': { common: `${DJ}/ns/common/` } }) };
    try { const text = await readFile(join(site, u.pathname), 'utf8'); return { ok: true, status: 200, json: async () => JSON.parse(text) }; } catch { return { ok: false, status: 404 }; }
  };
  const remote = await exportModel('disaster/EvacuationSite', ['geonicdb'], { index: `${DJ}/catalog.json`, fetch: siteFetch });
  assert.equal(JSON.parse(remote.files[0].content).type, 'EvacuationSite', 'the body is still written');
  assert.ok(read.some((u) => u.startsWith(`${DJ}/context/disaster/`)), 'the model\'s own context is read');
  assert.ok(read.some((u) => u.startsWith(`${DJ}/context/common/`)), 'an import under context/ is read');
  assert.equal(read.includes(outside), false, 'an import on another site is not read');
  assert.equal(read.some((u) => u.includes('/elsewhere/')), false, 'an import that climbs out of context/ is not read');
});

test('export --to geonicdb follows no redirect out of the catalog\'s context/ (#167)', async () => {
  const site = join(import.meta.dirname, 'fixtures', 'site');
  const read = [];
  const away = 'https://example.org/context/z.jsonld';
  const siteFetch = async (url) => {
    read.push(url);
    const u = new URL(url);
    if (url === away) return { ok: true, status: 200, json: async () => ({ '@context': { extra: 'https://example.org/ns/extra' } }) };
    if (u.pathname.startsWith('/context/disaster/')) return { ok: true, status: 200, json: async () => ({ '@context': [`${DJ}/context/common/v1.jsonld`, { disaster: `${DJ}/ns/disaster/` }] }) };
    // The import under context/ answers with a redirect to another site.
    if (u.pathname.startsWith('/context/common/')) return { ok: false, status: 302, headers: { get: (h) => (h.toLowerCase() === 'location' ? away : null) } };
    try { const text = await readFile(join(site, u.pathname), 'utf8'); return { ok: true, status: 200, json: async () => JSON.parse(text) }; } catch { return { ok: false, status: 404 }; }
  };
  const remote = await exportModel('disaster/EvacuationSite', ['geonicdb'], { index: `${DJ}/catalog.json`, fetch: siteFetch });
  assert.equal(JSON.parse(remote.files[0].content).type, 'EvacuationSite');
  assert.ok(read.some((u) => u.startsWith(`${DJ}/context/common/`)), 'the import under context/ is asked for');
  assert.equal(read.includes(away), false, 'its redirect to another site is not followed');
});
