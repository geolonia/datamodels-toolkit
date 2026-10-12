// The checks of a node's mapping files (src/build/mapping-check.mjs), moved
// from datamodels.jp's validator (geolonia/datamodels#226) and aligned with convert.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parse } from 'yaml';
import { mappingFileProblems, viaCycles, textsIn } from '../src/build/mapping-check.mjs';
import { checkNode, buildNode, loadSubjects, catalogUrls } from '../src/build/index.mjs';

const subjects = await loadSubjects(join(import.meta.dirname, 'fixtures', 'catalog', 'models'), { urls: catalogUrls('https://datamodels.jp') });
const model = (sub, type) => subjects.find((s) => s.name === sub).models.find((m) => m.type === type);
const task = model('task', 'Task').schema;
const geometry = model('common', 'Geometry').schema;
const JA_EN = { languages: ['ja', 'en'] };
const ok = { name: 'x', standard: { name: { ja: '標準', en: 'Standard' }, url: 'https://example.org/std' }, fields: { progress: { to: 'state' } } };
const problems = (map, schema = task, options = JA_EN) => mappingFileProblems(map, schema, options);
const TEXTS = 'needs a text in ja and en, and nothing but texts by language (quote a text that contains a comma)';

test("every mapping file of datamodels.jp's fixture passes", () => {
  const mappingNames = new Set(subjects.flatMap((s) => s.models.flatMap((m) => m.mappings.map((x) => `${s.name}/${m.type}/${x.name}`))));
  for (const s of subjects) for (const m of s.models) for (const map of m.mappings) assert.deepEqual(problems(map, m.schema, { ...JA_EN, mappingNames }), [], `${m.type}/${map.name}`);
});

test('a field that is not in the model, or a malformed row, is reported', () => {
  assert.deepEqual(problems(ok), []);
  assert.deepEqual(problems({ ...ok, fields: { progres: { to: 'state' } } }), ['progres: not a field of this model']);
  assert.deepEqual(problems({ ...ok, fields: { progress: 'state' } }), ['progress: needs "to" (the corresponding item, or null when there is none)']);
  assert.deepEqual(problems({ ...ok, fields: { progress: { to: '' } } }), ['progress: "to" must be a non-empty string or null']);
  assert.deepEqual(problems({ ...ok, fields: { progress: { to: null, note: { ja: 'なし' } } } }), [`progress: note ${TEXTS}`]);
  assert.deepEqual(problems({ ...ok, fields: { progress: { to: 'a', notes: 'x' } } }), ['progress: unknown key "notes" (allowed: to, note, column, transform, values, value, via)']);
  assert.deepEqual(problems({ ...ok, fields: { 'progress-1': { to: 'a' } } }), ['progress-1: not a field name (name, name[2] for a position, or name.field for a field of a value)']);
  assert.deepEqual(problems({ ...ok, fields: {} }), ['fields must map at least one field of the model']);
  assert.deepEqual(problems({ name: 'x' }), ['standard is required: the standard this file maps, with its name', 'fields must map at least one field of the model']);
});

test('a text cut at a comma by YAML is reported; the texts are in the languages of the node', () => {
  // { ja: …, en: closed → completed, otherwise … } parses as three keys.
  const cut = parse('progress: { to: status, note: { ja: 完了, en: closed → completed, otherwise needs-action } }');
  assert.deepEqual(Object.keys(cut.progress.note), ['ja', 'en', 'otherwise needs-action']);
  assert.deepEqual(problems({ ...ok, fields: cut }), [`progress: note ${TEXTS}`]);
  const quoted = parse('progress: { to: status, note: { ja: 完了, en: "closed → completed, otherwise needs-action" } }');
  assert.deepEqual(problems({ ...ok, fields: quoted }), []);
  // A node in English needs English texts only; another language may come along.
  const english = { name: 'x', standard: { name: { en: 'Standard' } }, fields: { progress: { to: 'state', note: { en: 'Note', de: 'Notiz' } } } };
  assert.deepEqual(problems(english, task, { languages: ['en'] }), []);
  assert.deepEqual(problems(english), [`standard.name ${TEXTS}`, `progress: note ${TEXTS}`]);
  assert.equal(textsIn({ en: 'x', ja: 3 }, ['en']), false);
});

test('conversion rules: what convert applies, with via naming a mapping file of the node', () => {
  const mappingNames = new Set(['common/Geometry/jichitai-opendata-location']);
  const rule = (r, field = 'progress') => problems({ ...ok, fields: { [field]: { to: 'x', ...r } } }, task, { ...JA_EN, mappingNames });
  assert.deepEqual(rule({ column: '状態' }), []);
  assert.deepEqual(rule({ column: [] }), ['progress: column must be a column name or a list of them', 'progress: a rule without a transform reads exactly 1 column, got 0']);
  assert.deepEqual(rule({ column: 'a', transform: 'upper' }), [`progress: unknown transform "upper" (known: text, code6, number, integer, numbers, flag, flags, boolean, yesno, split, weekdays, time, geometry, json, municipality, machiazaId, nationalShelterType)`]);
  assert.deepEqual(rule({ transform: 'flags' }), ['progress: transform flags needs values, as column: value']);
  // values on a rule of one column, as convert reads them since v0.3.5 (text, split, yesno).
  assert.deepEqual(rule({ column: '状態', values: { 完了: 'completed' } }), []);
  assert.deepEqual(rule({ column: '有無', transform: 'yesno', values: { 有: true, 無: false } }), []);
  assert.deepEqual(rule({ column: 'a', transform: 'integer', values: { a: 1 } }), ['progress: transform integer takes no values (values work without a transform, with split and with yesno)']);
  assert.deepEqual(rule({ column: 'a', transform: 'numbers' }), ['progress: transform numbers reads at least 2 columns, got 1']);
  for (const transform of ['boolean', 'weekdays', 'time', 'json']) assert.deepEqual(rule({ column: 'a', transform }), [], transform);
  assert.deepEqual(rule({ column: ['経度', '緯度'], transform: 'geometry' }, 'location'), []);
  assert.deepEqual(rule({ via: 'common/Geometry/jichitai-opendata-location' }, 'location'), []);
  assert.deepEqual(rule({ via: 'common/Geometry/nothing' }), ['progress: via must name a mapping file of this node as subject/Type/name, got common/Geometry/nothing']);
  assert.deepEqual(rule({ via: './my-list.yaml' }), ['progress: via must name a mapping file of this node as subject/Type/name, got ./my-list.yaml']);
  // An empty via names no mapping, and a name is looked up among the files, not inherited from Object.
  assert.deepEqual(rule({ via: null }), ['progress: via must name a mapping file of this node as subject/Type/name, got null']);
  assert.deepEqual(rule({ via: '' }), ['progress: via must name a mapping file of this node as subject/Type/name, got ""']);
  assert.deepEqual(rule({ via: 'toString' }), ['progress: via must name a mapping file of this node as subject/Type/name, got toString']);
  // flags without values reads no column.
  assert.deepEqual(rule({ transform: 'flags', values: {} }), ['progress: transform flags needs values, as column: value']);
  assert.deepEqual(rule({ column: 'a', value: 'b' }), ['progress: use one of column, value and via']);
  // A field of a value, as convert nests it (address.postalCode); its first part is an attribute.
  assert.deepEqual(rule({ column: '郵便番号' }, 'location.type'), []);
  assert.deepEqual(rule({ column: '郵便番号' }, 'adress.postalCode'), ['adress.postalCode: adress is not an attribute of this model']);
  assert.deepEqual(problems({ ...ok, convert: { id: 'urn:ngsi-ld:Task:1' } }), ['convert.id must be a template such as "urn:ngsi-ld:Type:{attribute}"']);
  assert.deepEqual(problems({ ...ok, convert: { id: 'urn:ngsi-ld:Task:{source.id}' } }), []);
  assert.deepEqual(problems({ ...ok, convert: { id: 'urn:ngsi-ld:Task:{externalId}', ids: 'x' } }), ['unknown key "convert.ids" (allowed: id)']);
});

test('a field of a value is a path through the schemas: only the model\'s own members are fields', () => {
  const schema = { properties: { address: { type: 'object', properties: { postalCode: { type: 'string' } } }, progress: { type: 'number' }, extra: { type: 'object' } } };
  const field = (name) => problems({ ...ok, fields: { [name]: { to: 'x', column: 'a' } } }, schema);
  assert.deepEqual(field('address.postalCode'), []);
  // A member of a value is not a field of the model: convert would write it at the top.
  assert.deepEqual(field('postalCode'), ['postalCode: not a field of this model']);
  assert.deepEqual(field('address.postalCod'), ['address.postalCod: address has no field postalCod']);
  assert.deepEqual(field('progress.missing'), ['progress.missing: progress has no field missing']);
  assert.deepEqual(field('address.postalCode.more'), ['address.postalCode.more: address.postalCode has no field more']);
  // An object without listed members may have any.
  assert.deepEqual(field('extra.anything'), []);
  // Through a reference to another model of the node; one that is not known is not checked.
  const schemas = new Map([[geometry.$id, geometry]]);
  const viaRef = (name, options) => problems({ ...ok, fields: { [name]: { to: 'x', column: 'a' } } }, task, { ...JA_EN, ...options });
  assert.deepEqual(viaRef('location.coordinates', { schemas }), []);
  assert.deepEqual(viaRef('location.cordinates', { schemas }), ['location.cordinates: location has no field cordinates']);
  assert.deepEqual(viaRef('location.type.x', { schemas }), ['location.type.x: location.type has no field x']);
  assert.deepEqual(viaRef('location.cordinates'), []);
});

test('a value type maps its own members, with array positions as documentation', () => {
  assert.deepEqual(problems({ ...ok, fields: { type: { to: null }, coordinates: { to: 'x' }, 'coordinates[2]': { to: null } } }, geometry), []);
  assert.deepEqual(problems({ ...ok, fields: { 'coordinates[x]': { to: null } } }, geometry), ['coordinates[x]: not a field name (name, name[2] for a position, or name.field for a field of a value)']);
  assert.deepEqual(problems({ ...ok, fields: { 'type[0]': { to: null } } }, geometry), ['type[0]: type is not an array, so it has no positions']);
  assert.deepEqual(problems({ ...ok, fields: { 'coordinates[2]': { to: 'z', column: '標高' } } }, geometry), ['coordinates[2]: a position in an array cannot have a conversion rule (column, transform, values, value or via); convert fills the whole array']);
});

test('the standard needs a name; url, licence, note and structure are checked when present', () => {
  assert.deepEqual(problems({ ...ok, standard: { name: { ja: '標準' } } }), [`standard.name ${TEXTS}`]);
  assert.deepEqual(problems({ ...ok, standard: { ...ok.standard, url: 'example.org' } }), ['standard.url must be an http(s) URL with a host, got "example.org"']);
  // The page links the URL, so it may not carry a user name or password.
  const secret = ['user', 'pw'].join(':');
  assert.deepEqual(problems({ ...ok, standard: { ...ok.standard, url: `https://${secret}@example.org/std` } }), [`standard.url must be an http(s) URL with a host, got "https://${secret}@example.org/std"`]);
  assert.deepEqual(problems({ ...ok, standard: { ...ok.standard, note: { en: 'only English' } } }), [`standard.note ${TEXTS}`]);
  const licence = (license) => problems({ ...ok, standard: { ...ok.standard, license } });
  const licenceProblem = ['standard.license must be a non-empty string, or a text in ja and en and nothing but texts by language (quote a text that contains a comma)'];
  assert.deepEqual(licence('CC BY 4.0'), []);
  assert.deepEqual(licence({ ja: 'スキーマは CC BY 4.0', en: 'CC BY 4.0 (schema)' }), []);
  assert.deepEqual(licence(' '), licenceProblem);
  assert.deepEqual(licence({ en: 'only English' }), licenceProblem);
  assert.deepEqual(licence(['CC BY 4.0']), licenceProblem);
  assert.deepEqual(problems({ ...ok, structure: { ja: '構造' } }), [`structure ${TEXTS}`]);
  assert.deepEqual(problems({ ...ok, standard: { ...ok.standard, urI: 'https://example.org/std' } }), ['unknown key "standard.urI" (allowed: name, url, license, note)']);
  assert.deepEqual(problems({ ...ok, feilds: {} }), ['unknown key "feilds" (allowed: standard, fields, structure, convert)']);
});

test('via cycles are found, however long', () => {
  const via = (to) => ({ fields: { a: { to: null, via: to } } });
  assert.deepEqual(viaCycles({ 'a/A/x': via('b/B/y'), 'b/B/y': via('a/A/x'), 'c/C/z': via('c/C/z'), 'd/D/w': via('a/A/x') }), [['a/A/x', 'b/B/y', 'a/A/x'], ['c/C/z', 'c/C/z']]);
  assert.deepEqual(viaCycles({ 'a/A/x': via('b/B/y'), 'b/B/y': { fields: { a: { to: 'x' } } } }), []);
});

test('datamodels check reports the problems of a mapping file with its path, and via cycles', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'datamodels-mapping-'));
  const base = 'https://models.example.org';
  await writeFile(join(dir, 'node.yaml'), `baseUrl: ${base}\npublisher: { name: { en: Example }, url: https://example.org/ }\nlicense: CC0-1.0\n`);
  const m = join(dir, 'models', 'road', 'RoadPatrol');
  await mkdir(join(m, 'mapping'), { recursive: true });
  await writeFile(join(dir, 'models', 'road', 'subject.yaml'), 'name: road\nversion: 0.1.0\nsource: minted\ntitle: { en: Roads }\ndescription: { en: Roads. }\n');
  await writeFile(join(dir, 'models', 'road', 'context.jsonld'), JSON.stringify({ '@context': { road: `${base}/ns/road#`, RoadPatrol: 'road:RoadPatrol', route: 'road:route' } }));
  await writeFile(join(m, 'schema.json'), JSON.stringify({ $id: `${base}/schema/road/RoadPatrol/v0.1.0.json`, type: 'object', properties: { id: { type: 'string' }, type: { const: 'RoadPatrol' }, route: { type: 'string', 'x-iri': `${base}/ns/road#route` } } }));
  await writeFile(join(m, 'catalog.yaml'), 'title: { en: Road patrol }\ndescription: { en: A run. }\nattributes:\n  route: { en: The route }\n');
  await writeFile(join(m, 'mapping', 'list.yaml'), 'standard: { name: { en: A list } }\nconvert: { id: "urn:ngsi-ld:RoadPatrol:{route}" }\nfields:\n  route: { to: 路線, column: 路線, transform: yesno, values: { a: b } }\n');
  await writeFile(join(m, 'mapping', 'a.yaml'), 'standard: { name: { en: A } }\nfields:\n  route: { to: x, via: road/RoadPatrol/b }\n');
  await writeFile(join(m, 'mapping', 'b.yaml'), 'standard: { name: { en: B } }\nfields:\n  route: { to: y, via: road/RoadPatrol/a }\n');
  const r = await checkNode(dir, { offline: true });
  assert.deepEqual(r.problems, [
    'road/RoadPatrol/mapping/list.yaml: route: the values of transform yesno must be true or false',
    'road/RoadPatrol/a: via goes round in a circle: road/RoadPatrol/a → road/RoadPatrol/b → road/RoadPatrol/a',
  ]);
  // Fixed, the node passes.
  await writeFile(join(m, 'mapping', 'list.yaml'), (await readFile(join(m, 'mapping', 'list.yaml'), 'utf8')).replace('values: { a: b }', 'values: { 有: true }'));
  await writeFile(join(m, 'mapping', 'b.yaml'), 'standard: { name: { en: B } }\nfields:\n  route: { to: y }\n');
  assert.deepEqual((await checkNode(dir, { offline: true })).problems, []);
  // The file name is the mapping's name: a name in the file is reported, also when it repeats the file name.
  for (const name of ['other', 'b']) {
    await writeFile(join(m, 'mapping', 'b.yaml'), `name: ${name}\nstandard: { name: { en: B } }\nfields:\n  route: { to: y }\n`);
    assert.deepEqual((await checkNode(dir, { offline: true })).problems, ['road/RoadPatrol/mapping/b.yaml: unknown key "name" (allowed: standard, fields, structure, convert)'], name);
  }
});

test('a node in another language: the standard names are checked and published in its languages', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'datamodels-mapping-fr-'));
  const base = 'https://models.example.org';
  await writeFile(join(dir, 'node.yaml'), `baseUrl: ${base}\nlanguages: [fr]\npublisher: { name: { fr: Exemple }, url: https://example.org/ }\nlicense: CC0-1.0\n`);
  const m = join(dir, 'models', 'road', 'RoadPatrol');
  await mkdir(join(m, 'mapping'), { recursive: true });
  await writeFile(join(dir, 'models', 'road', 'subject.yaml'), 'name: road\nversion: 0.1.0\nsource: minted\ntitle: { fr: Routes }\ndescription: { fr: Les routes. }\n');
  await writeFile(join(dir, 'models', 'road', 'context.jsonld'), JSON.stringify({ '@context': { road: `${base}/ns/road#`, RoadPatrol: 'road:RoadPatrol', route: 'road:route' } }));
  await writeFile(join(m, 'schema.json'), JSON.stringify({ $id: `${base}/schema/road/RoadPatrol/v0.1.0.json`, type: 'object', properties: { id: { type: 'string' }, type: { const: 'RoadPatrol' }, route: { type: 'string', 'x-iri': `${base}/ns/road#route` } } }));
  await writeFile(join(m, 'catalog.yaml'), 'title: { fr: Patrouille }\ndescription: { fr: Une tournée. }\nattributes:\n  route: { fr: La route }\n');
  await writeFile(join(m, 'mapping', 'registre.yaml'), 'standard: { name: { fr: Le registre des routes } }\nfields:\n  route: { to: itinéraire }\n');
  assert.deepEqual((await checkNode(dir, { offline: true })).problems, []);
  await buildNode(dir);
  const catalog = JSON.parse(await readFile(join(dir, '_site', 'catalog.json'), 'utf8'));
  assert.deepEqual(catalog.models[0].mappings, [{ url: `${base}/mapping/road/RoadPatrol/registre.yaml`, standard: { fr: 'Le registre des routes' } }]);
});
