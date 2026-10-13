// The rules for the models of a node (src/build/model-rules.mjs), moved from
// datamodels.jp's validate-models (geolonia/datamodels#226).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, cp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { catalogUrls } from '../src/build/urls.mjs';
import { modelRuleProblems } from '../src/build/model-rules.mjs';
import { checkNode } from '../src/build/check.mjs';

const BASE = 'https://models.example.org';
const urls = catalogUrls(BASE, { iris: 'hash' });
const languages = ['en', 'ja'];
const iri = (name) => `${BASE}/ns/road#${name}`;
const texts = (t) => ({ en: t, ja: t });

/** A model of the subject road with the attributes `props` (name → x-ngsi.type), described in both languages. */
function model(type, props = {}, { schema = {}, catalog = {}, notes = {}, kind = 'entity' } = {}) {
  const properties = { id: {}, type: { const: type } };
  for (const [name, t] of Object.entries(props)) properties[name] = { type: 'string', 'x-iri': iri(name), 'x-ngsi': { type: t } };
  return {
    type, kind, notes,
    schema: { properties, required: ['id', 'type'], ...schema },
    catalog: { title: texts(type), description: texts(`One ${type}.`), attributes: Object.fromEntries(Object.keys(props).map((n) => [n, texts(n)])), ...catalog },
  };
}
const problems = (...models) => modelRuleProblems([{ name: 'road', version: '0.1.0', models }], { urls, languages });

test('models that follow the rules have no problems', () => {
  assert.deepEqual(problems(
    model('Patrol', { route: 'Property' }, { catalog: { status: 'deprecated', supersededBy: iri('Inspection') }, notes: { notes: [texts('Why.')], history: [texts('2026-10-13: added.')], license: 'CC0-1.0' } }),
    model('Inspection', { route: 'Property', inspector: 'Relationship' }, { schema: { 'x-subclass-of': iri('Patrol'), required: ['id', 'type', 'route'] } }),
    model('Round', { route: 'Property' }, { schema: { 'x-alias-of': iri('Patrol') } }),
    model('Place', {}, { schema: { 'x-subclass-of': 'https://schema.org/Place' } }),
  ), []);
});

test('an alias has the attributes, requirements and kind of its type, and is not also a subclass', () => {
  assert.deepEqual(problems(
    model('Patrol', { route: 'Property' }, { schema: { anyOf: [{ required: ['route'] }] } }),
    model('Round', { route: 'Relationship', extra: 'Property' }, { schema: { 'x-alias-of': iri('Patrol'), 'x-subclass-of': iri('Patrol'), required: ['id'], additionalProperties: false }, kind: 'value' }),
    model('Lap', {}, { schema: { 'x-alias-of': iri('Missing') } }),
    model('Leg', {}, { schema: { 'x-alias-of': 'road:Patrol' } }),
    model('Turn', {}, { schema: { 'x-subclass-of': 7 } }),
  ), [
    'road/Round/schema.json: x-alias-of and x-subclass-of cannot both be set; an alias is the same type, a subclass a narrower one',
    'road/Round/schema.json: an alias of road/Patrol has the same attributes, these differ: route, extra (a narrower type sets x-subclass-of)',
    'road/Round/schema.json: an alias of road/Patrol has the same required attributes',
    'road/Round/schema.json: an alias of road/Patrol has the same anyOf',
    'road/Round/schema.json: an alias of road/Patrol is of the same kind (entity, not value)',
    'road/Round/schema.json: an alias of road/Patrol has the same additionalProperties',
    'road/Round/schema.json: route: a subclass of road/Patrol keeps its NGSI-LD type Property',
    'road/Round/schema.json: a subclass of road/Patrol keeps "type" required',
    'road/Round/schema.json: a subclass of road/Patrol keeps its anyOf (route) or requires one of them',
    `road/Lap/schema.json: x-alias-of ${iri('Missing')} is not a type of this node`,
    'road/Leg/schema.json: x-alias-of must be the full http(s) IRI of a type, got "road:Patrol"',
    'road/Turn/schema.json: x-subclass-of must be the full http(s) IRI of a class, got 7',
  ]);
});

test('an alias of a type on another site is not compared here', () => {
  assert.deepEqual(problems(model('Site', {}, { schema: { 'x-alias-of': 'https://datamodels.jp/ns/disaster/EvacuationSite' } })), []);
});

test('a subclass uses its parent\'s IRIs and NGSI-LD types and stays as strict; another vocabulary\'s class is checked by its form', () => {
  const parent = model('Patrol', { route: 'Property', car: 'Relationship' }, { schema: { required: ['id', 'type', 'route'], anyOf: [{ required: ['car'] }, { required: ['crew'] }] } });
  const child = model('Inspection', { route: 'Property', car: 'Property' }, { schema: { 'x-subclass-of': iri('Patrol') } });
  child.schema.properties.route['x-iri'] = 'https://example.org/route';
  assert.deepEqual(problems(parent, child,
    model('Night', {}, { schema: { 'x-subclass-of': 'https://schema.org/event' } }),
    model('Day', {}, { schema: { 'x-subclass-of': 'Event' } }),
    model('Dusk', {}, { schema: { 'x-subclass-of': iri('Missing') } }),
  ), [
    `road/Inspection/schema.json: route: a subclass of road/Patrol uses its IRI ${iri('route')}, not https://example.org/route`,
    'road/Inspection/schema.json: car: a subclass of road/Patrol keeps its NGSI-LD type Relationship',
    'road/Inspection/schema.json: a subclass of road/Patrol keeps "route" required',
    'road/Inspection/schema.json: a subclass of road/Patrol keeps its anyOf (car or crew) or requires one of them',
    'road/Night/schema.json: x-subclass-of https://schema.org/event does not name a class (a class name starts with a capital letter)',
    'road/Day/schema.json: x-subclass-of must be the full http(s) IRI of a class, got "Event"',
    `road/Dusk/schema.json: x-subclass-of ${iri('Missing')} is not a type of this node`,
  ]);
  // Requiring one alternative outright is stricter, so it keeps the anyOf.
  const strict = model('Inspection', { route: 'Property', car: 'Relationship' }, { schema: { 'x-subclass-of': iri('Patrol'), required: ['id', 'type', 'route', 'crew'] } });
  assert.deepEqual(problems(parent, strict), []);
});

test('review fixes: the node namespace, anyOf alternatives with more than required, class names after #', () => {
  // Only /ns/ is the node's namespace: another vocabulary on the same site is outside it.
  assert.deepEqual(problems(model('Round', {}, { schema: { 'x-alias-of': `${BASE}/vocab/Round` } })), []);
  // An alternative with other assertions is not kept by requiring its fields.
  const parent = model('Patrol', { car: 'Relationship' }, { schema: { anyOf: [{ required: ['car'], properties: { car: { const: 'x' } } }, { properties: { car: { const: 'y' } } }] } });
  const child = model('Inspection', { car: 'Relationship' }, { schema: { 'x-subclass-of': iri('Patrol'), required: ['id', 'type', 'car'] } });
  assert.deepEqual(problems(parent, child), ['road/Inspection/schema.json: a subclass of road/Patrol keeps its anyOf (car or other rules) or requires one of them']);
  // additionalProperties as a schema is compared by content; a malformed required or anyOf does not stop the check.
  const open = { additionalProperties: { type: 'string' } };
  assert.deepEqual(problems(model('Patrol', {}, { schema: open }), model('Round', {}, { schema: { ...open, 'x-alias-of': iri('Patrol') } })), []);
  assert.deepEqual(problems(model('Patrol', {}, { schema: { required: 'id', anyOf: [{ required: 7 }] } }), model('Lap', {}, { schema: { 'x-subclass-of': iri('Patrol'), required: 'id' } }), model('Leg', {}, { schema: { 'x-alias-of': iri('Patrol'), required: 'id', anyOf: [{ required: 7 }] } })), [
    'road/Lap/schema.json: a subclass of road/Patrol keeps its anyOf (other rules) or requires one of them',
  ]);
  // An empty notes.yaml is not a mapping (a missing one is fine).
  assert.deepEqual(problems(model('Patrol', {}, { notes: null })), ['road/Patrol/notes.yaml: must be a mapping with notes, history and license']);
  // anyOf and each required list in it are unordered.
  const either = { anyOf: [{ required: ['car', 'crew'] }, { required: ['route'] }] };
  const reordered = { anyOf: [{ required: ['route'] }, { required: ['crew', 'car'] }] };
  assert.deepEqual(problems(model('Patrol', {}, { schema: either }), model('Round', {}, { schema: { ...reordered, 'x-alias-of': iri('Patrol') } }), model('Lap', {}, { schema: { ...reordered, 'x-subclass-of': iri('Patrol') } })), []);
  // A model is not its own parent.
  assert.deepEqual(problems(model('Loop', {}, { schema: { 'x-subclass-of': iri('Loop') } })), [`road/Loop/schema.json: x-subclass-of names the model's own type; a class is not its own parent`]);
  // A hash vocabulary: the class name is after the #.
  assert.deepEqual(problems(
    model('A', {}, { schema: { 'x-subclass-of': 'https://example.org/vocab#Place' } }),
    model('B', {}, { schema: { 'x-subclass-of': 'https://example.org/Vocab#place' } }),
  ), ['road/B/schema.json: x-subclass-of https://example.org/Vocab#place does not name a class (a class name starts with a capital letter)']);
});

test('a missing x-ngsi.type is a Property when a subclass or an alias is compared', () => {
  const parent = model('Patrol', { route: 'Property' });
  delete parent.schema.properties.route['x-ngsi'];
  assert.deepEqual(problems(parent,
    model('Inspection', { route: 'Property' }, { schema: { 'x-subclass-of': iri('Patrol') } }),
    model('Round', { route: 'Property' }, { schema: { 'x-alias-of': iri('Patrol') } }),
  ), []);
  assert.deepEqual(problems(parent, model('Lap', { route: 'Relationship' }, { schema: { 'x-subclass-of': iri('Patrol') } })), [
    'road/Lap/schema.json: route: a subclass of road/Patrol keeps its NGSI-LD type Property',
  ]);
});

test('an IRI or URL with a user name or password is refused: it would be published', () => {
  // Made here, not written out: a secret scanner would report a URL with credentials in the source.
  const withLogin = (url, password) => { const u = new URL(url); u.username = 'someone'; if (password) u.password = password; return u.href; };
  const place = withLogin('https://schema.org/Place', String(Date.now()));
  const next = withLogin('https://example.org/new');
  assert.deepEqual(problems(
    model('Place', {}, { schema: { 'x-subclass-of': place } }),
    model('Old', {}, { catalog: { status: 'deprecated', supersededBy: next } }),
  ), [
    `road/Place/schema.json: x-subclass-of must be the full http(s) IRI of a class, got ${JSON.stringify(place)}`,
    `road/Old/catalog.yaml: supersededBy must be an http(s) URL (the replacement's type IRI or page), got ${JSON.stringify(next)}`,
  ]);
});

test('one model per type IRI, across subjects', () => {
  const a = { name: 'road', version: '0.1.0', models: [model('Patrol')] };
  const b = { name: 'rail', version: '0.1.0', models: [model('Patrol')] };
  const same = catalogUrls(BASE, { iris: 'hash' });
  // Two subjects with their own namespaces: no clash.
  assert.deepEqual(modelRuleProblems([a, b], { urls: same, languages }), []);
  // A URL scheme where both get one IRI (here: the type name alone).
  const flat = { ...same, modelUrls: (s, m) => ({ ...same.modelUrls(s, m), typeIri: `${BASE}/ns/${m.type}` }) };
  assert.deepEqual(modelRuleProblems([a, b], { urls: flat, languages }), [`rail/Patrol/schema.json: the type IRI ${BASE}/ns/Patrol is also the type of road/Patrol`]);
});

test('x-personal-data is true or left out', () => {
  const m = model('Patrol', { driver: 'Property', car: 'Property', route: 'Property' });
  m.schema.properties.driver['x-personal-data'] = true;
  m.schema.properties.car['x-personal-data'] = 'yes';
  m.schema.properties.route['x-personal-data'] = false;
  assert.deepEqual(problems(m), [
    'road/Patrol/schema.json: car: x-personal-data is true or left out',
    'road/Patrol/schema.json: route: x-personal-data is true or left out',
  ]);
});

test('catalog.yaml has every text in every language of the node, and no attribute that the schema lacks', () => {
  const m = model('Patrol', { route: 'Property', car: 'Property', crew: 'Property' }, { catalog: { title: { en: 'Patrol' }, description: { en: 'One.', ja: ' ', fr: 'Une.' } } });
  m.catalog.attributes = { route: { en: 'Route', ja: '経路', 'not a tag': 'x' }, car: 'Car', gone: texts('Gone'), id: texts('Id') };
  assert.deepEqual(problems(m), [
    'road/Patrol/catalog.yaml: title needs a non-empty ja text',
    'road/Patrol/catalog.yaml: description needs a non-empty ja text',
    'road/Patrol/catalog.yaml: attributes.route has "not a tag", which is not a language with a text',
    'road/Patrol/catalog.yaml: attributes.car must be { en, ja }',
    'road/Patrol/catalog.yaml: attributes.crew is missing',
    'road/Patrol/catalog.yaml: attributes.gone: not an attribute in schema.json',
    'road/Patrol/catalog.yaml: attributes.id: not an attribute in schema.json',
  ]);
  const notMapping = model('Patrol');
  notMapping.catalog = ['title'];
  assert.deepEqual(problems(notMapping), ['road/Patrol/catalog.yaml: must be a mapping with title, description and attributes']);
});

test('status is one of four words; supersededBy only for a deprecated model, as a URL', () => {
  assert.deepEqual(problems(
    model('A', {}, { catalog: { status: null } }),
    model('B', {}, { catalog: { status: 'stable', supersededBy: 'C' } }),
    model('C', {}, { catalog: {} }),
    model('D', {}, { catalog: { status: 'deprecated', supersededBy: 'https://example.org' } }),
  ), [
    'road/A/catalog.yaml: status must be draft, experimental, stable or deprecated, got null',
    'road/B/catalog.yaml: supersededBy is only for status deprecated, the status is stable',
    'road/B/catalog.yaml: supersededBy must be an http(s) URL (the replacement\'s type IRI or page), got "C"',
  ]);
});

test('notes.yaml: notes and history are lists of texts in every language, license a string', () => {
  assert.deepEqual(problems(
    model('A', {}, { notes: ['a note'] }),
    model('B', {}, { notes: { notes: 'Why.', history: [texts('Added.'), { en: 'Changed: x' }], license: 1 } }),
  ), [
    'road/A/notes.yaml: must be a mapping with notes, history and license',
    'road/B/notes.yaml: notes must be a list',
    'road/B/notes.yaml: history[1] needs a non-empty ja text (quote a text that contains ": " or a comma)',
    'road/B/notes.yaml: license must be a string',
  ]);
});

test('datamodels check keeps a build error that the rules do not list', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'datamodels-rules-'));
  await cp(join(import.meta.dirname, 'fixtures', 'node'), dir, { recursive: true });
  const file = join(dir, 'models', 'road', 'RoadPatrol', 'schema.json');
  const schema = JSON.parse(await readFile(file, 'utf8'));
  // An attribute without x-iri (a build error), and one without a text (a rule).
  schema.properties = { ...schema.properties, anon: { type: 'string' }, car: { type: 'string', 'x-iri': `${BASE}/ns/road#car` } };
  await writeFile(file, JSON.stringify(schema));
  const cat = join(dir, 'models', 'road', 'RoadPatrol', 'catalog.yaml');
  await writeFile(cat, `${await readFile(cat, 'utf8')}  anon: { en: Anonymous }\n`);
  const { problems: found } = await checkNode(dir, { offline: true });
  assert.deepEqual(found, [
    'road/RoadPatrol/catalog.yaml: attributes.car is missing',
    'RoadPatrol.anon: no x-iri, so catalog.json cannot list its IRI',
  ]);
});

test('datamodels check lists every missing text, where the build stops at the first', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'datamodels-rules-'));
  await cp(join(import.meta.dirname, 'fixtures', 'node'), dir, { recursive: true });
  const file = join(dir, 'models', 'road', 'RoadPatrol', 'schema.json');
  const schema = JSON.parse(await readFile(file, 'utf8'));
  schema.properties.car = { type: 'string', 'x-iri': `${BASE}/ns/road#car` };
  schema.properties.crew = { type: 'string', 'x-iri': `${BASE}/ns/road#crew` };
  await writeFile(file, JSON.stringify(schema));
  const { problems: found } = await checkNode(dir, { offline: true });
  assert.deepEqual(found, [
    'road/RoadPatrol/catalog.yaml: attributes.car is missing',
    'road/RoadPatrol/catalog.yaml: attributes.crew is missing',
  ]);
});
