// The adapters (src/adapters/): a CSV template, a Table Schema, a strict JSON
// Schema for AI, a PostgreSQL / PostGIS table, for the fixture models, and the
// export command. With DATAMODELS_TEST_POSTGIS set to the name of a running
// postgis/postgis container, the SQL of every fixture model is also loaded into it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile, spawnSync } from 'node:child_process';
import { mkdtemp, writeFile, readFile, cp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { catalogUrls, loadSubjects, buildNode } from '../src/build/index.mjs';
import { ADAPTERS, localRefs, readRefs } from '../src/adapters/index.mjs';
import { columnsOf, shortTitle, snake } from '../src/adapters/model.mjs';
import { fieldsOf, tableSchemaOf, xsdPattern } from '../src/adapters/table-schema/index.mjs';
import { csvHeader } from '../src/adapters/csv/index.mjs';
import { structuredOutputOf, unionCount, NotStrict, strict } from '../src/adapters/ai/index.mjs';
import { createTable, ident, literal } from '../src/adapters/postgis/index.mjs';
import { exportModel } from '../src/export.mjs';

const run = promisify(execFile);
const BIN = join(import.meta.dirname, '..', 'bin', 'datamodels.mjs');
const datamodels = (...args) => run(process.execPath, [BIN, ...args]).then((r) => ({ code: 0, ...r }), (e) => ({ code: e.code, stdout: e.stdout, stderr: e.stderr }));
const DJ = 'https://datamodels.jp';
const SITE_DIR = join(import.meta.dirname, 'fixtures', 'site');

// The task and common subjects of datamodels.jp, from their sources (test/fixtures/catalog/).
const urls = catalogUrls(DJ);
const subjects = await loadSubjects(join(import.meta.dirname, 'fixtures', 'catalog', 'models'), { urls });
const { refs } = await readRefs(subjects.flatMap((s) => s.models), { local: localRefs(subjects, urls), fetch: () => { throw new Error('no network in tests'); } });
const context = { urls, languages: ['ja', 'en'], refs };
const task = subjects.find((s) => s.name === 'task');
const model = (type) => task.models.find((m) => m.type === type);

/** fetch for the copy of datamodels.jp in test/fixtures/site/: catalog.json and the schemas. */
const siteFetch = async (url) => {
  const u = new URL(url);
  if (u.origin !== DJ) return { ok: false, status: 404 };
  try {
    const text = await readFile(join(SITE_DIR, u.pathname), 'utf8');
    return { ok: true, status: 200, json: async () => JSON.parse(text) };
  } catch { return { ok: false, status: 404 }; }
};
const evacuationSite = await exportModel('disaster/EvacuationSite', ADAPTERS.map((a) => a.name), { index: `${DJ}/catalog.json`, fetch: siteFetch });
const file = (r, adapter) => r.files.find((f) => f.adapter === adapter).content;

test('columns: plain values, lists, a geometry, a value type split into its fields', () => {
  const kinds = Object.fromEntries(columnsOf(model('Task'), context).map((c) => [c.name, c.kind]));
  assert.deepEqual([kinds.name, kinds.keywords, kinds.relatedTo, kinds.location, kinds.start], ['scalar', 'list', 'list', 'geometry', 'scalar']);
  assert.deepEqual(columnsOf(model('Task'), context).find((c) => c.name === 'start').value.formats, ['date', 'date-time']);
  assert.throws(() => columnsOf({ type: 'X', schema: { properties: { a: { $ref: `${DJ}/schema/common/Nothing/v1.0.0.json`, 'x-iri': 'x' } } } }, context), /was not read/);
  assert.equal(snake('EvacuationSite'), 'evacuation_site');
  assert.equal(snake('abrMachiazaId'), 'abr_machiaza_id');
  assert.equal(shortTitle('指定緊急避難場所の名称（通称や建物の名前）'), '指定緊急避難場所の名称');
  assert.equal(shortTitle("Name of the site (its common name or the building's name)"), 'Name of the site');
});

test('Table Schema: one column per attribute, named as the attribute; the texts of each language', () => {
  const ts = tableSchemaOf(task, model('Task'), context);
  assert.equal(ts.$schema, 'https://datapackage.org/profiles/2.0/tableschema.json');
  assert.deepEqual(ts.primaryKey, ['id']);
  assert.equal(ts['x-typeIri'], `${DJ}/ns/task/Task`);
  assert.equal(ts['x-context'], `${DJ}/context/task/v1.jsonld`);
  const f = Object.fromEntries(ts.fields.map((x) => [x.name, x]));
  assert.deepEqual(f.id.constraints, { required: true, unique: true });
  assert.equal(f.name.description, '名称・件名');
  assert.deepEqual(f.name['x-translations'].en, { title: 'Name or subject', description: 'Name or subject' });
  assert.equal(f.name['x-iri'], 'https://uri.etsi.org/ngsi-ld/name');
  assert.deepEqual([f.keywords.type, f.keywords.delimiter, f.keywords.itemType], ['list', ';', 'string']);
  // Any geometry: longitude and latitude for a point, a GeoJSON column for the other shapes.
  assert.deepEqual([f.longitude.type, f.latitude.type, f.location.type], ['number', 'number', 'geojson']);
  assert.deepEqual(f.latitude.constraints, { minimum: -90, maximum: 90 });
  // A date or a date-time: a string with a pattern; a lookahead has no XML Schema form and is kept aside.
  assert.equal(f.start.type, 'string');
  assert.ok(new RegExp(`^${f.start.constraints.pattern}$`).test('2026-07-11') && new RegExp(`^${f.start.constraints.pattern}$`).test('2026-07-11T09:00:00+09:00'));
  assert.equal(f.estimatedDuration.constraints, undefined);
  assert.match(f.estimatedDuration['x-pattern'], /\(\?!\$\)/);
  assert.deepEqual(f.priority.constraints, { minimum: 0, maximum: 9 });
  assert.equal(f.completedAt.type, 'datetime');
  assert.equal(xsdPattern('^\\d{6}$'), '\\d{6}');
  assert.equal(xsdPattern('^E[0-9]{10}11'), 'E[0-9]{10}11.*');
});

test('Table Schema: a point as longitude and latitude, the address as one column per field', () => {
  const ts = JSON.parse(file(evacuationSite, 'table-schema'));
  const f = Object.fromEntries(ts.fields.map((x) => [x.name, x]));
  assert.ok(!f.location, 'a point needs no GeoJSON column');
  assert.ok(f.longitude && f.latitude);
  assert.deepEqual(f['address.postalCode'].constraints, { pattern: '\\d{3}-?\\d{4}' });
  assert.deepEqual(f['address.addressCountry'].constraints, { enum: ['JP'] });
  assert.equal(f['address.postalCode']['x-iri'], 'https://schema.org/postalCode');
  assert.deepEqual(f.hazardTypes.constraints, { minLength: 1 });
  assert.match(f.hazardTypes['x-translations'].en.description, /Several values separated by ;\. Allowed values: flood; landslide;/);
  assert.match(f.hazardTypes.description, /使える値：flood; landslide;/);
  assert.match(ts.description, /externalSiteId、nationalShelterId のどれか 1 つは必須です。$/);
  assert.match(ts['x-translations'].en.description, /At least one of externalSiteId, nationalShelterId is needed\.$/);
  // The CSV template is the header row of the same columns.
  assert.equal(file(evacuationSite, 'csv'), `${ts.fields.map((x) => x.name).join(',')}\n`);
  assert.equal(csvHeader(task, model('Milestone'), context), 'id,name,description,project,start,due,milestoneStatus,source,externalId,dateCreated,dateModified');
});

/** Every schema object in a JSON Schema. */
function* walk(s, path = '') {
  if (!s || typeof s !== 'object') return;
  yield [s, path];
  for (const [k, v] of Object.entries(s.properties ?? {})) yield* walk(v, `${path}.${k}`);
  for (const [i, v] of (s.anyOf ?? []).entries()) yield* walk(v, `${path}|${i}`);
  if (s.items) yield* walk(s.items, `${path}[]`);
}

test('AI: a strict schema that both OpenAI and Claude accept', () => {
  for (const [subject, m] of [[task, model('Task')], [task, model('Project')], [task, model('Milestone')]]) {
    const out = structuredOutputOf(subject, m, context);
    assert.equal(out.strict, true);
    assert.equal(out.name, m.type);
    for (const [s, path] of walk(out.schema)) {
      for (const k of ['$ref', 'oneOf', 'allOf', 'not', 'if', 'minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum', 'minLength', 'maxLength', 'maxItems', 'uniqueItems', 'const', 'patternProperties']) assert.ok(!(k in s), `${m.type}${path}: ${k}`);
      if (s.minItems !== undefined) assert.ok(s.minItems <= 1, `${m.type}${path}: minItems`);
      if (s.format) assert.ok(['date-time', 'date', 'time', 'duration', 'email', 'hostname', 'ipv4', 'ipv6', 'uuid'].includes(s.format), `${m.type}${path}: format ${s.format}`);
      if (s.pattern) assert.doesNotMatch(s.pattern, /\(\?/, `${m.type}${path}: lookaround`);
      if ([].concat(s.type).includes('object')) {
        assert.equal(s.additionalProperties, false, `${m.type}${path}`);
        assert.deepEqual(s.required, Object.keys(s.properties), `${m.type}${path}: every key required`);
      }
      if (s.enum && [].concat(s.type).includes('null')) assert.ok(s.enum.includes(null), `${m.type}${path}: null in a nullable enum`);
    }
    assert.ok(!('id' in out.schema.properties) && !('type' in out.schema.properties), 'the application sets id and type');
  }
  const t = structuredOutputOf(task, model('Task'), context).schema.properties;
  assert.deepEqual(t.name.type, 'string', 'required: not nullable');
  assert.deepEqual(t.description.type, ['string', 'null']);
  assert.deepEqual(t.progress.enum, ['needs-action', 'in-process', 'completed', 'failed', 'cancelled', null]);
  assert.match(t.priority.description, /\(minimum 0; maximum 9\)$/);
  assert.match(t.project.description, /\(a URI\)$/);
  assert.match(t.estimatedDuration.description, /must match the pattern/);
  assert.deepEqual(t.start.anyOf.map((a) => a.format ?? a.type), ['date', 'date-time', 'null']);
  // Any geometry the model allows, not only a point.
  assert.deepEqual(t.location.anyOf.map((a) => a.properties?.type.enum[0] ?? a.type), ['Point', 'LineString', 'Polygon', 'MultiPoint', 'MultiLineString', 'MultiPolygon', 'GeometryCollection', 'null']);
  const site = JSON.parse(file(evacuationSite, 'ai'));
  assert.deepEqual(site.schema.properties.location.type, ['object', 'null']);
  assert.deepEqual(site.schema.properties.location.properties.type.enum, ['Point']);
  assert.deepEqual(site.schema.properties.address.properties.addressCountry.enum, ['JP', null]);
  assert.match(site.description, /At least one of externalSiteId, nationalShelterId is not null\./);
  assert.ok(unionCount(site.schema) > 16, 'too many unions for Claude\'s strict mode: export notes it');
});

test('AI: a model with a map of any keys has no file', () => {
  const m = { type: 'Answer', kind: 'entity', catalog: {}, schema: { properties: { id: {}, type: {}, scores: { type: 'object', additionalProperties: { type: 'number' }, 'x-iri': 'https://example.org/scores', 'x-ngsi': { type: 'JsonProperty' } } } } };
  assert.throws(() => structuredOutputOf(task, m, context), (e) => e instanceof NotStrict && /scores: an object with any keys/.test(e.message));
  assert.equal(ADAPTERS.find((a) => a.name === 'ai').urlFor(task, m, context), null);
  // The others keep it as JSON.
  assert.equal(fieldsOf(task, m, context).find((f) => f.name === 'scores').type, 'object');
  assert.match(createTable(task, m, context), /\n {2}scores jsonb,?\n/);
});

test('PostGIS: a table with constraints, a GiST index and comments', () => {
  const sql = createTable(task, model('Project'), context);
  assert.match(sql, /^CREATE TABLE project \($/m);
  assert.match(sql, /^ {2}id text PRIMARY KEY,$/m);
  assert.match(sql, /^ {2}name text NOT NULL,$/m);
  assert.match(sql, /^ {2}"end" text,$/m, 'a reserved word is quoted');
  assert.match(sql, /^ {2}location geometry\(Geometry, 4326\),$/m);
  assert.match(sql, /^ {2}keywords text\[\],$/m);
  assert.match(sql, /CHECK \(project_status IN \('active', 'closed', 'archived'\)\)/);
  assert.match(sql, /CHECK \("end" ~ E'\^\\\\d\{4\}/);
  assert.match(sql, /^CREATE INDEX project_location_idx ON project USING gist \(location\);$/m);
  assert.match(sql, /^COMMENT ON COLUMN project\.name IS '名称・件名\nName or subject\n<https:\/\/uri\.etsi\.org\/ngsi-ld\/name>';$/m);
  assert.match(sql, /^COMMENT ON TABLE project IS '.*\n[\s\S]*<https:\/\/datamodels\.jp\/ns\/task\/Project>';$/m);
  const site = file(evacuationSite, 'postgis');
  assert.match(site, /^ {2}location geometry\(Point, 4326\),$/m);
  assert.match(site, /^ {2}address_postal_code text,$/m);
  assert.match(site, /CHECK \(address_postal_code ~ E'\^\\\\d\{3\}-\?\\\\d\{4\}\$'\)/);
  assert.match(site, /CHECK \(hazard_types <@ ARRAY\['flood', /);
  assert.match(site, /CHECK \(cardinality\(hazard_types\) >= 1\)/);
  assert.match(site, /CHECK \(external_site_id IS NOT NULL OR national_shelter_id IS NOT NULL\)/);
  assert.match(site, /'共通ID''/, 'single quotes doubled');
  assert.equal(ident('user'), '"user"');
  assert.equal(ident('route'), 'route');
});

test('export: a model of another node, from its catalog.json', async () => {
  assert.equal(evacuationSite.from, `${DJ}/catalog.json`);
  assert.equal(evacuationSite.typeIri, `${DJ}/ns/disaster/EvacuationSite`);
  assert.deepEqual(evacuationSite.files.map((f) => f.name), ['EvacuationSite.csv', 'EvacuationSite.tableschema.json', 'EvacuationSite.ai.json', 'EvacuationSite.sql']);
  await assert.rejects(exportModel('disaster/Nothing', ['csv'], { index: `${DJ}/catalog.json`, fetch: siteFetch }), /not a model in https:\/\/datamodels\.jp\/catalog\.json/);
  await assert.rejects(exportModel('common/Geometry', ['csv'], { index: `${DJ}/catalog.json`, fetch: siteFetch }), /a value type/);
  await assert.rejects(exportModel('disaster/EvacuationSite', ['excel'], { index: `${DJ}/catalog.json`, fetch: siteFetch }), /no adapter excel/);
});

test('export on the command line: the model of a local node, into --out', async () => {
  const out = await mkdtemp(join(tmpdir(), 'datamodels-export-'));
  const r = await datamodels('export', 'road/RoadPatrol', join(import.meta.dirname, 'fixtures', 'node'), '--to', 'csv,postgis', '--out', out);
  assert.equal(r.code, 0, r.stderr);
  assert.equal(await readFile(join(out, 'RoadPatrol.csv'), 'utf8'), 'id,route\n');
  assert.match(await readFile(join(out, 'RoadPatrol.sql'), 'utf8'), /^CREATE TABLE road_patrol \($/m);
  assert.match(r.stderr, /road\/RoadPatrol: https:\/\/models\.example\.org\/ns\/road#RoadPatrol/);
  const bad = await datamodels('export', 'road/RoadPatrol', '--to', 'excel');
  assert.equal(bad.code, 2);
  assert.match(bad.stderr, /--to excel: not an adapter \(csv, table-schema, ai, postgis\)/);
  assert.equal((await datamodels('export', 'road/RoadPatrol')).code, 2, '--to is required');
});

test('build: the schemas of other nodes are read online; a model whose schemas cannot be read gets no adapter files', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'datamodels-adapters-'));
  await cp(join(import.meta.dirname, 'fixtures', 'node'), dir, { recursive: true });
  const sf = join(dir, 'models', 'road', 'RoadPatrol', 'schema.json');
  const schema = JSON.parse(await readFile(sf, 'utf8'));
  schema.properties.address = { $ref: `${DJ}/schema/common/JapaneseAddress/v1.0.0.json`, 'x-iri': 'https://schema.org/address', 'x-ngsi': { type: 'Property' } };
  await writeFile(sf, JSON.stringify(schema));
  const cf = join(dir, 'models', 'road', 'RoadPatrol', 'catalog.yaml');
  await writeFile(cf, `${await readFile(cf, 'utf8')}  address: { en: Where }\n`);
  // Not read while node.yaml does not list datamodels.jp: only the schemas of known nodes are.
  const unknown = await buildNode(dir, { out: join(dir, 'unknown'), fetch: siteFetch, pages: false });
  assert.match(unknown.notes[0], /JapaneseAddress\/v1\.0\.0\.json is not read: only the schemas of the nodes in node\.yaml are \(none listed\)/);
  await writeFile(join(dir, 'node.yaml'), `${await readFile(join(dir, 'node.yaml'), 'utf8')}nodes:\n  - { url: ${DJ}/, index: ${DJ}/catalog.json }\n`);
  const r = await buildNode(dir, { fetch: siteFetch, pages: false });
  assert.deepEqual(r.notes, []);
  const csv = await readFile(join(dir, '_site', 'adapters', 'csv', 'road', 'RoadPatrol.csv'), 'utf8');
  assert.match(csv, /^id,route,address\.addressCountry,address\.postalCode,/);
  const offline = await buildNode(dir, { out: join(dir, 'offline'), fetch: async () => { throw new Error('offline'); } });
  assert.match(offline.notes[0], /no adapter files for the models that use it: https:\/\/datamodels\.jp\/schema\/common\/JapaneseAddress\/v1\.0\.0\.json could not be read/);
  assert.equal(offline.catalog.models[0].adapters, undefined);
  assert.ok(!offline.pages.includes('adapters/index.html'), 'no adapters page without files');
  assert.doesNotMatch(await readFile(join(dir, 'offline', 'models', 'road', 'RoadPatrol', 'index.html'), 'utf8'), /<dt>Adapters<\/dt>/);
});

// Opt-in: DATAMODELS_TEST_POSTGIS=<container> with a running postgis/postgis image whose init has finished.
const container = process.env.DATAMODELS_TEST_POSTGIS;
test('PostGIS: the SQL of every fixture model loads, and the checks reject a wrong row', { skip: !container && 'set DATAMODELS_TEST_POSTGIS to a running postgis container' }, async () => {
  const psql = (sql) => spawnSync('docker', ['exec', '-i', container, 'psql', '-U', 'postgres', '-q', '-v', 'ON_ERROR_STOP=1'], { input: sql, encoding: 'utf8' });
  const schema = `adapters_test_${process.pid}`;
  const sqls = [
    ...task.models.filter((m) => m.kind === 'entity').map((m) => createTable(task, m, context)),
    file(evacuationSite, 'postgis'),
    file(await exportModel('disaster/DesignatedShelter', ['postgis'], { index: `${DJ}/catalog.json`, fetch: siteFetch }), 'postgis'),
    (await exportModel('road/RoadPatrol', ['postgis'], { dir: join(import.meta.dirname, 'fixtures', 'node') })).files[0].content,
  ];
  try {
    const r = psql(`CREATE SCHEMA ${schema}; SET search_path TO ${schema}, public;\n${sqls.join('\n')}`);
    assert.equal(r.status, 0, r.stderr);
    const ok = psql(`SET search_path TO ${schema}, public; INSERT INTO evacuation_site (id, name, local_government_code, external_site_id, location, hazard_types) VALUES ('urn:ngsi-ld:EvacuationSite:1', '番町小学校', '131016', '1', ST_SetSRID(ST_MakePoint(139.734, 35.688), 4326), ARRAY['flood']);`);
    assert.equal(ok.status, 0, ok.stderr);
    const wrong = psql(`SET search_path TO ${schema}, public; INSERT INTO evacuation_site (id, name, local_government_code, external_site_id, hazard_types) VALUES ('urn:ngsi-ld:EvacuationSite:2', 'x', '131016', '2', ARRAY['meteor']);`);
    assert.match(wrong.stderr, /violates check constraint "evacuation_site_hazard_types_check"/);
    const twice = psql(`SET search_path TO ${schema}, public; INSERT INTO evacuation_site (id, name, local_government_code, external_site_id, hazard_types) VALUES ('urn:ngsi-ld:EvacuationSite:3', 'x', '131016', '3', ARRAY['flood', 'flood']);`);
    assert.match(twice.stderr, /violates check constraint "evacuation_site_hazard_types_check/);
    const lookahead = psql(`SET search_path TO ${schema}, public; INSERT INTO task (id, name, progress, estimated_duration) VALUES ('urn:ngsi-ld:Task:1', 'x', 'completed', 'P');`);
    assert.match(lookahead.stderr, /violates check constraint "task_estimated_duration_check"/);
  } finally {
    psql(`DROP SCHEMA IF EXISTS ${schema} CASCADE;`);
  }
});

test('a date-time needs seconds and Z or an offset, as JSON Schema\'s format does', async () => {
  const { DATE_OR_DATE_TIME: tsPattern } = await import('../src/adapters/table-schema/index.mjs');
  const { DATE_OR_DATE_TIME: sqlPattern } = await import('../src/adapters/postgis/index.mjs');
  for (const re of [new RegExp(`^${tsPattern}$`), new RegExp(sqlPattern)]) {
    for (const ok of ['2026-07-11', '2026-07-11T09:00:00Z', '2026-07-11T09:00:00.5+09:00']) assert.match(ok, re);
    for (const bad of ['2026-07-11T09:00', '2026-07-11T09:00:00', '2026-07-11T09:00Z']) assert.doesNotMatch(bad, re);
  }
});

test('Table Schema: a field the value type requires is required when the entity requires the value', () => {
  const ref = 'https://example.org/schema/Place/v1.0.0.json';
  const where = { $ref: ref, 'x-iri': 'https://example.org/ns#where', 'x-ngsi': { type: 'Property' } };
  const thing = (required) => ({ type: 'Thing', kind: 'entity', catalog: { attributes: {} }, schema: { required: ['id', 'type', ...required], properties: { id: { type: 'string' }, type: { const: 'Thing' }, where } } });
  const refs = { [ref]: { schema: { type: 'object', required: ['city'], properties: { city: { type: 'string' }, zip: { type: 'string' } } }, texts: {} } };
  const ctx = { urls: catalogUrls('https://example.org'), languages: ['en'], refs };
  const fields = (required) => Object.fromEntries(fieldsOf({ name: 's', version: '1.0.0' }, thing(required), ctx).map((f) => [f.name, f.constraints ?? {}]));
  assert.equal(fields(['where'])['where.city'].required, true);
  assert.equal(fields(['where'])['where.zip'].required, undefined);
  assert.equal(fields([])['where.city'].required, undefined, 'an optional value requires none of its fields');
});

test('export: a type IRI of the local node is its own model, not read from another node', async () => {
  const noNetwork = () => { throw new Error('read the network'); };
  const r = await exportModel('https://models.example.org/ns/road#RoadPatrol', ['csv'], { dir: join(import.meta.dirname, 'fixtures', 'node'), fetch: noNetwork });
  assert.equal(r.files[0].content, 'id,route\n');
  assert.equal(r.typeIri, 'https://models.example.org/ns/road#RoadPatrol');
});

test('check --offline reads no schema of another site for the adapters', async () => {
  const { checkNode } = await import('../src/build/index.mjs');
  const dir = await mkdtemp(join(tmpdir(), 'datamodels-adapters-'));
  await cp(join(import.meta.dirname, 'fixtures', 'node'), dir, { recursive: true });
  const sf = join(dir, 'models', 'road', 'RoadPatrol', 'schema.json');
  const schema = JSON.parse(await readFile(sf, 'utf8'));
  schema.properties.address = { $ref: `${DJ}/schema/common/JapaneseAddress/v1.0.0.json`, 'x-iri': 'https://schema.org/address', 'x-ngsi': { type: 'Property' } };
  await writeFile(sf, JSON.stringify(schema));
  // Neither the fetch it is given nor the global one.
  const read = [];
  const record = async (url) => { read.push(String(url)); throw new Error('offline'); };
  const global = globalThis.fetch;
  globalThis.fetch = record;
  try { await checkNode(dir, { offline: true, fetch: record }); } finally { globalThis.fetch = global; }
  assert.deepEqual(read.filter((u) => u.includes('JapaneseAddress')), []);
});

test('a $ref outside the schema/ of a known node is never fetched', async () => {
  const { schemaPrefixes } = await import('../src/adapters/index.mjs');
  const bad = ['http://169.254.169.254/latest/meta-data/x.json', 'http://localhost:8080/schema/x.json', `${DJ}/context/x.json`, 'https://datamodels.jp.example.com/schema/x.json', `${DJ}/schema/../secret.json`, `${DJ}/schema/%2e%2e/secret.json`];
  const good = `${DJ}/schema/common/JapaneseAddress/v1.0.0.json`;
  const properties = Object.fromEntries([...bad, good].map((ref, i) => [`p${i}`, { $ref: ref }]));
  const thing = { type: 'Thing', kind: 'entity', schema: { properties: { id: { type: 'string' }, type: { const: 'Thing' }, ...properties } } };
  const read = [];
  const r = await readRefs([thing], { fetch: async (url, o) => { read.push(String(url)); return siteFetch(url, o); }, trusted: schemaPrefixes([{ url: `${DJ}/` }]) });
  assert.deepEqual(read, [good]);
  assert.deepEqual(Object.keys(r.refs), [good]);
  assert.equal(r.problems.length, bad.length);
  assert.ok(r.problems.every((x) => / is not read: only the schemas of the nodes in node\.yaml are \(https:\/\/datamodels\.jp\/schema\/\)$/.test(x)));
});

test('PostGIS: a list without duplicates is checked by a function the file creates first', async () => {
  const { UNIQUE_ITEMS } = await import('../src/adapters/postgis/index.mjs');
  const sql = file(evacuationSite, 'postgis');
  assert.ok(sql.indexOf(`CREATE OR REPLACE FUNCTION ${UNIQUE_ITEMS}(anyarray)`) < sql.indexOf('CREATE TABLE'));
  assert.match(sql, new RegExp(`CHECK \\(${UNIQUE_ITEMS}\\(hazard_types\\)\\)`));
  assert.doesNotMatch(createTable(task, model('Milestone'), context), /FUNCTION/, 'only when a list needs it');
});

test('a $ref to a part of the model\'s own schema is read there; a relative file is one JSON value', () => {
  const thing = { type: 'Thing', kind: 'entity', catalog: { attributes: {} }, schema: {
    $defs: { Place: { type: 'object', required: ['city'], properties: { city: { type: 'string' }, zip: { type: 'string' } } } },
    required: ['id', 'type', 'where'],
    properties: { id: { type: 'string' }, type: { const: 'Thing' }, where: { $ref: '#/$defs/Place', 'x-iri': 'https://example.org/ns#where' }, other: { $ref: 'Other.json', 'x-iri': 'https://example.org/ns#other' }, lost: { $ref: '#/$defs/Nothing', 'x-iri': 'https://example.org/ns#lost' } },
  } };
  const cols = Object.fromEntries(columnsOf(thing, { refs: {} }).map((c) => [c.name, c]));
  assert.equal(cols.where.kind, 'parts');
  assert.deepEqual(cols.where.parts.map((x) => [x.name, x.required]), [['city', true], ['zip', false]]);
  assert.equal(cols.other.kind, 'json');
  assert.equal(cols.lost.kind, 'json');
});

test('export reads a model\'s schema only from the catalog\'s own site', async () => {
  const catalog = { models: [{ subject: 'x', type: 'Evil', kind: 'entity', typeIri: 'https://evil.example/ns#Evil', schemaUrl: 'http://169.254.169.254/latest/meta-data/x.json', title: { en: 'Evil' } }] };
  const read = [];
  const fetchStub = async (url) => { read.push(String(url)); return { ok: true, status: 200, json: async () => catalog }; };
  await assert.rejects(exportModel('x/Evil', ['csv'], { index: 'https://evil.example/catalog.json', fetch: fetchStub }), /is not under https:\/\/evil\.example\/schema\/, not read/);
  assert.deepEqual(read, ['https://evil.example/catalog.json']);
});

test('a redirect is followed only to https on a public host name', async () => {
  const { getter, publicUrl } = await import('../src/adapters/index.mjs');
  for (const ok of ['https://dkastl.github.io/models/schema/x.json', 'https://w3id.org/x/schema/a.json']) assert.ok(publicUrl(ok), ok);
  for (const bad of ['http://example.org/x', 'https://169.254.169.254/x', 'https://127.0.0.1/x', 'https://[::1]/x', 'https://localhost/x', 'https://printer.local/x', 'https://db.internal/x', 'https://intranet/x', 'https://u:p@example.org/x', 'https://localhost./x', 'https://printer.local./x', 'https://intranet./x']) assert.ok(!publicUrl(bad), bad);
  const redirecting = (to) => async (url) => (url === 'https://w3id.org/n/schema/a.json'
    ? { ok: false, status: 302, headers: new Headers({ location: to }) }
    : { ok: true, status: 200, json: async () => ({ to: url }) });
  assert.deepEqual(await getter(redirecting('https://n.github.io/schema/a.json'), 1000)('https://w3id.org/n/schema/a.json'), { to: 'https://n.github.io/schema/a.json' });
  await assert.rejects(getter(redirecting('http://169.254.169.254/latest/meta-data/'), 1000)('https://w3id.org/n/schema/a.json'), /redirects to http:\/\/169\.254\.169\.254\/latest\/meta-data\/, not followed/);
  const loop = async (url) => ({ ok: false, status: 302, headers: new Headers({ location: `${url}x` }) });
  await assert.rejects(getter(loop, 1000)('https://example.org/a'), /at most 5 times/);
});

test('PostGIS: schema values cannot add SQL of their own', () => {
  const evil = (prop, required = []) => ({ type: 'Thing', kind: 'entity', catalog: { attributes: {} }, schema: { required: ['id', 'type', ...required], properties: { id: { type: 'string' }, type: { const: 'Thing' }, n: { 'x-iri': 'https://example.org/ns#n', ...prop } } } });
  const ctx = { urls: catalogUrls('https://example.org'), languages: ['en'], refs: {} };
  const s = { name: 's', version: '1.0.0' };
  assert.throws(() => createTable(s, evil({ type: 'number', minimum: '0); DROP TABLE important; --' }), ctx), /minimum must be a number/);
  assert.throws(() => createTable(s, evil({ type: 'string', maxLength: '1) OR (1=1' }), ctx), /maxLength must be a whole number/);
  assert.throws(() => createTable(s, evil({ type: 'array', items: { type: 'string' }, minItems: '1); DROP TABLE x; --' }), ctx), /minItems must be a whole number/);
  // A line break in a catalog value cannot end a -- comment.
  const model = { ...evil({ type: 'string' }), links: { typeIri: 'https://example.org/ns#Thing\nDROP TABLE important;', schemaUrl: 'https://example.org/s.json', contextUrl: 'https://example.org/c.jsonld\r\nDROP TABLE x;' } };
  const sql = createTable({ name: 's\nDROP TABLE y;', version: '1.0.0' }, model, ctx);
  // The header stays three comment lines; elsewhere the values are inside quoted literals (quotes doubled).
  const lines = sql.split('\n');
  assert.ok(lines.slice(0, 3).every((l) => l.startsWith('-- ')), sql);
  assert.match(lines[0], /^-- Thing: https:\/\/example\.org\/ns#Thing DROP TABLE important;$/);
  const outsideLiterals = sql.replace(/'(?:[^']|'')*'/g, "''");
  assert.ok(!/^DROP TABLE/m.test(outsideLiterals), outsideLiterals);
});

test('PostGIS: a string literal means the same whatever standard_conforming_strings is', () => {
  assert.equal(literal('flood'), "'flood'");
  assert.equal(literal("it's"), "'it''s'");
  assert.equal(literal('^\\d{3}$'), "E'^\\\\d{3}$'");
  // A backslash before a quote cannot end the literal early, with the setting on or off.
  assert.equal(literal("\\' OR 1=1 --"), "E'\\\\'' OR 1=1 --'");
});

test('the adapters connect only to public addresses, also for the first URL', async () => {
  const { isPublicAddress, publicFetch } = await import('../src/adapters/net.mjs');
  const { getter } = await import('../src/adapters/index.mjs');
  for (const ok of ['8.8.8.8', '104.21.1.1', '2606:4700::1', '::ffff:808:808', '2a00:1450:4001::1']) assert.ok(isPublicAddress(ok), ok);
  for (const bad of ['127.0.0.1', '10.0.0.5', '172.16.0.1', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '224.0.0.1', '::1', '::', 'fd00::1', 'fe80::1', '::ffff:127.0.0.1', '::ffff:10.0.0.1', '::ffff:7f00:1', '::ffff:a00:1', '::ffff:a9fe:a9fe', '0:0:0:0:0:ffff:7f00:1', '::127.0.0.1', 'fc12::1', 'fec0::1', 'ff02::1', '64:ff9b::a00:1', '2001:db8::1', 'not-an-ip']) assert.ok(!isPublicAddress(bad), bad);
  await assert.rejects(publicFetch('https://127.0.0.1/x'), /127\.0\.0\.1 is not a public address/);
  await assert.rejects(publicFetch('https://[::1]/x'), /::1 is not a public address/);
  await assert.rejects(publicFetch('http://example.org/x'), /only https is read/);
  // The first URL is checked before any request, not only the redirects.
  const read = [];
  const stub = async (url) => { read.push(url); return { ok: true, status: 200, json: async () => ({}) }; };
  await assert.rejects(getter(stub, 1000)('http://169.254.169.254/schema/x.json'), /only https on a public host name/);
  await assert.rejects(getter(stub, 1000)('https://10.0.0.1/schema/x.json'), /only https on a public host name/);
  assert.deepEqual(read, []);
});

test('PostGIS: two attributes with the same column name give no table, not a broken one', async () => {
  const { NoTable } = await import('../src/adapters/postgis/index.mjs');
  const postgis = ADAPTERS.find((a) => a.name === 'postgis');
  const thing = { type: 'Thing', kind: 'entity', catalog: { attributes: {} }, schema: { required: ['id', 'type'], properties: { id: { type: 'string' }, type: { const: 'Thing' }, fooBar: { type: 'string', 'x-iri': 'https://example.org/ns#fooBar' }, foo_bar: { type: 'string', 'x-iri': 'https://example.org/ns#foo_bar' } } } };
  const ctx = { urls: catalogUrls('https://example.org'), languages: ['en'], refs: {} };
  assert.throws(() => createTable({ name: 's', version: '1.0.0' }, thing, ctx), (e) => e instanceof NoTable && /foo_bar would hold both/.test(e.message));
  assert.equal(postgis.urlFor({ name: 's', version: '1.0.0' }, thing, ctx), null);
});

test('AI: the keywords next to anyOf hold in every branch', () => {
  const s = strict({ type: 'string', pattern: '^[0-9]+$', anyOf: [{ format: 'date' }, { maxLength: 4 }] }, 'x');
  assert.equal(s.anyOf.length, 2);
  for (const b of s.anyOf) { assert.equal(b.type, 'string'); assert.equal(b.pattern, '^[0-9]+$'); }
  assert.equal(s.anyOf[0].format, 'date');
  assert.match(s.anyOf[1].description, /at most 4 characters/);
  const n = strict({ type: 'number', minimum: 0, anyOf: [{ maximum: 10 }, { const: 100 }] }, 'n');
  assert.match(n.anyOf[0].description, /minimum 0; maximum 10/);
  assert.throws(() => strict({ anyOf: [{ type: 'string' }], oneOf: [{ type: 'number' }] }, 'y'), NotStrict);
  // A branch that repeats a keyword with another value: both must hold, so no strict form.
  assert.throws(() => strict({ type: 'string', pattern: '^A', anyOf: [{ pattern: 'B$' }] }, 'p'), (e) => e instanceof NotStrict && /pattern next to anyOf and in the branch must both hold/.test(e.message));
  assert.throws(() => strict({ type: 'string', anyOf: [{ type: 'number' }] }, 't'), NotStrict);
  // The same value repeated is fine.
  assert.equal(strict({ type: 'string', anyOf: [{ type: 'string', format: 'date' }] }, 'd').anyOf[0].format, 'date');
});
